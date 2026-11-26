"""XYZ gridding to a NEW map: every method, log-spaced axes, kriging variance.

``grid_xyz`` turns scattered ``(x, y, z)`` into a regular ``ny x nx`` grid and
``grid_datastruct`` wraps it as a native-grid map DataStruct with a ``map_op``
provenance dict (the caller commits it as a derived dataset; the input is
never touched).

Methods: the existing ``natural`` (Sibson), ``cubic`` (alias of natural),
``linear``, ``nearest``, ``idw``, ``thinplate`` (all through
``interp2d.regrid2d``, so a linear-axis grid is bit-identical to the Map tab's)
plus ``shepard`` (modified Shepard), ``kriging`` and ``renka`` (Renka-Cline,
see ``_grid_extra``).

**Log-spaced axes** (``log_x`` / ``log_y``): the grid lines are
``logspace(log10 lo, log10 hi, n)`` instead of ``linspace``. The data itself is
interpolated in its own linear coordinates and evaluated at those positions;
nothing is transformed. Every x (or y) value and any explicit limit must be
positive, else ``ValueError``. The cloud is handed to the interpolator whole
(the density pre-aggregation of ``regrid2d`` is linear-axis only), so a very
large cloud with a global method is slow; a log-axis grid is not uniform, so
the map operations (crop, FFT ...) will refuse it.

**Kriging variance** (``output="variance"``): the estimation variance map, 0 at
data points. Only kriging has one; any other method is refused. Cells outside
the hull are NaN.

Every method fails closed on fewer than three distinct finite points or on
collinear input, and never extrapolates outside the convex hull unless
``extrapolation="nearest"`` is requested.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc._grid_extra import EXTRA_METHODS, interpolate_extra
from quantized.calc.interp2d import _unique_rows, interpolate2d, regrid2d
from quantized.calc.map import _require_2d_support
from quantized.datastruct import DataStruct
from quantized.io._array_books import grid_map_datastruct

__all__ = ["GRID_METHODS", "GridResult", "grid_datastruct", "grid_xyz", "read_xyz"]

Vec = NDArray[np.float64]
GRID_METHODS = ("natural", "linear", "nearest", "cubic", "idw", "thinplate", *EXTRA_METHODS)


@dataclass(frozen=True)
class GridResult:
    x: Vec
    y: Vec
    z: Vec  # (ny, nx)
    variance: Vec | None
    info: dict[str, Any]


def _axis(lo: float, hi: float, n: int, log: bool, name: str) -> Vec:
    if lo >= hi:
        raise ValueError(f"cannot build a 2-D grid: the {name} axis has no range")
    if log:
        if lo <= 0:
            raise ValueError(
                f"a log-spaced {name} axis needs every {name} value above 0 (min is {lo:g})"
            )
        return np.asarray(np.logspace(np.log10(lo), np.log10(hi), n), dtype=float)
    return np.asarray(np.linspace(lo, hi, n), dtype=float)


def grid_xyz(
    x: ArrayLike,
    y: ArrayLike,
    z: ArrayLike,
    *,
    method: str = "natural",
    nx: int = 100,
    ny: int = 100,
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
    log_x: bool = False,
    log_y: bool = False,
    extrapolation: str = "none",
    idw_power: float = 2.0,
    smoothing: float = 0.0,
    output: str = "value",
    options: Mapping[str, Any] | None = None,
) -> GridResult:
    """Grid scattered points; see the module docstring for every option."""
    if method not in GRID_METHODS:
        raise ValueError(f"unknown method {method!r}; choose from {', '.join(GRID_METHODS)}")
    if output not in ("value", "variance"):
        raise ValueError("output must be 'value' or 'variance'")
    if output == "variance" and method != "kriging":
        raise ValueError("only kriging has a variance map; choose method 'kriging'")
    if not (2 <= nx <= 2000 and 2 <= ny <= 2000):
        raise ValueError("grid size must be between 2 and 2000 cells per axis")
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    zv = np.asarray(z, dtype=float).ravel()
    if not (xv.size == yv.size == zv.size):
        raise ValueError("x, y and z must have the same number of values")
    ok = np.isfinite(xv) & np.isfinite(yv) & np.isfinite(zv)
    xv, yv, zv = xv[ok], yv[ok], zv[ok]
    if xv.size < 3:
        raise ValueError(f"need at least 3 finite (x, y, z) points to grid (got {xv.size})")
    xv, yv, zv = _unique_rows(xv, yv, zv)
    _require_2d_support(xv, yv)
    if log_x and float(xv.min()) <= 0:
        raise ValueError(f"a log-spaced x axis needs every x above 0 (min is {xv.min():g})")
    if log_y and float(yv.min()) <= 0:
        raise ValueError(f"a log-spaced y axis needs every y above 0 (min is {yv.min():g})")
    xl = (float(xv.min()), float(xv.max())) if xlim is None else (float(xlim[0]), float(xlim[1]))
    yl = (float(yv.min()), float(yv.max())) if ylim is None else (float(ylim[0]), float(ylim[1]))
    xa = _axis(*xl, nx, log_x, "x")
    ya = _axis(*yl, ny, log_y, "y")
    info: dict[str, Any] = {
        "method": method,
        "nx": nx,
        "ny": ny,
        "log_x": log_x,
        "log_y": log_y,
        "extrapolation": extrapolation,
        "output": output,
        "n_points": int(xv.size),
    }
    var: Vec | None = None
    if method in EXTRA_METHODS:
        xq, yq = np.meshgrid(xa, ya)
        zf, vf, extra = interpolate_extra(
            xv, yv, zv, xq.ravel(), yq.ravel(), method, extrapolation, options
        )
        zq = zf.reshape(ny, nx)
        var = None if vf is None else vf.reshape(ny, nx)
        info.update({k: v for k, v in extra.items() if k != "method"})
    elif log_x or log_y:
        xq, yq = np.meshgrid(xa, ya)
        res = interpolate2d(
            xv, yv, zv, xq, yq, method=method, idw_power=idw_power,
            extrapolation=extrapolation, smoothing=smoothing,
        )
        zq = np.asarray(res["zq"], dtype=float)
    else:
        _, _, zq = regrid2d(
            xv, yv, zv, nx=nx, ny=ny, method=method, xlim=xl, ylim=yl,
            extrapolation=extrapolation, smoothing=smoothing, idw_power=idw_power,
        )
    return GridResult(xa, ya, zq, var, info)


def grid_datastruct(
    res: GridResult,
    *,
    x_label: str,
    x_unit: str,
    y_label: str,
    y_unit: str,
    z_unit: str,
    output: str = "value",
    metadata: Mapping[str, Any] | None = None,
) -> DataStruct:
    """The result as a native-grid map DataStruct; ``map_op`` records the settings."""
    if output == "variance":
        if res.variance is None:
            raise ValueError("this gridding produced no variance map")
        z = res.variance
        unit = f"({z_unit})^2" if z_unit else ""
    else:
        z, unit = res.z, z_unit
    meta = {**(metadata or {}), "map_op": {"op": "grid_xyz", **res.info}}
    return grid_map_datastruct(
        z, res.x, res.y,
        x_label=x_label, x_unit=x_unit, y_label=y_label, y_unit=y_unit,
        z_unit=unit, metadata=meta,
    )


def read_xyz(
    ds: DataStruct, x_col: int | str, y_col: int | str, z_col: int | str
) -> tuple[Vec, Vec, Vec, list[tuple[str, str]]]:
    """The three picked columns of a worksheet (``-1`` or the X column's own
    name = the X/time axis) with each one's ``(label, unit)``."""
    xname = str(ds.metadata.get("x_column_name") or "x")

    def pick(key: int | str) -> tuple[Vec, str, str]:
        if key == -1 or (isinstance(key, str) and key not in ds.labels and key == xname):
            return (
                np.asarray(ds.time, dtype=float),
                xname,
                str(ds.metadata.get("x_column_unit") or ""),
            )
        i = ds.labels.index(key) if isinstance(key, str) and key in ds.labels else key
        if not isinstance(i, int) or not 0 <= i < len(ds.labels):
            raise ValueError(f"no column {key!r}; columns are {list(ds.labels)}")
        unit = ds.units[i] if i < len(ds.units) else ""
        return np.asarray(ds.values[:, i], dtype=float), ds.labels[i], unit

    cols = [pick(k) for k in (x_col, y_col, z_col)]
    if len({c[1] for c in cols}) != 3:
        raise ValueError("the X, Y and Z columns must be three different columns")
    return cols[0][0], cols[1][0], cols[2][0], [(c[1], c[2]) for c in cols]
