"""Sibson natural-neighbour interpolation (pure; scipy.spatial only, no GPL).

MATLAB ``scatteredInterpolant`` 'natural' (and 'cubic', which it aliases to
'natural') use Sibson's natural-neighbour interpolation. scipy has no
equivalent, so this implements it directly from the Delaunay triangulation via
the local Bowyer-Watson "stolen area" construction:

  Inserting a query point ``q`` into the Voronoi diagram of the data carves a
  new cell out of the existing ones. The Sibson coordinate of data point ``p``
  is the area ``q``'s new cell steals from ``p``'s old cell, normalised by the
  total new-cell area. The interpolated value is the weighted sum
  ``sum_i lambda_i * z_i``.

Sibson coordinates are *geometrically* unique (they depend only on the point
configuration, not on any tie-breaking), so this matches MATLAB's 'natural' to
~1e-9 at non-degenerate interior points. The interpolant has **linear
precision** — it reproduces any affine ``z = a*x + b*y + c`` exactly — which the
tests assert to machine precision.

The work per query is *local* (only the few triangles whose circumcircle
contains ``q``, found by a BFS over Delaunay adjacency), so cost scales with the
query count, not N^2. The in-circle test reduces to a squared-distance compare
against precomputed circumradii; ``find_simplex`` is vectorised over all queries.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import Delaunay
from scipy.spatial._qhull import QhullError

__all__ = ["sibson_interpolate"]

_COINCIDE_TOL2 = 1e-18  # (distance)^2 below which a query is "at" a data node


def _circumcenters(
    a: NDArray[np.float64], b: NDArray[np.float64], c: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Vectorised circumcentres for triangle vertex arrays (each ``(T, 2)``)."""
    ax, ay = a[:, 0], a[:, 1]
    bx, by = b[:, 0], b[:, 1]
    cx, cy = c[:, 0], c[:, 1]
    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    return np.column_stack([ux, uy])


def _circumcenter1(
    a: NDArray[np.float64], b: NDArray[np.float64], q: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Circumcentre of a single triangle (a, b, q) — for new (inserted) triangles."""
    ax, ay = float(a[0]), float(a[1])
    bx, by = float(b[0]), float(b[1])
    qx, qy = float(q[0]), float(q[1])
    d = 2.0 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by))
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    q2 = qx * qx + qy * qy
    ux = (a2 * (by - qy) + b2 * (qy - ay) + q2 * (ay - by)) / d
    uy = (a2 * (qx - bx) + b2 * (ax - qx) + q2 * (bx - ax)) / d
    return np.array([ux, uy], dtype=float)


def _poly_area(pts: NDArray[np.float64]) -> float:
    """Area of a convex polygon given its (unordered) vertices.

    The stolen region is convex, so ordering vertices by angle about their
    centroid recovers the boundary; the shoelace formula then gives the area.
    """
    if pts.shape[0] < 3:
        return 0.0
    cen = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - cen[1], pts[:, 0] - cen[0])
    p = pts[np.argsort(ang)]
    x, y = p[:, 0], p[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def _linear_bary(
    q: NDArray[np.float64],
    simplex: NDArray[np.intp],
    points: NDArray[np.float64],
    values: NDArray[np.float64],
) -> float:
    """Barycentric (piecewise-linear) value in one triangle — degenerate fallback."""
    a, b, c = points[simplex[0]], points[simplex[1]], points[simplex[2]]
    mat = np.array([[a[0] - c[0], b[0] - c[0]], [a[1] - c[1], b[1] - c[1]]], dtype=float)
    try:
        lam = np.linalg.solve(mat, q - c)
    except np.linalg.LinAlgError:
        return float("nan")
    l0, l1 = float(lam[0]), float(lam[1])
    l2 = 1.0 - l0 - l1
    return (
        l0 * float(values[simplex[0]])
        + l1 * float(values[simplex[1]])
        + l2 * float(values[simplex[2]])
    )


def _sibson_one(
    q: NDArray[np.float64],
    s0: int,
    simplices: NDArray[np.intp],
    neighbors: NDArray[np.intp],
    points: NDArray[np.float64],
    values: NDArray[np.float64],
    centers: NDArray[np.float64],
    radii2: NDArray[np.float64],
) -> float:
    """Sibson-interpolated value at one query point (NaN outside the hull)."""
    if s0 < 0:
        return float("nan")  # outside convex hull → extrapolation 'none'

    # Query coincident with a data node → return that node's value exactly
    # (Sibson's new cell degenerates to zero area here, as at any data site).
    for vi in simplices[s0]:
        dx0 = q[0] - points[vi, 0]
        dy0 = q[1] - points[vi, 1]
        if dx0 * dx0 + dy0 * dy0 <= _COINCIDE_TOL2:
            return float(values[vi])

    # Cavity = triangles whose circumcircle contains q (squared-distance test).
    cavity: set[int] = set()
    stack = [s0]
    while stack:
        t = stack.pop()
        if t < 0 or t in cavity:
            continue
        if t != s0:
            dx = q[0] - centers[t, 0]
            dy = q[1] - centers[t, 1]
            if dx * dx + dy * dy >= radii2[t]:
                continue
        cavity.add(t)
        for nb in neighbors[t]:
            if nb >= 0 and nb not in cavity:
                stack.append(int(nb))

    try:
        # New Voronoi vertices: circumcentre of (edge, q) per cavity boundary edge.
        cc_new: dict[tuple[int, int], NDArray[np.float64]] = {}
        for t in cavity:
            tv = simplices[t]
            nbrs = neighbors[t]
            for i in range(3):
                if int(nbrs[i]) in cavity:
                    continue
                a_idx = int(tv[(i + 1) % 3])
                b_idx = int(tv[(i + 2) % 3])
                cc_new[(a_idx, b_idx)] = _circumcenter1(points[a_idx], points[b_idx], q)

        neighbours: set[int] = set()
        for t in cavity:
            neighbours.update(int(v) for v in simplices[t])

        total = 0.0
        weighted = 0.0
        for p_idx in neighbours:
            verts: list[NDArray[np.float64]] = [
                centers[t] for t in cavity if p_idx in simplices[t]
            ]
            for (a_idx, b_idx), cc in cc_new.items():
                if p_idx in (a_idx, b_idx):
                    verts.append(cc)
            if len(verts) < 3:
                continue
            stolen = _poly_area(np.asarray(verts, dtype=float))
            total += stolen
            weighted += stolen * float(values[p_idx])
    except ZeroDivisionError:
        total = 0.0  # collinear new triangle → fall through to the linear fallback

    if total <= 0.0:  # degenerate (q on a circumcircle / collinear cavity)
        return _linear_bary(q, simplices[s0], points, values)
    return weighted / total


def sibson_interpolate(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    zv: NDArray[np.float64],
    xqv: NDArray[np.float64],
    yqv: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Sibson natural-neighbour interpolation of scattered (xv, yv, zv) at queries.

    Returns NaN outside the convex hull (matching MATLAB ``Extrapolation='none'``)
    and for collinear/degenerate inputs that cannot be triangulated.
    """
    pts = np.column_stack([xv, yv])
    try:
        tri = Delaunay(pts)
    except QhullError:
        return np.full(xqv.size, np.nan, dtype=float)

    simplices = tri.simplices
    neighbors = tri.neighbors
    a = pts[simplices[:, 0]]
    b = pts[simplices[:, 1]]
    c = pts[simplices[:, 2]]
    centers = _circumcenters(a, b, c)
    radii2 = np.asarray(((a - centers) ** 2).sum(axis=1), dtype=float)

    values = np.asarray(zv, dtype=float)
    queries = np.column_stack([xqv.ravel(), yqv.ravel()])
    loc = tri.find_simplex(queries)  # vectorised hull/containment query
    out = np.empty(queries.shape[0], dtype=float)
    for k in range(queries.shape[0]):
        out[k] = _sibson_one(
            queries[k], int(loc[k]), simplices, neighbors, pts, values, centers, radii2
        )
    return out
