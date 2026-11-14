"""Average multiple curves onto a common x grid (Origin "Average Multiple Curves").

Pure calc layer. N datasets each contribute ONE y channel (picked by column
name, the same name in every dataset, or each dataset's first numeric channel
when no name is given). Every curve is linearly interpolated onto one common
grid through ``calc.resample_align.align_resample`` -- so the resample guards
apply unchanged to every curve:

- **No extrapolation.** A grid point outside a curve's own finite x-range is
  blank for that curve; the point averages only the curves that cover it, and
  the ``N`` column says how many did.
- **A direction reversal is refused** (a loop's branches would merge) unless
  ``unsorted="sort"``, which is reported per curve.
- Repeated x is averaged, blank x rows dropped, blank y bridged -- each
  reported per curve, prefixed with the curve's name.

Grids:

- ``"union"``: every distinct finite x of every curve, over the whole span.
  Points outside the overlap average fewer curves (reported, ``N`` column).
- ``"step"``: ``lo:step:hi`` (MATLAB colon) over the OVERLAP of all curves,
  so every point averages all N curves. Refused when the curves do not
  overlap.

Output columns: ``<name> mean``, ``<name> SD`` (sample, ddof = 1; blank where
fewer than 2 curves cover the point), ``<name> SEM`` (SD / sqrt(N)) and ``N``.
The caller binds SEM as the mean's error.

A y-unit (or x-unit) disagreement between curves is refused unless
``allow_unit_mismatch=True``, which reports it as a ``confirm`` warning.

Parity: Origin's tool is GUI-only and ``quantized_matlab`` has no equivalent
(it averages only by-column within one table), so there is no golden; the
statistics are pinned by hand-computed tests (``tests/test_calc_curve_average``).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from ..datastruct import DataStruct
from ..x_units import x_unit_of
from ._warn import warn as _warn
from .resample import _colon
from .resample_align import MAX_GRID_POINTS, align_resample

__all__ = ["AverageResult", "average_curves"]

_GRIDS = ("union", "step")


@dataclass(frozen=True)
class AverageResult:
    """The averaged dataset and the plain-language report."""

    data: DataStruct
    warnings: list[dict[str, Any]] = field(default_factory=list)
    #: The overlap of every curve's finite x-range ``(lo, hi)`` (NaN, NaN when none).
    overlap: tuple[float, float] = (math.nan, math.nan)
    #: The y channel name each curve contributed, in order.
    channels: list[str] = field(default_factory=list)


def _pick_channel(ds: DataStruct, channel: str, name: str) -> int:
    cats = ds.cat_levels or {}
    if channel:
        hits = [i for i, lab in enumerate(ds.labels) if lab == channel]
        if not hits:
            raise ValueError(f'"{name}" has no column named "{channel}"')
        if hits[0] in cats:
            raise ValueError(f'"{channel}" in "{name}" is a text column; it cannot be averaged')
        return hits[0]
    for i in range(len(ds.labels)):
        if i not in cats:
            return i
    raise ValueError(f'"{name}" has no numeric column to average')


def _one_channel(ds: DataStruct, c: int) -> DataStruct:
    vals = np.asarray(ds.values, dtype=float)
    col = vals.reshape(vals.shape[0], -1)[:, c] if vals.size else np.zeros(0)
    return DataStruct.create(
        np.asarray(ds.time, dtype=float),
        col.reshape(-1, 1),
        labels=[ds.labels[c]],
        units=[ds.units[c] if c < len(ds.units) else ""],
        metadata=dict(ds.metadata),
    )


def _finite_range(ds: DataStruct, name: str) -> tuple[float, float]:
    x = np.asarray(ds.time, dtype=float).ravel()
    y = np.asarray(ds.values, dtype=float).ravel()
    keep = np.isfinite(x) & np.isfinite(y)
    xs = x[keep]
    if np.unique(xs).size < 2:
        raise ValueError(f'"{name}" needs at least 2 distinct x values with data')
    return float(xs.min()), float(xs.max())


def _grid(
    curves: Sequence[DataStruct], ranges: list[tuple[float, float]], grid: str, step: float | None
) -> NDArray[np.float64]:
    if grid == "union":
        xs = np.concatenate([np.asarray(c.time, dtype=float).ravel() for c in curves])
        out = np.unique(xs[np.isfinite(xs)])
        if out.size > MAX_GRID_POINTS:
            raise ValueError(
                f"the union of the x values has more than {MAX_GRID_POINTS:,} points; "
                "use a set step instead"
            )
        return np.asarray(out, dtype=float)
    if step is None or not math.isfinite(step) or step <= 0:
        raise ValueError("step must be a positive finite number")
    lo = max(r[0] for r in ranges)
    hi = min(r[1] for r in ranges)
    if lo >= hi:
        raise ValueError(
            "the curves do not overlap in x, so a set step over the overlap has no points; "
            "use the union of the x values instead"
        )
    if (hi - lo) / step + 1 > MAX_GRID_POINTS:
        raise ValueError(
            f"the grid would have more than {MAX_GRID_POINTS:,} points; use a larger step"
        )
    return _colon(lo, float(step), hi)


def _unit_check(
    kind: str, units: list[str], names: Sequence[str], allow: bool, warnings: list[dict[str, Any]]
) -> None:
    known = {u for u in units if u}
    if len(known) < 2:
        return
    pairs = ", ".join(f'"{n}" {u}' for n, u in zip(names, units, strict=True) if u)
    text = f"The curves' {kind} units differ ({pairs}); averaging them treats the numbers as alike."
    if not allow:
        raise ValueError(text)
    warnings.append(_warn("unit-mismatch", text, confirm=True))


def _stats(
    m: NDArray[np.float64],
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Row mean, sample SD (ddof 1), SEM and count over finite entries."""
    ok = np.isfinite(m)
    n = ok.sum(axis=1).astype(float)
    filled = np.where(ok, m, 0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.asarray(np.where(n > 0, filled.sum(axis=1) / n, np.nan), dtype=float)
        dev = np.where(ok, m - mean[:, None], 0.0)
        var = np.where(n > 1, (dev**2).sum(axis=1) / (n - 1), np.nan)
        sd = np.asarray(np.sqrt(var), dtype=float)
        sem = np.asarray(sd / np.sqrt(n), dtype=float)
    return mean, sd, sem, np.asarray(n, dtype=float)


def average_curves(
    curves: Sequence[DataStruct],
    *,
    names: Sequence[str] | None = None,
    channel: str = "",
    grid: str = "union",
    step: float | None = None,
    unsorted: str = "refuse",
    allow_unit_mismatch: bool = False,
) -> AverageResult:
    """Average ``curves`` (>= 2) pointwise on a common grid; see the module doc.

    Raises ``ValueError`` with a user-facing message for a refused input.
    """
    if len(curves) < 2:
        raise ValueError("pick at least two datasets to average")
    if grid not in _GRIDS:
        raise ValueError(f"grid must be one of {_GRIDS}")
    nm = list(names) if names is not None else [f"curve {i + 1}" for i in range(len(curves))]
    if len(nm) != len(curves):
        raise ValueError("one name per curve is required")
    picked = [_pick_channel(c, channel.strip(), n) for c, n in zip(curves, nm, strict=True)]
    singles = [_one_channel(c, k) for c, k in zip(curves, picked, strict=True)]
    labels = [c.labels[k] for c, k in zip(curves, picked, strict=True)]
    warnings: list[dict[str, Any]] = []
    _unit_check("x", [x_unit_of(c) for c in curves], nm, allow_unit_mismatch, warnings)
    _unit_check("y", [s.units[0] for s in singles], nm, allow_unit_mismatch, warnings)
    ranges = [_finite_range(s, n) for s, n in zip(singles, nm, strict=True)]
    g = _grid(singles, ranges, grid, step)

    cols: list[NDArray[np.float64]] = []
    for s, n in zip(singles, nm, strict=True):
        res = align_resample(
            s,
            mode="match",
            match_x=g,
            method="linear",
            out_of_range="nan",
            unsorted=unsorted,
            allow_unit_mismatch=True,  # checked once, across all curves, above
        )
        for w in res.warnings:
            # Out-of-range points are the union grid's expected partial coverage,
            # summarized once below; a unit mismatch was reported above.
            if w["code"] in ("out-of-range", "unit-mismatch"):
                continue
            warnings.append({**w, "text": f'"{n}": {w["text"]}'})
        cols.append(np.asarray(res.data.values, dtype=float).reshape(-1))
    mean, sd, sem, count = _stats(np.column_stack(cols))
    partial = int(np.count_nonzero(count < len(curves)))
    if partial:
        warnings.append(
            _warn(
                "out-of-range",
                f"{partial} of {g.size} grid points lie outside some curves' x-range; "
                "each averages only the curves that cover it (see the N column).",
                count=partial,
                info=grid == "union",
            )
        )
    base = labels[0] if len(set(labels)) == 1 else "y"
    unit = singles[0].units[0]
    x_keys = ("xUnit", "x_column_unit", "xColumnUnit", "xLabel")
    meta: dict[str, Any] = {k: v for k, v in curves[0].metadata.items() if k in x_keys}
    meta.update(
        {
            "averageOf": nm,
            "averageChannels": labels,
            "averageGrid": grid,
            "averageInterp": "linear",
        }
    )
    if grid == "step":
        meta["averageStep"] = float(step) if step is not None else None
    data = DataStruct.create(
        g,
        np.column_stack([mean, sd, sem, count]),
        labels=[f"{base} mean", f"{base} SD", f"{base} SEM", "N"],
        units=[unit, unit, unit, ""],
        metadata=meta,
    )
    lo = max(r[0] for r in ranges)
    hi = min(r[1] for r in ranges)
    overlap = (lo, hi) if lo < hi else (math.nan, math.nan)
    return AverageResult(data=data, warnings=warnings, overlap=overlap, channels=labels)
