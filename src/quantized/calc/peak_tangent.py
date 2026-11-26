"""Tangential baseline for peak integration.

Pure calc layer. The baseline of a peak sitting on a curved or sloping
background is the straight line that is *tangent to the data on both sides of
the peak* (Origin's "tangent" baseline for peak integration).

Exact construction, for the points of one integration window (sorted by x):

1. Let ``p`` be the apex, the first index of the maximum ``y`` in the window.
2. Build the LOWER convex hull of the window's points (Andrew's monotone
   chain; collinear points are dropped, so hull vertices are the points the
   string pulled taut under the curve touches).
3. The tangent line is the supporting line of that hull on the hull edge
   ``(L, R)`` whose x-span contains the apex: ``x[L] < x[p] < x[R]``.
   Equivalently: the unique line that lies on or below every point of the
   window and touches the data once on the left flank and once on the right
   flank (the common tangent of the two flanks).

Because the line is a supporting line, ``y - line >= 0`` everywhere in the
window, so the net area is never negative. A window whose apex is its first or
last point has no flank on one side and is refused, as is a window with no
peak (flat ``y``).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["lower_hull", "tangent_baseline"]


def _cross(
    x: NDArray[np.float64], y: NDArray[np.float64], o: int, a: int, b: int
) -> float:
    return float((x[a] - x[o]) * (y[b] - y[o]) - (y[a] - y[o]) * (x[b] - x[o]))


def lower_hull(x: NDArray[np.float64], y: NDArray[np.float64]) -> list[int]:
    """Indices of the lower convex hull of points sorted by increasing ``x``."""
    hull: list[int] = []
    for i in range(x.size):
        while len(hull) >= 2 and _cross(x, y, hull[-2], hull[-1], i) <= 0.0:
            hull.pop()
        hull.append(i)
    return hull


def tangent_baseline(
    x: ArrayLike, y: ArrayLike
) -> tuple[NDArray[np.float64], tuple[int, int]]:
    """Tangent baseline of one window.

    ``x`` must be increasing and ``y`` the same length (at least 3 points).
    Returns ``(baseline, (left, right))``: the line evaluated at ``x`` and the
    window indices of the two tangent points. Raises ``ValueError`` when the
    window has no interior apex (see the module docstring).
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    if xv.size < 3:
        raise ValueError("a tangent baseline needs at least 3 points")
    if not (np.all(np.isfinite(xv)) and np.all(np.isfinite(yv))):
        raise ValueError("a tangent baseline needs finite x and y")
    apex = int(np.argmax(yv))
    if apex == 0 or apex == xv.size - 1:
        raise ValueError(
            "the tallest point of the window is at its edge, so there is no flank "
            "on one side to draw a tangent to; widen the window around the peak"
        )
    hull = lower_hull(xv, yv)
    for a, b in zip(hull[:-1], hull[1:], strict=True):
        if a < apex < b and xv[b] > xv[a]:
            slope = (yv[b] - yv[a]) / (xv[b] - xv[a])
            base = np.asarray(yv[a] + slope * (xv - xv[a]), dtype=float)
            return base, (a, b)
    # The apex is itself a hull vertex only when the window is flat around it.
    raise ValueError("no tangent line spans the peak apex; the window has no peak shape")
