"""The shared Y domain of an x-broken export, exactly the screen's.

The canvas gives every segment of an axis break ONE y range: the min and max
of every finite value of every shown series across all segments, unpadded
(``frontend/src/lib/facetDomains.ts`` ``sharedYDomain``; a log or reciprocal
axis skips values <= 0, which it cannot draw). matplotlib's own autoscale
pads that range by 5 %, so the export used to start and end a little outside
the screen. ``shared_y_domain`` computes the screen's range from the same
rows; ``tests/fixtures/wire/break_y_domain.json`` pins screen == export.
Pure layer: arrays in, a pair of floats out.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from numpy.typing import ArrayLike, NDArray


def shared_y_domain(
    x: NDArray[np.float64],
    series: Sequence[tuple[str, ArrayLike]],
    bounds: Sequence[tuple[float, float]],
    *,
    positive_only: bool = False,
) -> tuple[float, float] | None:
    """``(min, max)`` over the rows each segment in ``bounds`` shows, or
    ``None`` when there is no finite value or the range is a single value
    (the caller then leaves matplotlib's autoscale, which widens a flat line;
    uPlot does the same)."""
    shown = np.zeros(x.shape, dtype=bool)
    for lo, hi in bounds:
        shown |= (x >= lo) & (x <= hi)
    lo_v, hi_v = np.inf, -np.inf
    for _label, y in series:
        v = np.asarray(y, dtype=float)[shown]
        v = v[np.isfinite(v)]
        if positive_only:
            v = v[v > 0]
        if v.size:
            lo_v, hi_v = min(lo_v, float(v.min())), max(hi_v, float(v.max()))
    return (lo_v, hi_v) if lo_v < hi_v else None
