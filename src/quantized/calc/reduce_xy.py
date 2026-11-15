"""Reduce XY: real data operations that make a NEW, smaller dataset (gap audit 4,
G7). Unlike ``calc/decimate.py`` (plot-only thinning), the output rows are data.

* :func:`bin_average` -- group rows into X bins (width or count), mean or
  median per channel, optional SD and count columns.
* :func:`average_duplicates` -- collapse rows that repeat an X value.
* :func:`keep_every_nth` -- keep every Nth row (any order, nothing numeric
  changes).

NON-MONOTONIC X POLICY (decided, not incidental): binning and duplicate-
averaging are **refused** when X reverses direction (a hysteresis loop, a
there-and-back sweep). The up and down branches visit the same X with different
Y, so a bin or a duplicate group spanning both would silently average the two
branches into one meaningless curve, and sorting to "fix" it would destroy the
acquisition order. Refusing is robust (branch detection on noisy sweeps is
fragile) and says what to do: split the branches first (Split by column), then
reduce each. Non-strict monotone X (repeated values, as in a PPMS/VSM sweep that
dwells at each field) is fine -- that is exactly the duplicate use case.
``keep_every_nth`` never looks at X, so it works on loops.
"""

from __future__ import annotations

import math
import warnings
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray

from ..cat_levels import surviving_level_order
from ..datastruct import DataStruct
from ..row_sidecars import drop_row_sidecars, slice_row_sidecars

__all__ = ["average_duplicates", "bin_average", "keep_every_nth"]

Stat = Literal["mean", "median"]


def _require_monotonic(x: NDArray[np.float64]) -> None:
    d = np.diff(x)
    if not (bool(np.all(d >= 0)) or bool(np.all(d <= 0))):
        raise ValueError(
            "Reduce is refused: X reverses direction (a loop or there-and-back sweep), so a "
            "group could mix the up and down branches. Split the branches first, or use "
            "'keep every Nth row', which ignores X"
        )


def _clean(
    data: DataStruct, channels: list[int] | None
) -> tuple[NDArray[np.float64], NDArray[np.float64], list[int], int]:
    if data.cat_levels:
        names = ", ".join(data.labels[c] for c in data.cat_levels)
        raise ValueError(f"cannot average categorical channel(s): {names}; pick numeric channels")
    x = np.asarray(data.time, dtype=float).ravel()
    vals = np.asarray(data.values, dtype=float)
    if vals.ndim == 1:
        vals = vals.reshape(-1, 1)
    chans = list(range(vals.shape[1])) if channels is None else list(channels)
    if not chans or any(not 0 <= c < vals.shape[1] for c in chans):
        raise ValueError("choose at least one valid channel")
    keep = np.isfinite(x)
    dropped = int((~keep).sum())
    x, vals = x[keep], vals[keep]
    if x.size < 2:
        raise ValueError("need at least 2 rows with a finite X")
    _require_monotonic(x)
    return x, vals, chans, dropped


def _group(
    data: DataStruct,
    x: NDArray[np.float64],
    vals: NDArray[np.float64],
    chans: list[int],
    groups: NDArray[np.intp],
    *,
    stat: Stat,
    with_sd: bool,
    with_count: bool,
    centres: NDArray[np.float64] | None,
    meta_extra: dict[str, Any],
) -> DataStruct:
    """One output row per run of equal group id, in source order. Because X is
    monotonic, bins and duplicate groups are CONTIGUOUS runs, so everything is a
    single O(n) ``reduceat`` pass. ``centres[g]`` (when given) is the X written
    for group ``g``; otherwise the run's mean X. Counts, means and SDs use the
    finite values of each channel separately."""
    starts = np.flatnonzero(np.concatenate([[True], np.diff(groups) != 0]))
    lens = np.diff(np.append(starts, groups.size)).astype(float)
    if centres is not None:
        xo = np.asarray(centres[groups[starts]], dtype=float)
    else:
        xo = np.asarray(np.add.reduceat(x, starts) / lens, dtype=float)
    means: list[NDArray[np.float64]] = []
    sds: list[NDArray[np.float64]] = []
    counts: list[NDArray[np.float64]] = []
    for c in chans:
        v = vals[:, c]
        fin = np.isfinite(v)
        vz = np.where(fin, v, 0.0)
        cnt = np.add.reduceat(fin.astype(float), starts)
        mu = np.where(cnt > 0, np.add.reduceat(vz, starts) / np.maximum(cnt, 1.0), np.nan)
        centre = mu
        if stat == "median":
            centre = np.array(
                [
                    float(np.median(seg[np.isfinite(seg)])) if np.isfinite(seg).any() else math.nan
                    for seg in np.split(v, starts[1:])
                ]
            )
        dev = np.where(fin, v - np.repeat(mu, lens.astype(int)), 0.0)  # SD is about the mean
        ss = np.add.reduceat(dev**2, starts)
        sd = np.where(cnt > 1, np.sqrt(ss / np.maximum(cnt - 1, 1.0)), np.nan)
        means.append(np.asarray(centre, dtype=float))
        sds.append(np.asarray(sd, dtype=float))
        counts.append(np.asarray(cnt, dtype=float))
    out_cols = list(means)
    labels = [data.labels[c] for c in chans]
    units = [data.units[c] for c in chans]
    if with_sd:
        out_cols += sds
        labels += [f"{data.labels[c]} SD" for c in chans]
        units += [data.units[c] for c in chans]
    if with_count:
        out_cols += counts
        labels += [f"{data.labels[c]} N" for c in chans]
        units += [""] * len(chans)
    meta = drop_row_sidecars(data.metadata)
    meta["reduceXY"] = meta_extra
    return DataStruct.create(
        xo,
        np.column_stack(out_cols),
        labels=labels,
        units=units,
        metadata=meta,
    )


def bin_average(
    data: DataStruct,
    *,
    bin_width: float | None = None,
    n_bins: int | None = None,
    stat: Stat = "mean",
    channels: list[int] | None = None,
    with_sd: bool = False,
    with_count: bool = False,
    x_mode: Literal["mean", "center"] = "mean",
) -> DataStruct:
    """Bin-average by X. Give ``bin_width`` or ``n_bins`` (not both). Bins start
    at the smallest X; the last bin is closed on the right (X = max never
    becomes a lone extra bin). Empty bins emit no
    row. ``x_mode`` puts each output row at the mean X of its points or at the
    bin centre. ``stat`` is ``mean`` or ``median``; SD is the sample SD (NaN for
    a single point)."""
    if stat not in ("mean", "median"):
        raise ValueError("stat must be mean or median")
    if x_mode not in ("mean", "center"):
        raise ValueError("x_mode must be mean or center")
    if (bin_width is None) == (n_bins is None):
        raise ValueError("give exactly one of bin width or number of bins")
    x, vals, chans, dropped = _clean(data, channels)
    lo, hi = float(x.min()), float(x.max())
    span = hi - lo
    if span <= 0:
        raise ValueError("X has no spread to bin")
    if bin_width is not None:
        if not (math.isfinite(bin_width) and bin_width > 0):
            raise ValueError("bin width must be positive")
        width = float(bin_width)
        n = max(1, int(math.ceil(span / width - 1e-9)))
    else:
        assert n_bins is not None
        if int(n_bins) != n_bins or n_bins < 1:
            raise ValueError("number of bins must be a positive integer")
        n = int(n_bins)
        width = span / n
    if n > 5_000_000:
        raise ValueError("that bin width gives more than 5 million bins")
    idx = np.minimum(np.floor((x - lo) / width + 1e-12).astype(np.intp), n - 1)
    centres: NDArray[np.float64] | None = None
    if x_mode == "center":
        centres = np.asarray(lo + (np.arange(n) + 0.5) * width, dtype=float)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return _group(
            data,
            x,
            vals,
            chans,
            idx,
            stat=stat,
            with_sd=with_sd,
            with_count=with_count,
            centres=centres,
            meta_extra={
                "method": "bin",
                "binWidth": width,
                "bins": n,
                "stat": stat,
                "rowsIn": int(x.size),
                "droppedNonFiniteX": dropped,
            },
        )


def _anchored_groups(x: NDArray[np.float64], tolerance: float) -> NDArray[np.intp]:
    """Group ids: a row joins the current group while it is within ``tolerance``
    of the group's FIRST X (not of the previous row, which would chain a slow
    sweep into one group)."""
    if tolerance == 0:
        return np.asarray(np.cumsum(np.concatenate([[True], np.diff(x) != 0])) - 1, dtype=np.intp)
    ids = np.zeros(x.size, dtype=np.intp)
    anchor, gid = x[0], 0
    for i in range(1, x.size):
        if abs(x[i] - anchor) > tolerance:
            gid += 1
            anchor = x[i]
        ids[i] = gid
    return ids


def average_duplicates(
    data: DataStruct,
    *,
    stat: Stat = "mean",
    channels: list[int] | None = None,
    with_sd: bool = False,
    with_count: bool = False,
    tolerance: float = 0.0,
) -> DataStruct:
    """Average rows whose X repeats. Equal means within ``tolerance`` of the
    group's first X (default exact); non-consecutive repeats are NOT merged
    (see the module note on loops)."""
    if stat not in ("mean", "median"):
        raise ValueError("stat must be mean or median")
    if not (math.isfinite(tolerance) and tolerance >= 0):
        raise ValueError("tolerance must be zero or positive")
    x, vals, chans, dropped = _clean(data, channels)
    groups = _anchored_groups(x, tolerance)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return _group(
            data,
            x,
            vals,
            chans,
            groups,
            stat=stat,
            with_sd=with_sd,
            with_count=with_count,
            centres=None,
            meta_extra={
                "method": "duplicates",
                "stat": stat,
                "tolerance": tolerance,
                "rowsIn": int(x.size),
                "droppedNonFiniteX": dropped,
            },
        )


def keep_every_nth(data: DataStruct, *, n: int, offset: int = 0) -> DataStruct:
    """Keep rows ``offset, offset+n, ...`` (every column, original order; works
    on loops and categorical data alike)."""
    if int(n) != n or n < 1:
        raise ValueError("N must be a positive integer")
    if int(offset) != offset or not 0 <= offset < max(1, data.time.size):
        raise ValueError("offset must be a row number inside the data")
    rows = np.arange(int(offset), data.time.size, int(n))
    vals = np.asarray(data.values, dtype=float)
    if vals.ndim == 1:
        vals = vals.reshape(-1, 1)
    meta = slice_row_sidecars(data.metadata, rows.tolist())
    meta["reduceXY"] = {
        "method": "every-nth",
        "n": int(n),
        "offset": int(offset),
        "rowsIn": int(data.time.size),
    }
    return DataStruct.create(
        np.asarray(data.time, dtype=float)[rows],
        vals[rows],
        labels=data.labels,
        units=data.units,
        metadata=meta,
        cat_levels=data.cat_levels,
        level_order=surviving_level_order(data.level_order, data.cat_levels, False),
    )
