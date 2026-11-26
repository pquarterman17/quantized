"""The extra gridding methods behind ``interpolate2d`` / ``regrid2d``:
``shepard`` (modified Shepard, ``_shepard``), ``kriging`` (ordinary kriging,
``_kriging``) and ``renka`` (Renka-Cline).

**Renka-Cline.** Renka & Cline (1984) is the C1 piecewise-cubic interpolant
over a Delaunay triangulation (Clough-Tocher sub-triangles) with gradients
estimated from the data by a global curvature-minimising scheme. That is the
algorithm of ``scipy.interpolate.CloughTocher2DInterpolator``, so ``renka``
delegates to it rather than re-implementing it. It is NOT the app's existing
``cubic`` method, which (as in MATLAB) is an alias of Sibson natural
neighbour. Exact on planes, C1 across triangles, NaN outside the hull.

**Clipping.** Every method fails closed outside the convex hull of the data
(NaN) unless the caller asks for ``extrapolation="nearest"``, which fills only
those cells with the nearest data value. Too few points or collinear input
raises ``ValueError``.

``options`` keys (all optional): ``shepard_radius`` (fraction of the extent),
``shepard_neighbors``, ``shepard_quadratic``, ``variogram`` (auto, spherical,
exponential, gaussian), ``krige_neighbors``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import CloughTocher2DInterpolator, griddata
from scipy.spatial._qhull import QhullError

from quantized.calc._hull_query import inside_hull
from quantized.calc._kriging import ordinary_kriging
from quantized.calc._shepard import shepard_modified

__all__ = ["EXTRA_METHODS", "interpolate_extra", "interpolate_idw"]

Vec = NDArray[np.float64]
EXTRA_METHODS = ("shepard", "kriging", "renka")


def interpolate_idw(xv: Vec, yv: Vec, zv: Vec, xqv: Vec, yqv: Vec, power: float) -> Vec:
    """Classic inverse-distance weighting over every point (the ``idw`` method)."""
    zqv = np.empty(xqv.size)
    for k in range(xqv.size):
        d = np.sqrt((xqv[k] - xv) ** 2 + (yqv[k] - yv) ** 2)
        exact = np.flatnonzero(d == 0)
        if exact.size:
            zqv[k] = zv[exact[0]]
            continue
        w = 1.0 / (d**power)
        zqv[k] = float(np.sum(w * zv) / np.sum(w))
    return zqv


def _renka(x: Vec, y: Vec, z: Vec, xq: Vec, yq: Vec) -> Vec:
    if x.size < 3:
        raise ValueError("Renka-Cline needs at least 3 points")
    try:
        f = CloughTocher2DInterpolator(np.column_stack([x, y]), z, rescale=True)
    except QhullError as exc:
        raise ValueError("Renka-Cline needs points that do not lie on one line") from exc
    return np.asarray(f(np.column_stack([xq, yq])), dtype=float)


def interpolate_extra(
    x: Vec,
    y: Vec,
    z: Vec,
    xq: Vec,
    yq: Vec,
    method: str,
    extrapolation: str,
    options: Mapping[str, Any] | None = None,
) -> tuple[Vec, Vec | None, dict[str, Any]]:
    """``(values, kriging variance or None, info)`` for an extra method."""
    opt = dict(options or {})
    if extrapolation not in ("none", "nearest"):
        raise ValueError(f"extrapolation must be 'none' or 'nearest', got {extrapolation!r}")
    var: Vec | None = None
    info: dict[str, Any] = {"method": method}
    if method == "shepard":
        zq = shepard_modified(
            x, y, z, xq, yq,
            radius=opt.get("shepard_radius"),
            neighbors=int(opt.get("shepard_neighbors", 19)),
            quadratic=bool(opt.get("shepard_quadratic", True)),
        )
        info["quadratic_nodal_functions"] = bool(opt.get("shepard_quadratic", True))
    elif method == "kriging":
        zq, var, vinfo = ordinary_kriging(
            x, y, z, xq, yq,
            variogram=str(opt.get("variogram", "auto")),
            neighbors=int(opt.get("krige_neighbors", 32)),
        )
        info["variogram"] = {k: v for k, v in vinfo.items() if k not in ("lags", "gammas")}
    elif method == "renka":
        zq = _renka(x, y, z, xq, yq)
    else:
        raise ValueError(f"unknown method {method!r}")
    pts = np.column_stack([x, y])
    qpts = np.column_stack([xq, yq])
    if method != "renka":  # Clough-Tocher is already NaN outside the hull
        inside = inside_hull(pts, qpts)
        if inside is None:
            raise ValueError(f"{method}: the points are collinear or coincident")
        zq = zq.copy()
        zq[~inside] = np.nan
        if var is not None:
            var = var.copy()
            var[~inside] = np.nan
    if extrapolation == "nearest":
        out = np.isnan(zq)
        if out.any():
            zq[out] = griddata(pts, z, qpts[out], method="nearest")
            if var is not None:
                var[out] = np.nan  # no variance claim for a nearest-value fill
    return zq, var, info
