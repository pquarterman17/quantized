"""Checked resample / align onto a common grid (audit P2.5, "align/interpolate").

Pure calc layer. A guard-and-report wrapper around the golden
``calc.resample.resample_data`` (port of MATLAB ``utilities.resampleData``):
it builds the target grid, refuses the inputs that would silently produce a
wrong answer, and reports -- as plain sentences -- everything the user should
know BEFORE the derived dataset is created. The interpolation numerics are
``resample_data``'s own, untouched (its ``n_points`` and ``grid`` modes). A
``step`` / ``range`` endpoint that lands on the stop value is exactly that
value, as in MATLAB's colon (``calc.resample._colon``, which snaps its own
ulp overshoot -- ``0:0.1:0.3`` would otherwise end at
0.30000000000000004 -- to the stop value itself).

The rules, each a deliberate product decision:

- **No extrapolation, ever.** ``resample_data`` is always called with
  ``extrapolate=False``. A target point outside the source's finite x-range
  either comes out blank (``out_of_range="nan"``) or is dropped from the grid
  (``"clip"``); either way the count is reported.
- **Direction reversals are refused by default.** A hysteresis loop or a
  repeated sweep has x that turns around; sorting it by x (which is what
  interpolation needs) merges the branches. ``unsorted="sort"`` opts in and is
  reported. A monotonic DESCENDING x is fine (it is only reversed).
- **Repeated x is averaged** (``resample_data``'s sanitizer) and reported.
- **Blank x rows are dropped; blank y values are skipped** (the interpolation
  bridges the gap) -- both reported, per channel.
- **Matching another dataset's x with a different x unit is refused** unless
  ``allow_unit_mismatch=True``, which reports it as a ``confirm`` warning.

A grid identical to the source x is ``resample_data``'s identity copy: nothing
is sorted, averaged or dropped, so none of those warnings are issued.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from ..datastruct import DataStruct
from ..x_units import x_unit_of
from .resample import _colon, resample_data

__all__ = ["MAX_GRID_POINTS", "AlignResult", "align_resample", "x_unit_of"]

#: A target grid larger than this is almost certainly a typo'd step; refusing
#: it keeps a preview request from allocating (and serializing) millions of rows.
MAX_GRID_POINTS = 500_000

_MODES = ("n_points", "step", "range", "match")


@dataclass(frozen=True)
class AlignResult:
    """The resampled dataset, the report, and the facts the report is about."""

    data: DataStruct
    warnings: list[dict[str, Any]] = field(default_factory=list)
    #: The source's finite x-range ``(lo, hi)``.
    source_range: tuple[float, float] = (math.nan, math.nan)
    #: Rows in / rows out.
    rows_in: int = 0
    rows_out: int = 0


def _warn(code: str, text: str, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"code": code, "text": text}
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


def _n(count: int, one: str, many: str | None = None) -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


def _fmt(v: float) -> str:
    return f"{v:.6g}"


def _check_count(n: float) -> int:
    if not math.isfinite(n) or n > MAX_GRID_POINTS:
        raise ValueError(
            f"the target grid would have more than {MAX_GRID_POINTS:,} points; "
            "use a larger step or fewer points"
        )
    return int(n)


def _positive(name: str, v: float | None) -> float:
    if v is None or not math.isfinite(v) or v <= 0:
        raise ValueError(f"{name} must be a positive finite number")
    return float(v)


def _target_grid(
    mode: str,
    lo: float,
    hi: float,
    *,
    n_points: int | None,
    step: float | None,
    start: float | None,
    stop: float | None,
    match_x: NDArray[np.float64] | None,
    warnings: list[dict[str, Any]],
) -> NDArray[np.float64]:
    """The target grid for this mode: ``resample_data``'s own ``linspace`` for
    ``n_points``, and its MATLAB-colon rule (``_colon``, endpoint snapped to
    exactly ``stop`` when it lands) for ``step`` / ``range``. The counts and
    out-of-range checks run on exactly the points that are then interpolated
    onto."""
    if mode == "n_points":
        if n_points is None or n_points < 2:
            raise ValueError("the number of points must be at least 2")
        return np.linspace(lo, hi, _check_count(n_points))
    if mode == "step":
        d = _positive("step", step)
        _check_count((hi - lo) / d + 1)
        return _colon(lo, d, hi)
    if mode == "range":
        if start is None or stop is None or not (math.isfinite(start) and math.isfinite(stop)):
            raise ValueError("start and stop must be finite numbers")
        if step is None or not math.isfinite(step) or step == 0:
            raise ValueError("step must be a non-zero finite number")
        if stop != start and (stop - start) * step < 0:
            raise ValueError(
                f"a step of {_fmt(step)} never reaches {_fmt(stop)} from {_fmt(start)}"
            )
        _check_count((stop - start) / step + 1)
        return _colon(float(start), float(step), float(stop))
    # match
    if match_x is None or match_x.size == 0:
        raise ValueError("the dataset to match has no x values")
    finite = np.isfinite(match_x)
    blank = int(match_x.size - finite.sum())
    if blank:
        has, be = ("has", "is") if blank == 1 else ("have", "are")
        warnings.append(
            _warn(
                "rows-dropped",
                f"{_n(blank, 'row')} of the dataset being matched {has} no x value and {be} "
                "left out of the grid.",
                count=blank,
            )
        )
    grid = np.asarray(match_x[finite], dtype=float)
    if grid.size == 0:
        raise ValueError("the dataset to match has no finite x values")
    _check_count(grid.size)
    return grid


def _reversals(xf: NDArray[np.float64]) -> tuple[int, bool]:
    """Direction changes of ``xf`` (ties ignored) and whether it descends."""
    d = np.diff(xf)
    s = np.sign(d[d != 0])
    if s.size == 0:
        return 0, False
    return int(np.count_nonzero(s[1:] != s[:-1])), bool(s[0] < 0)


def _source_warnings(
    data: DataStruct,
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    unsorted: str,
    warnings: list[dict[str, Any]],
) -> None:
    """Refuse or report what interpolation does to the source's rows."""
    finite_x = np.isfinite(x)
    blank_x = int(x.size - finite_x.sum())
    if blank_x:
        warnings.append(
            _warn(
                "rows-dropped",
                f"{_n(blank_x, 'row')} of the source {'has' if blank_x == 1 else 'have'} "
                f"no x value and {'is' if blank_x == 1 else 'are'} dropped.",
                count=blank_x,
            )
        )
    xf = x[finite_x]
    turns, descending = _reversals(xf)
    if turns:
        if unsorted != "sort":
            raise ValueError(
                f"x is not monotonic: it changes direction {_n(turns, 'time')} (a hysteresis "
                "loop or a repeated sweep?). Resampling sorts the rows by x, which merges the "
                "branches. Split the branches first, or choose to sort by x."
            )
        warnings.append(
            _warn(
                "reordered",
                f"x changes direction {_n(turns, 'time')}; the rows were sorted by x before "
                "interpolating, so separate branches (e.g. a loop's up and down sweeps) are "
                "merged.",
                count=turns,
            )
        )
    elif descending:
        warnings.append(
            _warn(
                "reordered",
                "The source x runs from high to low; the result follows the target grid's order.",
                info=True,
            )
        )
    dup = int(xf.size - np.unique(xf).size)
    if dup:
        warnings.append(
            _warn(
                "duplicate-x",
                f"{_n(dup, 'row')} {'repeats' if dup == 1 else 'repeat'} an x value already "
                "present; the values at each repeated x are averaged into one point.",
                count=dup,
            )
        )
    gaps: list[str] = []
    total = 0
    cats = data.cat_levels or {}
    for c in range(y.shape[1]):
        if c in cats:
            continue
        n_blank = int(np.count_nonzero(~np.isfinite(y[finite_x, c])))
        if n_blank:
            gaps.append(data.labels[c])
            total += n_blank
    if total:
        names = ", ".join(f'"{g}"' for g in gaps)
        warnings.append(
            _warn(
                "blank-values",
                f"{_n(total, 'blank value')} in {names} {'is' if total == 1 else 'are'} skipped; "
                "the interpolation bridges those gaps.",
                count=total,
                columns=gaps,
            )
        )


def align_resample(
    data: DataStruct,
    *,
    mode: str,
    n_points: int | None = None,
    step: float | None = None,
    start: float | None = None,
    stop: float | None = None,
    match_x: Any = None,
    match_x_unit: str = "",
    method: str = "linear",
    out_of_range: str = "nan",
    unsorted: str = "refuse",
    allow_unit_mismatch: bool = False,
) -> AlignResult:
    """Resample ``data`` onto a target grid, refusing or reporting every hazard.

    ``mode`` picks the grid: ``"n_points"`` (evenly spaced over the source's
    finite x-range), ``"step"`` (MATLAB ``lo:step:hi``), ``"range"`` (explicit
    ``start:step:stop``) or ``"match"`` (``match_x``, another dataset's x;
    blank entries are left out). ``method`` is any ``resample_data`` method.
    Raises ``ValueError`` with a user-facing message for a refused input.
    """
    if mode not in _MODES:
        raise ValueError(f"grid mode must be one of {_MODES}")
    if out_of_range not in ("nan", "clip"):
        raise ValueError('out_of_range must be "nan" or "clip"')
    if unsorted not in ("refuse", "sort"):
        raise ValueError('unsorted must be "refuse" or "sort"')
    x = np.asarray(data.time, dtype=float).ravel()
    y = np.asarray(data.values, dtype=float)
    if y.ndim == 1:
        y = y.reshape(-1, 1)
    finite_x = x[np.isfinite(x)]
    if np.unique(finite_x).size < 2:
        raise ValueError("the source needs at least 2 distinct finite x values")
    lo, hi = float(finite_x.min()), float(finite_x.max())
    warnings: list[dict[str, Any]] = []

    if mode == "match":
        src_unit, dst_unit = x_unit_of(data), match_x_unit.strip()
        if src_unit and dst_unit and src_unit != dst_unit:
            text = (
                f"X units differ: the source is in {src_unit} but the grid being matched is in "
                f"{dst_unit}. The grid is used as raw numbers, so points land at the wrong x."
            )
            if not allow_unit_mismatch:
                raise ValueError(text)
            warnings.append(_warn("unit-mismatch", text, confirm=True))
    mx = None if match_x is None else np.asarray(match_x, dtype=float).ravel()
    grid = _target_grid(
        mode,
        lo,
        hi,
        n_points=n_points,
        step=step,
        start=start,
        stop=stop,
        match_x=mx,
        warnings=warnings,
    )
    coincident = np.array_equal(x, grid)
    if not coincident:
        _source_warnings(data, x, y, unsorted, warnings)

    outside = (grid < lo) | (grid > hi)
    n_out = int(np.count_nonzero(outside))
    if n_out:
        span = f"[{_fmt(lo)}, {_fmt(hi)}]"
        if out_of_range == "clip":
            grid = grid[~outside]
            if grid.size == 0:
                raise ValueError(f"no target point lies inside the source x-range {span}")
            fate = "dropped from the grid"
        else:
            fate = "left blank (no extrapolation)"
        warnings.append(
            _warn(
                "out-of-range",
                f"{n_out} of {outside.size} target points "
                f"{'lies' if n_out == 1 else 'lie'} outside the source x-range "
                f"{span} and {'is' if n_out == 1 else 'are'} {fate}.",
                count=n_out,
            )
        )

    # Every mode has already built its own exact grid above -- `grid` for
    # n_points is resample_data's own linspace bit-for-bit (same lo/hi), so
    # passing it explicitly rather than re-deriving it from `n_points` is a
    # no-op; every mode now shares one call.
    out = resample_data(data, grid=grid, method=method)

    # Blank OUTPUT inside the source range: a channel whose own finite data
    # stops short of the range (NaN at its ends) or has < 2 usable points.
    # A coincident grid never blanks output -- it's `resample_data`'s own
    # identity copy -- so skip the scan entirely rather than repeat the check
    # per column.
    short: list[tuple[str, int]] = []
    if not coincident:
        inside = (np.asarray(out.time) >= lo) & (np.asarray(out.time) <= hi)
        vals = np.asarray(out.values, dtype=float).reshape(out.time.size, -1)
        for c in range(vals.shape[1]):
            if c in (data.cat_levels or {}):
                continue
            k = int(np.count_nonzero(~np.isfinite(vals[inside, c])))
            if k:
                short.append((data.labels[c], k))
    if short:
        warnings.append(
            _warn(
                "blank-output",
                "Inside the source x-range, some resampled values are blank because the "
                "channel has no data there: "
                + ", ".join(f'"{name}" {k}' for name, k in short)
                + ".",
                count=sum(k for _, k in short),
                columns=[name for name, _ in short],
            )
        )

    meta = dict(out.metadata)
    meta["resampleMode"] = mode
    meta["resampleOutOfRange"] = out_of_range
    out = DataStruct.create(
        out.time,
        out.values,
        labels=out.labels,
        units=out.units,
        metadata=meta,
        cat_levels=out.cat_levels,
        level_order=out.level_order,
    )
    return AlignResult(
        data=out,
        warnings=warnings,
        source_range=(lo, hi),
        rows_in=int(x.size),
        rows_out=int(out.time.size),
    )
