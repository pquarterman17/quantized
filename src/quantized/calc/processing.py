"""Pure data-processing utilities. Ports of MATLAB +utilities functions.

Column-wise operations on 1-D vectors or 2-D (samples x channels) arrays.
Pure layer — no fastapi/pydantic imports.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy import integrate

__all__ = [
    "cumulative_integral",
    "derivative",
    "log_derivative",
    "normalize",
    "smooth_data",
]


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
        if col.size == 0:  # empty column: nothing to normalize (np.nanmin would raise)
            out[:, c] = col
            continue
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
    if n == 0:
        return g
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
    pre_smooth: int = 0,
) -> NDArray[np.float64]:
    """Numerical derivative dy/dx (order 1 or 2). Port of utilities.derivative.

    With ``pre_smooth > 0`` the signal is gaussian-smoothed (window = pre_smooth)
    before differentiating, matching the MATLAB ``PreSmooth`` option.
    """
    if order not in (1, 2):
        raise ValueError("order must be 1 or 2")
    xv = np.asarray(x, dtype=float).ravel()
    mat, was_1d = _as_columns(y)
    if xv.size != mat.shape[0]:
        raise ValueError(f"x length ({xv.size}) must match y rows ({mat.shape[0]})")
    if pre_smooth > 0:
        smoothed = smooth_data(mat, method="gaussian", window=pre_smooth)
        mat = smoothed if smoothed.ndim == 2 else smoothed.reshape(-1, 1)
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


def smooth_data(
    y: NDArray[np.float64],
    *,
    method: str = "moving",
    window: int = 5,
    poly_order: int = 2,
) -> NDArray[np.float64]:
    """Column-wise smoothing. Port of utilities.smoothData.

    ``window`` is the half-width (full window = ``2*window + 1``). Methods:

    - ``'moving'``: boxcar average, reflect-padded at the edges.
    - ``'gaussian'``: Gaussian kernel (sigma = hw/2), reflect-padded.
    - ``'savitzky-golay'``: SG convolution interior + per-point polynomial fits
      over the boundary window at each edge (matches MATLAB's edge handling).

    The half-width is clamped to ``n-1`` per column; columns shorter than 2 are
    returned unchanged.
    """
    if method not in ("moving", "gaussian", "savitzky-golay"):
        raise ValueError("method must be moving/gaussian/savitzky-golay")
    hw = window
    if method == "savitzky-golay" and poly_order >= 2 * hw + 1:
        raise ValueError(f"poly_order ({poly_order}) must be < window width ({2 * hw + 1})")

    mat, was_1d = _as_columns(y)
    out = np.full(mat.shape, np.nan)
    for c in range(mat.shape[1]):
        col = mat[:, c]
        n = col.size
        hwc = min(hw, n - 1)
        if hwc < 1:
            out[:, c] = col
            continue

        if method == "savitzky-golay":
            out[:, c] = _savgol_column(col, hwc, min(poly_order, 2 * hwc))
        else:
            w_len = 2 * hwc + 1
            if method == "moving":
                kernel = np.ones(w_len) / w_len
            else:  # gaussian
                sigma = hwc / 2.0
                t = np.arange(-hwc, hwc + 1, dtype=float)
                kernel = np.exp(-(t**2) / (2.0 * sigma**2))
                kernel = kernel / kernel.sum()
            left = col[1 : hwc + 1][::-1]
            right = col[n - 1 - hwc : n - 1][::-1]
            padded = np.concatenate([left, col, right])
            out[:, c] = np.convolve(padded, kernel, mode="valid")[:n]
    return out.ravel() if was_1d else out


def _savgol_column(col: NDArray[np.float64], hwc: int, poly_ord: int) -> NDArray[np.float64]:
    """One column of Savitzky-Golay smoothing (interior kernel + polynomial edges)."""
    n = col.size
    w_len = 2 * hwc + 1
    t = np.arange(-hwc, hwc + 1, dtype=float)
    vand = np.vander(t, poly_ord + 1, increasing=True)
    # SG smoothing kernel = first row of the normal-equations pseudoinverse.
    coeff_mat = np.linalg.solve(vand.T @ vand, vand.T)
    int_kernel = coeff_mat[0, :]

    out = col.copy()
    if n > 2 * hwc:
        out = np.convolve(col, int_kernel[::-1], mode="same")

    # Edges: one polynomial fit over the boundary window, evaluated per point.
    n_pts = min(w_len, n)
    t_local = np.arange(n_pts, dtype=float)
    vand_local = np.vander(t_local, poly_ord + 1, increasing=True)
    powers = np.arange(poly_ord + 1)
    left_coeffs = np.linalg.lstsq(vand_local, col[:n_pts], rcond=None)[0]
    right_coeffs = np.linalg.lstsq(vand_local, col[n - n_pts : n], rcond=None)[0]
    for i in range(1, hwc + 1):
        out[i - 1] = float(np.sum(left_coeffs * (i - 1.0) ** powers))
        out[n - i] = float(np.sum(right_coeffs * float(n_pts - 1 - (i - 1)) ** powers))
    return out
