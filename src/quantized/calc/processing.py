"""Pure data-processing utilities. Ports of MATLAB +utilities functions.

Column-wise operations on 1-D vectors or 2-D (samples x channels) arrays.
Pure layer — no fastapi/pydantic imports.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy import integrate

__all__ = ["cumulative_integral", "derivative", "log_derivative", "normalize"]


def _as_columns(y: NDArray[np.float64]) -> tuple[NDArray[np.float64], bool]:
    arr = np.asarray(y, dtype=float)
    if arr.ndim == 1:
        return arr.reshape(-1, 1), True
    return arr, False


def normalize(
    y: NDArray[np.float64],
    *,
    method: str = "range",
    out_range: tuple[float, float] = (0.0, 1.0),
) -> NDArray[np.float64]:
    """Per-column normalization. method = 'range' | 'peak' | 'zscore'.

    Port of utilities.normalize (zscore uses sample std, ddof=1).
    """
    if method not in ("range", "peak", "zscore"):
        raise ValueError(f"method must be range/peak/zscore, got {method!r}")
    mat, was_1d = _as_columns(y)
    out = np.full(mat.shape, np.nan)
    lo_out, hi_out = out_range
    for c in range(mat.shape[1]):
        col = mat[:, c]
        if method == "range":
            lo = np.nanmin(col)
            hi = np.nanmax(col)
            span = hi - lo
            out[:, c] = lo_out if span == 0 else lo_out + (col - lo) / span * (hi_out - lo_out)
        elif method == "peak":
            pk = np.nanmax(np.abs(col))
            out[:, c] = col if pk == 0 else col / pk
        else:  # zscore
            mu = np.nanmean(col)
            sg = np.nanstd(col, ddof=1)
            out[:, c] = (col - mu) if sg == 0 else (col - mu) / sg
    return out.ravel() if was_1d else out


def _matlab_gradient(f: NDArray[np.float64], x: NDArray[np.float64]) -> NDArray[np.float64]:
    """Replicate MATLAB ``gradient(F, X)`` exactly (simple central differences).

    Interior: (f[i+1]-f[i-1])/(x[i+1]-x[i-1]); ends: one-sided. (numpy.gradient
    uses a different non-uniform formula, so it is NOT used here.)
    """
    n = f.size
    g = np.empty(n)
    if n == 1:
        g[0] = 0.0
        return g
    g[0] = (f[1] - f[0]) / (x[1] - x[0])
    g[-1] = (f[-1] - f[-2]) / (x[-1] - x[-2])
    if n > 2:
        g[1:-1] = (f[2:] - f[:-2]) / (x[2:] - x[:-2])
    return g


def derivative(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    order: int = 1,
) -> NDArray[np.float64]:
    """Numerical derivative dy/dx (order 1 or 2). Port of utilities.derivative.

    PreSmooth is not yet supported (defaults to off in MATLAB too).
    """
    if order not in (1, 2):
        raise ValueError("order must be 1 or 2")
    xv = np.asarray(x, dtype=float).ravel()
    mat, was_1d = _as_columns(y)
    if xv.size != mat.shape[0]:
        raise ValueError(f"x length ({xv.size}) must match y rows ({mat.shape[0]})")
    out = np.zeros(mat.shape)
    for c in range(mat.shape[1]):
        d = _matlab_gradient(mat[:, c], xv)
        if order == 2:
            d = _matlab_gradient(d, xv)
        out[:, c] = d
    return out.ravel() if was_1d else out


def cumulative_integral(
    x: NDArray[np.float64], y: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Cumulative trapezoidal integral (leading 0). Port of utilities.cumulativeIntegral.

    NaNs are treated as 0 during integration and restored as NaN in the output.
    """
    xv = np.asarray(x, dtype=float).ravel()
    mat, was_1d = _as_columns(y)
    if xv.size != mat.shape[0]:
        raise ValueError(f"x length ({xv.size}) must match y rows ({mat.shape[0]})")
    out = np.zeros(mat.shape)
    for c in range(mat.shape[1]):
        col = mat[:, c].copy()
        nan_mask = np.isnan(col)
        col[nan_mask] = 0.0
        out[:, c] = integrate.cumulative_trapezoid(col, xv, initial=0.0)
        out[nan_mask, c] = np.nan
    return out.ravel() if was_1d else out


def log_derivative(
    x: NDArray[np.float64], y: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Logarithmic derivative (x/y)·dy/dx. Port of utilities.logDerivative.

    NaN where x<=0 or y<=0 (log undefined). PreSmooth not yet supported.
    """
    xv = np.asarray(x, dtype=float).ravel()
    mat, was_1d = _as_columns(y)
    if xv.size != mat.shape[0]:
        raise ValueError(f"x length ({xv.size}) must match y rows ({mat.shape[0]})")
    out = np.full(mat.shape, np.nan)
    for c in range(mat.shape[1]):
        col = mat[:, c]
        dydx = _matlab_gradient(col, xv)
        valid = (xv > 0) & (col > 0)
        out[valid, c] = (xv[valid] / col[valid]) * dydx[valid]
    return out.ravel() if was_1d else out
