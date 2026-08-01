"""Pure min/max-bucket decimation for dense plot series.

Server-side twin of the frontend's window-aware decimation
(``frontend/src/lib/plotDecimate.ts``'s ``decimateRowIndices``/
``seriesBucketIndices``) -- used by ``routes/plot.py`` to shrink
``/api/plot/series`` payloads to the client's actual draw contract (a target
pixel-width / bucket-count hint) BEFORE they cross the wire, instead of
shipping every raw row and letting the browser discard most of it after
paying the network + JSON-parse cost (P3.4, docs/performance_envelope.md:
78 MB of JSON for a 1M-row x 7-channel plot).

Pure layer: ndarray in -> ndarray out, no fastapi/pydantic imports.

Algorithm (mirrors the frontend exactly, so a decimated payload draws
IDENTICALLY to full data in uPlot at the requested resolution): the row
range ``[0, n)`` is split into ``buckets`` contiguous index buckets (``n /
buckets`` rows each, the last bucket absorbing the float-truncation
remainder); each series independently contributes the ROW INDEX of its own
min-y and max-y sample within each bucket (non-finite values are ignored; an
all-non-finite bucket contributes nothing; a bucket whose extrema coincide --
e.g. a constant run, or a single finite sample -- contributes one index, not
two). The final row set is the ascending, deduped UNION of every series' own
picks, so every column (x + every series) can be gathered by the SAME
row-index set and stay index-aligned -- one series' spike is never smoothed
away by another series' bucket picks, and a spike narrower than a bucket
still survives (it IS that bucket's min or max). A short series (n <=
buckets) is returned unchanged -- nothing to gain by bucketing fewer rows
than buckets.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

__all__ = ["decimate_columns", "decimate_row_indices", "is_ascending", "window_columns"]


def _series_bucket_indices(y: NDArray[np.float64], bucket_count: int) -> list[int]:
    """Row indices of the min-y and max-y sample per bucket over ``[0, n)``.

    ``bucket_count`` is assumed already clamped to ``[1, n]`` by the caller.
    """
    n = y.shape[0]
    out: list[int] = []
    bucket_size = n / bucket_count
    for b in range(bucket_count):
        start = int(b * bucket_size)
        end = n if b == bucket_count - 1 else int((b + 1) * bucket_size)
        if end <= start:
            continue  # float-truncation can yield an empty bucket; JS skips it too
        chunk = y[start:end]
        finite = np.isfinite(chunk)
        if not finite.any():
            continue  # nothing plottable in this bucket
        masked = np.where(finite, chunk, np.nan)
        # nanargmin/nanargmax return the FIRST occurrence on ties, matching
        # the frontend's strict-`<`/`>` scan (first min/max wins).
        min_idx = start + int(np.nanargmin(masked))
        max_idx = start + int(np.nanargmax(masked))
        if min_idx == max_idx:
            out.append(min_idx)
        else:
            out.append(min_idx)
            out.append(max_idx)
    return out


def decimate_row_indices(series: Sequence[NDArray[np.float64]], buckets: int) -> NDArray[np.intp]:
    """The ascending, deduped union of every series' own min/max bucket picks.

    Mirrors the frontend's ``decimateRowIndices`` exactly: row-index
    bucketing (not x-value bucketing), per-series extrema, union across
    series -- so no series' spike is smoothed away by another series' picks.
    Every array in ``series`` must share the same length ``n`` (the caller's
    row count); an empty ``series`` sequence returns an empty index array
    (nothing to decimate against). ``buckets <= 0`` is treated as 1 (a
    single bucket, matching the frontend's ``Math.max(1, ...)`` clamp).
    """
    if not series:
        return np.array([], dtype=np.intp)
    n = series[0].shape[0]
    if n <= 0:
        return np.array([], dtype=np.intp)
    bucket_count = max(1, min(buckets, n))
    if n <= bucket_count:
        return np.arange(n, dtype=np.intp)
    picked: set[int] = set()
    for y in series:
        picked.update(_series_bucket_indices(y, bucket_count))
    return np.array(sorted(picked), dtype=np.intp)


def decimate_columns(
    x: NDArray[np.float64],
    series: Sequence[NDArray[np.float64]],
    buckets: int,
) -> tuple[NDArray[np.float64], list[NDArray[np.float64]]]:
    """Gather ``x`` and every column of ``series`` by the shared decimated
    row-index set (:func:`decimate_row_indices`), keeping every column
    index-aligned. ``series`` empty (an x-only payload) returns ``x``
    unchanged -- there is no y column to pick extrema from, so there is no
    principled way to decimate that isn't arbitrary.
    """
    if not series:
        return x, []
    rows = decimate_row_indices(series, buckets)
    return x[rows], [s[rows] for s in series]


def window_columns(
    x: NDArray[np.float64],
    series: Sequence[NDArray[np.float64]],
    x_min: float,
    x_max: float,
) -> tuple[NDArray[np.float64], list[NDArray[np.float64]]]:
    """Filter ``x`` and every column of ``series`` to the rows whose ``x``
    falls within ``[x_min, x_max]`` (inclusive; the two bounds are taken
    low-to-high regardless of argument order, mirroring the frontend's
    ``plotdata.ts`` ``clampPlottedRange``).

    P3.4 zoom-refetch residual: ``routes/plot.py`` calls this BEFORE
    :func:`decimate_columns` when a request carries a committed view window,
    so the bucketing below re-derives extrema over only the visible rows
    instead of the whole series -- that is what lets a zoomed-in re-fetch
    recover full local detail rather than reshowing the full-range envelope.

    A non-finite ``x`` can never satisfy a real-valued bound comparison, so
    those rows are dropped from a windowed response -- the same choice
    ``is_ascending`` already makes (skip non-finite gaps rather than invent a
    membership answer for them). A window wider than the data's own extent is
    a no-op (every row with a finite x survives); a window that matches no
    rows returns empty arrays -- a legitimate "nothing here" answer, not an
    error, left to the caller to interpret.
    """
    lo, hi = (x_min, x_max) if x_min <= x_max else (x_max, x_min)
    mask = np.isfinite(x) & (x >= lo) & (x <= hi)
    return x[mask], [s[mask] for s in series]


def is_ascending(x: NDArray[np.float64]) -> bool:
    """Whether ``x`` is monotonically non-decreasing, skipping non-finite
    gaps -- mirrors the frontend's ``uplotOpts.ts`` ``xIsAscending`` (a null
    there is a NaN here). A non-monotonic x (e.g. a hysteresis-loop sweep)
    renders via the acquisition-order path instead of a simple left-to-right
    line, and index-bucketing does not preserve that path's shape -- so
    ``routes/plot.py`` refuses to decimate in that case, independent of what
    the client requests, and returns full resolution instead.
    """
    finite = x[np.isfinite(x)]
    if finite.size < 2:
        return True
    return bool(np.all(np.diff(finite) >= 0))
