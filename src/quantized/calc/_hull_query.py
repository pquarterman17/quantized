"""Convex-hull pre-mask for scattered linear queries.

scipy's ``Delaunay.find_simplex`` walks from simplex to simplex towards a
query point. A point OUTSIDE the convex hull defeats the walk, and scipy then
scans every simplex. A PIXcel3D snapshot RSM is a diagonal band (the 2theta
window moves with omega), so most of its bounding-box output grid is outside
the hull: the default 200x200 map of a 1827-frame snapshot spent ~49 s there
and blocked the server (plot-correctness audit, 2026-10-02).

Testing the queries first against a triangulation of the hull VERTICES only
(a few simplices) and sending only the inside points to the full
triangulation gives the same answer, because linear interpolation is NaN
outside the hull either way.

Split out of ``calc/interp2d.py`` (500-line module ceiling). Pure layer.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import ConvexHull, Delaunay
from scipy.spatial._qhull import QhullError

__all__ = ["inside_hull"]


def inside_hull(pts: NDArray[np.float64], qpts: NDArray[np.float64]) -> NDArray[np.bool_] | None:
    """Per query point: inside (or on) the convex hull of ``pts``.

    ``None`` when Qhull cannot build a hull (collinear or coincident points);
    the caller keeps its own degenerate-input handling for that case.
    """
    try:
        hull = ConvexHull(pts)
        hull_tri = Delaunay(pts[hull.vertices])
    except QhullError:
        return None
    return np.asarray(hull_tri.find_simplex(qpts) >= 0, dtype=bool)

