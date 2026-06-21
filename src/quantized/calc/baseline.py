"""Baseline estimation. Ports of MATLAB +utilities/baseline*.m.

Pure functions: spectrum in, baseline out.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy import sparse
from scipy.interpolate import interp1d
from scipy.sparse.linalg import spsolve

__all__ = ["baseline_als", "baseline_modpoly", "baseline_rolling_ball", "estimate_background"]

_EPS = float(np.finfo(float).eps)


def _matlab_round(x: float) -> int:
    """Round half away from zero (MATLAB ``round``)."""
    return int(math.copysign(math.floor(abs(x) + 0.5), x))


def baseline_als(
    y: NDArray[np.float64],
    *,
    lam: float = 1e6,
    p: float = 0.01,
    max_iter: int = 20,
    tol: float = 1e-6,
) -> NDArray[np.float64]:
    """Asymmetric least-squares (Eilers/Whittaker) baseline. Port of baselineALS.

    Solves ``(W + lam·DᵀD) z = W·y`` iteratively, reweighting w = p where
    y>z else (1-p), until the weights converge.
    """
    if lam <= 0:
        raise ValueError("lam must be positive")
    if not 0 < p < 1:
        raise ValueError("p must be in (0, 1)")
    yv = np.asarray(y, dtype=float).ravel()
    n = yv.size
    if n < 3:
        return yv.copy()

    # Second-difference operator D: (n-2) x n  (rows: y[i] - 2y[i+1] + y[i+2]).
    diff2 = sparse.diags(
        diagonals=[1.0, -2.0, 1.0], offsets=[0, 1, 2], shape=(n - 2, n)
    ).tocsc()
    dtd = (diff2.T @ diff2).tocsc()

    w = np.ones(n)
    z = yv.copy()
    for _ in range(max_iter):
        big_w = sparse.diags(w, 0, shape=(n, n))
        c = (big_w + lam * dtd).tocsc()
        z = spsolve(c, w * yv)
        w_new = p * (yv > z) + (1.0 - p) * (yv <= z)
        if float(np.max(np.abs(w_new - w))) < tol:
            w = w_new
            break
        w = w_new
    return np.asarray(z, dtype=float)


def _snip_background(
    x: NDArray[np.float64], y: NDArray[np.float64], n: int, max_window_deg: float, passes: int
) -> NDArray[np.float64]:
    """SNIP (iterative peak-clipping) background in sqrt space, then boxcar-smoothed."""
    dx = float(np.median(np.diff(x)))
    if dx <= 0:
        return y.copy()
    w_max = max(1, min(_matlab_round(max_window_deg / dx), (n - 1) // 2))
    v = np.sqrt(np.maximum(y, 0.0))
    for w in range(w_max, 0, -1):
        v_new = v.copy()
        avg = (v[: n - 2 * w] + v[2 * w :]) / 2.0
        v_new[w : n - w] = np.minimum(v[w : n - w], avg)
        v = v_new
    bg = np.asarray(v**2, dtype=float)
    kernel = np.ones(5) / 5.0
    for _ in range(passes):
        padded = np.concatenate([bg[1:3][::-1], bg, bg[n - 3 : n - 1][::-1]])
        bg = np.asarray(np.convolve(padded, kernel, mode="valid")[:n], dtype=float)
    return bg


def _poly_background(
    x: NDArray[np.float64], y: NDArray[np.float64], n: int, poly_degree: int, iter_sigma: float
) -> NDArray[np.float64]:
    """Polynomial background with iterative robust (MAD) outlier rejection."""
    deg = min(poly_degree, max(1, n // 3 - 1))
    mask = np.ones(n, dtype=bool)
    bg = y.copy()
    for _ in range(4):
        xm, ym = x[mask], y[mask]
        if xm.size < deg + 1:
            break
        xc = float(np.mean(xm))
        xs = max(float(np.std(xm, ddof=1)), _EPS)
        coeffs = np.polyfit((xm - xc) / xs, ym, deg)
        bg = np.asarray(np.polyval(coeffs, (x - xc) / xs), dtype=float)
        residual = y - bg
        rm = residual[mask]
        sigma = 1.4826 * float(np.median(np.abs(rm - np.median(rm))))
        if sigma < _EPS:
            break
        mask = residual < iter_sigma * sigma
        if int(mask.sum()) < deg + 1:
            mask = np.ones(n, dtype=bool)
            break
    return np.asarray(bg, dtype=float)


def _iterative_refine(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    bg: NDArray[np.float64],
    n: int,
    method: str,
    max_window_deg: float,
    passes: int,
    poly_degree: int,
    iter_max_passes: int,
    iter_sigma: float,
) -> NDArray[np.float64]:
    """Refine a background by masking+dilating peaks and re-estimating on the rest."""
    for _ in range(iter_max_passes):
        residual = y - bg
        below_med = residual[residual < np.median(residual)]
        ref = below_med if below_med.size > 5 else residual
        sigma = 1.4826 * float(np.median(np.abs(ref - np.median(ref))))
        data_range = float(np.max(y) - np.min(y))
        if sigma < max(_EPS, data_range * 1e-10):
            break
        dilated = residual > iter_sigma * sigma
        for _ in range(max(3, _matlab_round(0.005 * n))):
            prev = dilated.copy()
            dilated[1:] = dilated[1:] | prev[:-1]
            dilated[:-1] = dilated[:-1] | prev[1:]
        non_peak = ~dilated
        if int(non_peak.sum()) < 10:
            break
        bg_prev = bg
        if method == "snip":
            y_clean = y.copy()
            fill = interp1d(
                x[non_peak], y[non_peak], kind="linear", fill_value="extrapolate"
            )
            y_clean[dilated] = fill(x[dilated])
            bg = _snip_background(x, y_clean, n, max_window_deg, passes)
        else:
            bg = _poly_background(x, y, n, poly_degree, iter_sigma)
        if float(np.max(np.abs(bg - bg_prev))) < 0.01 * sigma:
            break
    return bg


def estimate_background(
    x: ArrayLike,
    y: ArrayLike,
    *,
    method: str = "snip",
    max_window_deg: float = 2.0,
    smooth_passes: int = 3,
    poly_degree: int = 4,
    iterative: bool = False,
    iter_max_passes: int = 3,
    iter_sigma: float = 3.0,
) -> NDArray[np.float64]:
    """Estimate a slowly-varying background. Port of utilities.estimateBackground.

    ``method='snip'`` (default) uses sqrt-space iterative peak clipping; ``'polynomial'``
    fits a robust low-order polynomial. With ``iterative=True`` peaks are masked,
    dilated, and the background re-estimated on the remainder. The result is always
    clamped to ``min(bg, y)``.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    n = yv.size
    if n < 3:
        return yv.copy()
    if method == "snip":
        bg = _snip_background(xv, yv, n, max_window_deg, smooth_passes)
    elif method == "polynomial":
        bg = _poly_background(xv, yv, n, poly_degree, iter_sigma)
    else:
        raise ValueError("method must be snip/polynomial")
    if iterative:
        bg = _iterative_refine(
            xv, yv, bg, n, method, max_window_deg, smooth_passes,
            poly_degree, iter_max_passes, iter_sigma,
        )
    return np.asarray(np.minimum(bg, yv), dtype=float)


def baseline_rolling_ball(
    y: ArrayLike, *, radius: int = 100, smooth: int = -1
) -> tuple[NDArray[np.float64], dict[str, int]]:
    """Rolling-ball baseline (grayscale morphological opening). Port of baselineRollingBall.

    Erodes then dilates the signal with a ball-shaped structuring element of the
    given ``radius`` (in samples), boxcar-smooths, and clamps to ``min(bg, y)``.
    ``smooth=-1`` auto-picks a half-width of ``round(radius/10)``. Returns
    ``(baseline, {"radius", "smooth"})``.
    """
    yv = np.asarray(y, dtype=float).ravel()
    n = yv.size
    smooth_hw = max(1, _matlab_round(radius / 10)) if smooth < 0 else _matlab_round(smooth)
    if n < 3:
        return yv.copy(), {"radius": radius, "smooth": smooth_hw}

    half_w = min(radius, n - 1)
    offsets = np.arange(-half_w, half_w + 1)
    rise = radius - np.sqrt(np.maximum(radius * radius - offsets.astype(float) ** 2, 0.0))

    eroded = np.full(n, np.inf)
    for off, rise_val in zip(offsets, rise, strict=True):
        i0, i1 = max(0, -int(off)), min(n - 1, n - 1 - int(off))
        if i1 >= i0:
            eroded[i0 : i1 + 1] = np.minimum(
                eroded[i0 : i1 + 1], yv[i0 + int(off) : i1 + int(off) + 1] + rise_val
            )
    dilated = np.full(n, -np.inf)
    for off, rise_val in zip(offsets, rise, strict=True):
        i0, i1 = max(0, -int(off)), min(n - 1, n - 1 - int(off))
        if i1 >= i0:
            dilated[i0 : i1 + 1] = np.maximum(
                dilated[i0 : i1 + 1], eroded[i0 + int(off) : i1 + int(off) + 1] - rise_val
            )

    baseline = dilated
    if smooth_hw > 0 and n > 2 * smooth_hw:
        pad = min(smooth_hw, n - 1)
        kernel = np.ones(2 * smooth_hw + 1) / (2 * smooth_hw + 1)
        padded = np.concatenate(
            [baseline[1 : pad + 1][::-1], baseline, baseline[n - 1 - pad : n - 1][::-1]]
        )
        baseline = np.convolve(padded, kernel, mode="valid")[:n]
    baseline = np.asarray(np.minimum(baseline, yv), dtype=float)
    return baseline, {"radius": radius, "smooth": smooth_hw}


def baseline_modpoly(
    y: ArrayLike, *, order: int = 5, max_iter: int = 100, tol: float = 1e-6
) -> tuple[NDArray[np.float64], dict[str, Any]]:
    """Modified-polynomial (Lieber) baseline. Port of baselineModPoly.

    Iteratively fits a polynomial of ``order`` and clips the working signal to
    ``min(signal, fit)`` until the RMS change (relative to the data range) drops
    below ``tol``. Returns ``(baseline, {"order", "nIter", "converged"})``.
    """
    yv = np.asarray(y, dtype=float).ravel()
    n = yv.size
    if n < 3:
        return yv.copy(), {"order": order, "nIter": 0, "converged": True}

    poly_ord = min(order, n - 1)
    x = np.arange(1, n + 1, dtype=float)
    xn = (x - float(np.mean(x))) / max(float(np.std(x, ddof=1)), _EPS)
    y_mod = yv.copy()
    y_range = max(float(np.max(yv) - np.min(yv)), _EPS)

    converged = False
    n_iter = 0
    coeffs = np.polyfit(xn, y_mod, poly_ord)
    for it in range(1, max_iter + 1):
        n_iter = it
        coeffs = np.polyfit(xn, y_mod, poly_ord)
        fit = np.polyval(coeffs, xn)
        y_new = np.minimum(y_mod, fit)
        rms = math.sqrt(float(np.mean((y_new - y_mod) ** 2)))
        y_mod = y_new
        if rms / y_range < tol:
            converged = True
            break

    baseline = np.asarray(np.minimum(np.polyval(coeffs, xn), yv), dtype=float)
    return baseline, {"order": poly_ord, "nIter": n_iter, "converged": converged}
