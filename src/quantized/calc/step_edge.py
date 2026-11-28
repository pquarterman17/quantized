"""Reference-level instants for an edge: where a noisy step passes a level.

Pure calc layer (numpy only). Used by ``curve_measure.step_time``.

A noisy step crosses a reference level (say the 10 % level) several times in a
burst. Taking the first or the last of them biases the rise time: the last
10 % crossing and the first 90 % crossing shrink it (about 17 % on a step
whose noise is 4 % of its height). Method, in the spirit of IEEE 181: the
transition window runs from the last sample at or below the base level
(before the edge closes) to the first later sample at or above the top level.
Inside that window each reference level's instant is the *median* of the X
positions where the interpolated curve passes through it, in either
direction. A clean step crosses each level once, so the median is that
crossing exactly. Crossings outside the window (noise riding on a plateau) are
ignored.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

__all__ = ["median_up_edge"]


def _median_crossing(
    x: NDArray[np.float64], y: NDArray[np.float64], level: float, lo: int, hi: int
) -> float:
    """Median X of every passage of ``level`` by the segments lo..hi (inclusive samples)."""
    a, b = y[lo:hi], y[lo + 1 : hi + 1]
    hit = ((a <= level) & (level < b)) | ((a >= level) & (level > b))
    k = np.flatnonzero(hit) + lo
    dy = y[k + 1] - y[k]
    xs = x[k] + (level - y[k]) / dy * (x[k + 1] - x[k])
    return float(np.median(xs))


def median_up_edge(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    start: float,
    end: float,
    base: float,
    top: float,
) -> tuple[float, float] | None:
    """Rising edge from ``start`` up to ``end`` (start < end) as (x_start, x_end), or None.

    ``base`` and ``top`` are the plateau levels that bound the transition window.
    Returns None when the curve never goes from at-or-below ``start`` to at-or-above ``end``.
    """
    below = np.flatnonzero(y <= start)
    if below.size == 0:
        return None
    i0 = int(below[0])
    above = np.flatnonzero(y[i0:] >= end)
    if above.size == 0:
        return None
    j = i0 + int(above[0])
    low_idx = np.flatnonzero(y[i0 : j + 1] <= base)
    k_a = i0 + int(low_idx[-1]) if low_idx.size else i0
    high_idx = np.flatnonzero(y[k_a:] >= top)
    k_b = k_a + int(high_idx[0]) if high_idx.size else j
    k_b = max(k_b, j)
    return (
        _median_crossing(x, y, start, k_a, k_b),
        _median_crossing(x, y, end, k_a, k_b),
    )
