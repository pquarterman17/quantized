"""Cells against a convex hull: which ones touch it, and where (pure numpy).

Plan item 21, the heatmap's hull edge. The heatmap draws small triangular
cells and clips them to the data's convex hull. Dropping every cell whose
centroid lies outside the hull leaves a staircase along the edge; instead a
cell that only *partly* overlaps the hull is kept (the clip path trims it).
Such a cell has no surface value at its own centroid, so it takes the value at
the centroid of ``cell ∩ hull`` -- a point inside the hull, never an
extrapolation.

``hull`` is an (h, 2) array of vertices in counter-clockwise order (what
``TernarySurface.hull_xy`` returns).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

__all__ = ["clip_to_hull", "overlaps_hull"]

Floats = NDArray[np.float64]
_EPS = 1e-12


def _cross(o: Floats, a: Floats, b: Floats) -> Floats:
    return np.asarray(
        (a[..., 0] - o[..., 0]) * (b[..., 1] - o[..., 1])
        - (a[..., 1] - o[..., 1]) * (b[..., 0] - o[..., 0]),
        dtype=float,
    )


def overlaps_hull(cells: Floats, hull: Floats) -> NDArray[np.bool_]:
    """Which triangles ``(m, 3, 2)`` share positive area with the convex hull.

    Separating-axis test over the hull's edges and each cell's edges; cells
    that merely touch the boundary do not count.
    """
    m = cells.shape[0]
    apart = np.zeros(m, dtype=bool)
    h = hull.shape[0]
    for i in range(h):  # a hull edge separates when every cell vertex is outside it
        a, b = hull[i], hull[(i + 1) % h]
        apart |= (_cross(a, b, cells) <= _EPS).all(axis=1)
    ccw = _cross(cells[:, 0], cells[:, 1], cells[:, 2]) >= 0
    for i in range(3):  # a cell edge separates when every hull vertex is outside it
        a, b = cells[:, i], cells[:, (i + 1) % 3]
        # outside the edge = on the right of it for a ccw cell, left for cw
        side = _cross(a[:, None, :], b[:, None, :], hull[None, :, :])
        side = np.where(ccw[:, None], side, -side)
        apart |= (side <= _EPS).all(axis=1)
    return ~apart


def clip_to_hull(poly: Floats, hull: Floats) -> Floats:
    """Sutherland-Hodgman: ``poly`` (k, 2) clipped to the convex ``hull``.

    Returns the clipped polygon (possibly empty, shape ``(0, 2)``).
    """
    out = [tuple(p) for p in poly]
    h = hull.shape[0]
    for i in range(h):
        a, b = hull[i], hull[(i + 1) % h]
        src, out = out, []
        if not src:
            break
        for j, cur in enumerate(src):
            prev = src[j - 1]
            c_in = _side(a, b, cur) >= 0
            p_in = _side(a, b, prev) >= 0
            if c_in != p_in:
                out.append(_meet(a, b, prev, cur))
            if c_in:
                out.append(cur)
    return np.asarray(out, dtype=float).reshape(-1, 2)


def _side(a: Floats, b: Floats, p: tuple[float, ...]) -> float:
    return float((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))


def _meet(a: Floats, b: Floats, p: tuple[float, ...], q: tuple[float, ...]) -> tuple[float, float]:
    sp, sq = _side(a, b, p), _side(a, b, q)
    t = sp / (sp - sq)
    return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))
