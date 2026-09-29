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


def _bucket_layout(n: int, bucket_count: int) -> tuple[NDArray[np.intp], NDArray[np.intp]]:
    """``(starts, bucket_id)`` for the non-empty buckets over ``[0, n)``.

    Bucket ``b`` spans ``[int(b * n / bucket_count), int((b + 1) * n /
    bucket_count))`` (the last one ends at ``n``) -- the frontend's own float
    boundaries, computed with the same IEEE multiply so every edge lands on
    the same row. Consecutive buckets therefore share an edge, so the kept
    ``starts`` alone describe every segment, which is what ``reduceat``
    wants; a float-truncation-empty bucket (JS skips it too) is dropped.
    ``bucket_id[i]`` is the kept-bucket index of row ``i``.
    """
    bucket_size = n / bucket_count
    starts = (np.arange(bucket_count, dtype=np.float64) * bucket_size).astype(np.intp)
    starts = starts[np.diff(starts, append=n) > 0]
    lengths = np.diff(starts, append=n)
    return starts, np.repeat(np.arange(starts.size, dtype=np.intp), lengths)


def _first_hit_per_bucket(hit: NDArray[np.bool_], bucket_id: NDArray[np.intp]) -> NDArray[np.intp]:
    """The first ``True`` row of ``hit`` within each bucket that has one."""
    rows = np.flatnonzero(hit)
    ids = bucket_id[rows]
    first = np.ones(rows.size, dtype=bool)
    first[1:] = ids[1:] != ids[:-1]
    return rows[first]


def _series_bucket_indices(
    y: NDArray[np.float64], starts: NDArray[np.intp], bucket_id: NDArray[np.intp]
) -> list[NDArray[np.intp]]:
    """Row indices of the min-y and max-y sample per bucket, vectorized.

    One ``reduceat`` per extremum replaces the old per-bucket Python loop
    (~11k-27k numpy calls per request; at 100k rows the decimated request was
    slower than full resolution). Non-finite values are masked to the
    identity of each reduction (``+inf`` for min, ``-inf`` for max) and then
    excluded from the hit test, so an all-non-finite bucket contributes
    nothing. The FIRST row equal to the bucket's extremum wins, matching
    ``nanargmin``/``nanargmax`` and the frontend's strict-``<``/``>`` scan
    (``-0.0 == 0.0`` there too). A bucket whose min and max land on one row
    contributes it once, via the caller's union.
    """
    finite = np.isfinite(y)
    lo = np.where(finite, y, np.inf)
    hi = np.where(finite, y, -np.inf)
    mins = np.minimum.reduceat(lo, starts)[bucket_id]
    maxs = np.maximum.reduceat(hi, starts)[bucket_id]
    return [
        _first_hit_per_bucket((lo == mins) & finite, bucket_id),
        _first_hit_per_bucket((hi == maxs) & finite, bucket_id),
    ]


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
    starts, bucket_id = _bucket_layout(n, bucket_count)
    picks = [p for y in series for p in _series_bucket_indices(y, starts, bucket_id)]
    return np.unique(np.concatenate(picks)).astype(np.intp, copy=False)


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
