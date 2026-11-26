"""Modified Shepard interpolation of scattered (x, y, z): local weights, and
optionally Renka's quadratic nodal functions (Franke-Nielson / Renka, ACM
TOMS 660 ``QSHEP2``).

Classic Shepard (the existing ``idw`` method) weights EVERY point by ``1/d^p``,
so one far-away cluster still pulls on a query and the surface is flat at every
data point. The *modified* method fixes both:

* **Local weights.** Only points within a radius ``R`` of the query count, with
  the Franke-Little weight ``w = ((R - d) / (R d))^2`` that reaches exactly zero
  at ``d = R``. ``R`` is either a fixed ``radius`` (a query with no point inside
  it is NaN, never a guess) or, by default, the distance to the
  ``(neighbors + 1)``-th nearest point, which adapts to the local sampling.
* **Quadratic nodal functions** (``quadratic=True``, the default; this is
  Renka's modification, not the classic one). Instead of blending the data
  VALUES ``z_i``, blend a local quadratic ``Q_i`` per data point, fitted by
  weighted least squares to its ``nodal_neighbors`` nearest neighbours and
  constrained to pass through ``(x_i, y_i, z_i)``. The blend then reproduces any
  quadratic surface exactly (and so any plane), which the plain value blend
  cannot. ``quadratic=False`` blends the values themselves (the classic
  modified Shepard of Franke & Little).

Defaults follow QSHEP2: 13 nodal neighbours, 19 weight neighbours.

Pure numpy / ``scipy.spatial.cKDTree``; no extrapolation policy here (the
caller clips to the convex hull). Every refusal is a ``ValueError``.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import cKDTree

__all__ = ["shepard_modified"]

Vec = NDArray[np.float64]

_NQ = 13  # QSHEP2 default: points in each nodal quadratic's fit
_NW = 19  # QSHEP2 default: points in each query's weighted blend
_MIN_QUADRATIC = 7  # 5 free coefficients + the node itself + 1 for a residual


def _franke_little(d: Vec, radius: Vec) -> Vec:
    """``((R - d) / (R d))^2`` for ``d < R`` else 0 (d > 0; callers handle d == 0)."""
    inside = d < radius
    w = np.zeros_like(d)
    r = np.broadcast_to(radius, d.shape)
    w[inside] = ((r[inside] - d[inside]) / (r[inside] * d[inside])) ** 2
    return w


def _scaled(x: Vec, y: Vec) -> tuple[Vec, Vec, float]:
    """Both axes scaled to the same unit span, so a metre-vs-degree map is judged by shape."""
    sx = float(np.ptp(x)) or 1.0
    sy = float(np.ptp(y)) or 1.0
    return x / sx, y / sy, sy / sx


def _nodal_coefficients(xs: Vec, ys: Vec, z: Vec, tree: cKDTree, nq: int) -> Vec:
    """Per node ``i``: ``a1..a5`` of the nodal quadratic
    ``Q_i = z_i + a1 dx + a2 dy + a3 dx^2 + a4 dx dy + a5 dy^2``."""
    n = xs.size
    k = min(nq, n - 1) + 1
    dist, idx = tree.query(np.column_stack([xs, ys]), k=k)
    coef = np.zeros((n, 5))
    for i in range(n):
        nb = idx[i, 1:]
        d = dist[i, 1:]
        radius = d[-1] * 1.0000001
        w = np.sqrt(_franke_little(d, np.asarray(radius)))  # sqrt: lstsq squares it
        dx = xs[nb] - xs[i]
        dy = ys[nb] - ys[i]
        a = np.column_stack([dx, dy, dx * dx, dx * dy, dy * dy]) * w[:, None]
        b = (z[nb] - z[i]) * w
        # Min-norm solution: a locally degenerate neighbourhood (e.g. collinear
        # neighbours) leaves the unconstrained terms at zero instead of failing.
        coef[i] = np.linalg.lstsq(a, b, rcond=1e-10)[0]
    return coef


def shepard_modified(
    x: Vec,
    y: Vec,
    z: Vec,
    xq: Vec,
    yq: Vec,
    *,
    radius: float | None = None,
    neighbors: int = _NW,
    nodal_neighbors: int = _NQ,
    quadratic: bool = True,
) -> Vec:
    """Modified Shepard value at each ``(xq, yq)``; NaN where no point is in range.

    Each axis is divided by its own data span first (a metre-vs-degree map is
    judged by shape), so ``radius`` is a FRACTION of the data extent
    (``0 < radius <= 2``), not a length in axis units."""
    n = x.size
    if neighbors < 3:
        raise ValueError("modified Shepard needs at least 3 weight neighbours")
    if quadratic and n < _MIN_QUADRATIC:
        raise ValueError(
            f"modified Shepard with quadratic nodal functions needs at least "
            f"{_MIN_QUADRATIC} points (got {n}); use quadratic=False or another method"
        )
    if n < 3:
        raise ValueError("modified Shepard needs at least 3 points")
    if radius is not None and not (0.0 < radius <= 2.0 and np.isfinite(radius)):
        raise ValueError("Shepard radius is a fraction of the data extent, 0 < radius <= 2")
    xs, ys, _ = _scaled(x, y)
    if float(np.ptp(x)) <= 0 or float(np.ptp(y)) <= 0:
        raise ValueError("modified Shepard needs points that vary in both x and y")
    pts = np.column_stack([xs, ys])
    sv = np.linalg.svd(pts - pts.mean(axis=0), compute_uv=False)
    if sv[-1] <= 1e-9 * sv[0]:
        raise ValueError("modified Shepard needs points that do not lie on one line")
    tree = cKDTree(pts)
    coef = _nodal_coefficients(xs, ys, z, tree, nodal_neighbors) if quadratic else None

    qs = np.column_stack([xq / float(np.ptp(x)), yq / float(np.ptp(y))])
    out = np.full(xq.size, np.nan)
    k = min(neighbors + 1, n)
    dist, idx = tree.query(qs, k=k)
    dist = np.asarray(dist, dtype=float).reshape(xq.size, k)
    idx = np.asarray(idx).reshape(xq.size, k)
    if radius is None:
        rad = dist[:, -1:] * 1.0000001
    else:
        rad = np.full((xq.size, 1), float(radius))
    hit = dist[:, 0] == 0.0
    safe = np.where(dist > 0, dist, 1.0)
    w = np.where(dist > 0, _franke_little(safe, rad), 0.0)
    if quadratic:
        assert coef is not None
        dxq = qs[:, :1] - xs[idx]
        dyq = qs[:, 1:2] - ys[idx]
        c = coef[idx]  # (nq, k, 5)
        nodal = z[idx] + (
            c[..., 0] * dxq + c[..., 1] * dyq
            + c[..., 2] * dxq * dxq + c[..., 3] * dxq * dyq + c[..., 4] * dyq * dyq
        )
    else:
        nodal = z[idx]
    total = w.sum(axis=1)
    ok = total > 0
    out[ok] = (w[ok] * nodal[ok]).sum(axis=1) / total[ok]
    out[hit] = z[idx[hit, 0]]  # a query ON a data point is that point's value
    return out
