"""Resample a DataStruct onto a new x-grid. Port of utilities.resampleData.

Pure calc layer. Supports four grid modes (n_points / step / grid / match_dataset;
exactly one, or none for a 500-point default) and four interpolation methods
(linear / pchip / spline=not-a-knot / makima). Out-of-range samples are NaN unless
``extrapolate=True``.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.interpolate import (
    Akima1DInterpolator,
    CubicSpline,
    PchipInterpolator,
    interp1d,
)

from ..datastruct import DataStruct

__all__ = ["resample_data"]

_METHODS = ("linear", "pchip", "spline", "makima")


def _colon(a: float, d: float, b: float) -> NDArray[np.float64]:
    """MATLAB ``a:d:b`` colon grid (endpoint included only if it lands exactly)."""
    n = int(math.floor((b - a) / d + 1e-10))
    return np.asarray(a + np.arange(n + 1) * d, dtype=float)


def _interp_column(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    x_new: NDArray[np.float64],
    method: str,
    extrapolate: bool,
) -> NDArray[np.float64]:
    if method == "linear":
        if extrapolate:
            fn = interp1d(x, y, kind="linear", fill_value="extrapolate", assume_sorted=True)
            return np.asarray(fn(x_new), dtype=float)
        return np.asarray(np.interp(x_new, x, y, left=np.nan, right=np.nan), dtype=float)
    if method == "pchip":
        return np.asarray(PchipInterpolator(x, y, extrapolate=extrapolate)(x_new), dtype=float)
    if method == "spline":
        spline = CubicSpline(x, y, bc_type="not-a-knot", extrapolate=extrapolate)
        return np.asarray(spline(x_new), dtype=float)
    akima = Akima1DInterpolator(x, y, method="makima", extrapolate=extrapolate)
    return np.asarray(akima(x_new), dtype=float)


def resample_data(
    data: DataStruct,
    *,
    n_points: int | None = None,
    step: float | None = None,
    grid: ArrayLike | None = None,
    match_dataset: DataStruct | None = None,
    method: str = "makima",
    extrapolate: bool = False,
) -> DataStruct:
    """Resample ``data`` onto a new x-grid, interpolating every channel.

    Specify exactly one grid mode (``n_points``, ``step``, ``grid`` or
    ``match_dataset``); with none, a 500-point linspace over the data range is
    used. Returns a new DataStruct with ``resampled``/``resampleMethod``/
    ``resamplePoints`` stamped into ``metadata``.
    """
    if method not in _METHODS:
        raise ValueError(f"method must be one of {_METHODS}")
    x_old = np.asarray(data.time, dtype=float).ravel()
    y_old = np.asarray(data.values, dtype=float)
    if y_old.ndim == 1:
        y_old = y_old.reshape(-1, 1)
    if x_old.size < 2:
        raise ValueError("need at least 2 data points")

    modes = sum(v is not None for v in (n_points, step, grid, match_dataset))
    if modes > 1:
        raise ValueError("specify only one of: n_points, step, grid, match_dataset")
    lo, hi = float(x_old.min()), float(x_old.max())
    if modes == 0:
        x_new = np.linspace(lo, hi, 500)
    elif n_points is not None:
        x_new = np.linspace(lo, hi, int(n_points))
    elif step is not None:
        x_new = _colon(lo, float(step), hi)
    elif grid is not None:
        x_new = np.asarray(grid, dtype=float).ravel()
    else:  # match_dataset
        x_new = np.asarray(match_dataset.time, dtype=float).ravel()  # type: ignore[union-attr]

    y_new = np.empty((x_new.size, y_old.shape[1]))
    for c in range(y_old.shape[1]):
        y_new[:, c] = _interp_column(x_old, y_old[:, c], x_new, method, extrapolate)

    meta = dict(data.metadata)
    meta["resampled"] = True
    meta["resampleMethod"] = method
    meta["resamplePoints"] = int(x_new.size)
    return DataStruct.create(
        x_new, y_new, labels=data.labels, units=data.units, metadata=meta
    )
