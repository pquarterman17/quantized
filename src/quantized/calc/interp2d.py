"""Scattered 2-D interpolation + regridding. Ports of MATLAB +utilities.

Pure calc layer. ``interpolate2d`` interpolates scattered (x, y, z) onto query
points; ``regrid2d`` builds a regular grid and calls it.

Parity notes:
  * ``linear`` / ``nearest`` delegate to ``scipy.interpolate.griddata`` (Qhull
    Delaunay) and match MATLAB ``scatteredInterpolant`` inside the convex hull.
  * ``idw`` and ``thinplate`` are hand-rolled (inverse-distance weighting and
    thin-plate-spline linear systems) and match MATLAB exactly.
  * ``natural`` (the MATLAB default) and ``cubic`` (which MATLAB aliases to
    ``natural``) use Sibson natural-neighbour interpolation, hand-rolled in
    ``_natural_neighbor`` from the Delaunay triangulation. Sibson coordinates
    are geometrically unique, so this matches MATLAB's 'natural' to ~1e-9 at
    interior points and reproduces affine fields exactly (linear precision).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.interpolate import griddata
from scipy.spatial import Delaunay
from scipy.spatial._qhull import QhullError

from quantized.calc._natural_neighbor import sibson_interpolate

__all__ = ["interpolate2d", "regrid2d"]

_SCATTERED = ("linear", "natural", "nearest", "cubic")


def _unique_rows(
    xv: NDArray[np.float64], yv: NDArray[np.float64], zv: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Drop duplicate (x, y) rows keeping first occurrence (MATLAB unique 'stable')."""
    seen: set[tuple[float, float]] = set()
    keep: list[int] = []
    for i in range(xv.size):
        key = (float(xv[i]), float(yv[i]))
        if key not in seen:
            seen.add(key)
            keep.append(i)
    if len(keep) < xv.size:
        return xv[keep], yv[keep], zv[keep]
    return xv, yv, zv


def _hull_mask(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    qpts: NDArray[np.float64],
    zqv: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Set query points outside the data convex hull to NaN (extrapolation='none')."""
    if xv.size < 3:
        return zqv
    try:
        tri = Delaunay(np.column_stack([xv, yv]))
    except QhullError:
        return zqv
    out = zqv.copy()
    out[tri.find_simplex(qpts) < 0] = np.nan
    return out


def _interp_scattered(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    zv: NDArray[np.float64],
    xqv: NDArray[np.float64],
    yqv: NDArray[np.float64],
    method: str,
    extrapolation: str,
) -> NDArray[np.float64]:
    pts = np.column_stack([xv, yv])
    qpts = np.column_stack([xqv, yqv])
    if method in ("natural", "cubic"):
        # Sibson natural-neighbour (MATLAB aliases 'cubic' to 'natural'); already
        # NaN outside the convex hull.
        zqv = sibson_interpolate(xv, yv, zv, xqv, yqv)
    elif method == "nearest":
        zqv = np.asarray(griddata(pts, zv, qpts, method="nearest"), dtype=float)
        if extrapolation == "none":
            zqv = _hull_mask(xv, yv, qpts, zqv)
        return zqv
    else:  # linear
        zqv = np.asarray(griddata(pts, zv, qpts, method="linear"), dtype=float)
    if extrapolation == "nearest":
        nan_mask = np.isnan(zqv)
        if nan_mask.any():
            zqv[nan_mask] = griddata(pts, zv, qpts[nan_mask], method="nearest")
    return zqv


def _interp_idw(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    zv: NDArray[np.float64],
    xqv: NDArray[np.float64],
    yqv: NDArray[np.float64],
    power: float,
) -> NDArray[np.float64]:
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


def _interp_thinplate(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    zv: NDArray[np.float64],
    xqv: NDArray[np.float64],
    yqv: NDArray[np.float64],
    lam: float,
    extrapolation: str,
) -> NDArray[np.float64]:
    n = xv.size
    r2 = (xv[:, None] - xv[None, :]) ** 2 + (yv[:, None] - yv[None, :]) ** 2
    r = np.sqrt(r2)
    phi = np.zeros((n, n))
    mask = r > 0
    phi[mask] = r2[mask] * np.log(r[mask])
    pmat = np.column_stack([np.ones(n), xv, yv])
    amat = np.block([[phi + lam * np.eye(n), pmat], [pmat.T, np.zeros((3, 3))]])
    try:
        coeff = np.linalg.solve(amat, np.concatenate([zv, np.zeros(3)]))
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "thin-plate spline: data matrix is singular — points are collinear or "
            "coincident; use a coarser grid or a different interpolation method"
        ) from exc
    w, a = coeff[:n], coeff[n : n + 3]

    zqv = np.empty(xqv.size)
    for qi in range(xqv.size):
        r2q = (xqv[qi] - xv) ** 2 + (yqv[qi] - yv) ** 2
        rq = np.sqrt(r2q)
        phiq = np.zeros(n)
        mk = rq > 0
        phiq[mk] = r2q[mk] * np.log(rq[mk])
        zqv[qi] = float(w @ phiq + a[0] + a[1] * xqv[qi] + a[2] * yqv[qi])
    if extrapolation == "none":
        zqv = _hull_mask(xv, yv, np.column_stack([xqv, yqv]), zqv)
    return zqv


def interpolate2d(
    x: ArrayLike,
    y: ArrayLike,
    z: ArrayLike,
    xq: ArrayLike,
    yq: ArrayLike,
    *,
    method: str = "natural",
    idw_power: float = 2.0,
    extrapolation: str = "none",
    smoothing: float = 0.0,
) -> dict[str, Any]:
    """Interpolate scattered (x, y, z) onto query points. Port of utilities.interpolate2D.

    Returns ``{"zq", "method", "stats": {"nPoints", "rmse"}}`` (rmse is NaN — the
    expensive leave-one-out estimate is not computed). See module docstring for
    per-method parity. ``extrapolation='none'`` yields NaN outside the convex hull.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    zv = np.asarray(z, dtype=float).ravel()
    if not (xv.size == yv.size == zv.size):
        raise ValueError("x, y, and z must have the same number of elements")
    if xv.size < 3:
        raise ValueError("at least 3 data points are required for 2-D interpolation")
    xv, yv, zv = _unique_rows(xv, yv, zv)

    query_shape = np.asarray(xq, dtype=float).shape
    xqv = np.asarray(xq, dtype=float).ravel()
    yqv = np.asarray(yq, dtype=float).ravel()

    if method in _SCATTERED:
        zqv = _interp_scattered(xv, yv, zv, xqv, yqv, method, extrapolation)
    elif method == "thinplate":
        zqv = _interp_thinplate(xv, yv, zv, xqv, yqv, smoothing, extrapolation)
    elif method == "idw":
        zqv = _interp_idw(xv, yv, zv, xqv, yqv, idw_power)
        if extrapolation == "none":
            zqv = _hull_mask(xv, yv, np.column_stack([xqv, yqv]), zqv)
    else:
        raise ValueError(f"unknown method {method!r}")

    return {
        "zq": zqv.reshape(query_shape),
        "method": method,
        "stats": {"nPoints": int(xv.size), "rmse": float("nan")},
    }


def regrid2d(
    x: ArrayLike,
    y: ArrayLike,
    z: ArrayLike,
    *,
    nx: int = 100,
    ny: int = 100,
    method: str = "natural",
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
    extrapolation: str = "none",
    smoothing: float = 0.0,
    idw_power: float = 2.0,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Resample scattered data onto a regular grid. Port of utilities.regrid2D.

    Returns ``(Xq, Yq, Zq)`` meshgrids (shape ``ny x nx``). Limits default to the
    data extent. See ``interpolate2d`` for per-method parity caveats.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    zv = np.asarray(z, dtype=float).ravel()
    # Scattered interpolation (scatteredInterpolant/griddata) needs finite points;
    # drop any non-finite (x, y, z) triple so real data with NaN gaps still grids.
    # No-op on clean data, so golden parity holds.
    finite = np.isfinite(xv) & np.isfinite(yv) & np.isfinite(zv)
    if not bool(finite.all()):
        xv, yv, zv = xv[finite], yv[finite], zv[finite]
    xl = (float(xv.min()), float(xv.max())) if xlim is None else (float(xlim[0]), float(xlim[1]))
    yl = (float(yv.min()), float(yv.max())) if ylim is None else (float(ylim[0]), float(ylim[1]))
    if xl[0] >= xl[1]:
        raise ValueError(
            "cannot build a 2-D grid: the x axis has no range "
            f"(min == max == {xl[0]:g}); it is constant or single-valued"
        )
    if yl[0] >= yl[1]:
        raise ValueError(
            "cannot build a 2-D grid: the y axis has no range "
            f"(min == max == {yl[0]:g}); it is constant or single-valued"
        )
    x_grid = np.linspace(xl[0], xl[1], nx)
    y_grid = np.linspace(yl[0], yl[1], ny)
    xq, yq = np.meshgrid(x_grid, y_grid)
    result = interpolate2d(
        xv, yv, zv, xq, yq,
        method=method, extrapolation=extrapolation, smoothing=smoothing, idw_power=idw_power,
    )
    return xq, yq, np.asarray(result["zq"], dtype=float)
