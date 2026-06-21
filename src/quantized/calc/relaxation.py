"""Magnetic relaxation model comparison. Port of utilities.compareRelaxation.

Pure calc layer. Fits Arrhenius (lnτ = lnτ₀ + Ea/(kB·T), linear/closed-form) and
Vogel-Fulcher-Tammann (lnτ = lnτ₀ + Ea/(kB·(T-T₀)), nonlinear Nelder-Mead) to
relaxation-time vs temperature data, then ranks them by AIC/BIC.

Parity note: the Arrhenius fit and its metrics are exact; the VFT fit uses
Nelder-Mead, so scipy and MATLAB ``fminsearch`` may land at marginally different
points — the VFT parameters are matched only to a loose tolerance.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import minimize

__all__ = ["compare_relaxation"]

_KB = 8.617333e-5  # Boltzmann constant, eV/K
_EPS = float(np.finfo(float).eps)


def _compute_metrics(
    y: NDArray[np.float64], residuals: NDArray[np.float64], n_params: int
) -> tuple[float, float, float]:
    """Return (AIC, BIC, R²) for a fit. Port of the local computeMetrics helper."""
    n = y.size
    rss = float(np.sum(residuals**2))
    tss = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 - rss / max(tss, _EPS)
    if rss < _EPS:
        return float("-inf"), float("-inf"), r2
    log_l = n * math.log(rss / n)
    return log_l + 2 * n_params, log_l + n_params * math.log(n), r2


def _vft_rss(
    p: NDArray[np.float64], t: NDArray[np.float64], lntau_obs: NDArray[np.float64], tmin: float
) -> float:
    """VFT sum-of-squared residuals with the MATLAB penalty walls."""
    lntau0, ea, t0 = float(p[0]), float(p[1]), float(p[2])
    if t0 >= tmin - 0.5:
        return 1e12 * (1.0 + abs(t0 - tmin + 0.5))
    denom = _KB * (t - t0)
    if np.any(denom <= 0):
        return 1e12
    pred = lntau0 + ea / denom
    return float(np.sum((lntau_obs - pred) ** 2))


def compare_relaxation(
    temperature: ArrayLike, relaxation_time: ArrayLike
) -> dict[str, Any]:
    """Compare Arrhenius vs VFT relaxation fits. Port of utilities.compareRelaxation.

    Returns ``{"arrhenius", "vft", "preferred", "deltaAIC", "deltaBIC"}``. Each
    model sub-dict carries tau0, Ea_eV, R², AIC, BIC (VFT also T0). ``preferred``
    is "VFT" when ΔBIC > 0 (VFT lower BIC), else "Arrhenius".
    """
    t = np.asarray(temperature, dtype=float).ravel()
    tau = np.asarray(relaxation_time, dtype=float).ravel()
    n = t.size
    if n != tau.size:
        raise ValueError("temperature and relaxation_time must have the same length")
    if n < 5:
        raise ValueError("at least 5 data points are required")
    if np.any(tau <= 0):
        raise ValueError("all relaxation times must be positive")
    if np.any(t <= 0):
        raise ValueError("all temperatures must be positive (K)")

    lntau = np.log(tau)
    xmat = np.column_stack([np.ones(n), 1.0 / t])
    b = np.linalg.lstsq(xmat, lntau, rcond=None)[0]
    aic_a, bic_a, r2_a = _compute_metrics(lntau, lntau - xmat @ b, 2)
    arrhenius = {
        "tau0": math.exp(b[0]),
        "Ea_eV": float(b[1] * _KB),
        "R2": r2_a,
        "AIC": aic_a,
        "BIC": bic_a,
    }

    tmin = float(t.min())
    p0 = np.array([b[0], b[1] * _KB, max(0.0, tmin * 0.5)])
    res = minimize(
        _vft_rss,
        p0,
        args=(t, lntau, tmin),
        method="Nelder-Mead",
        options={"maxiter": 20000, "maxfev": 50000, "xatol": 1e-10, "fatol": 1e-12},
    )
    p_vft = np.asarray(res.x, dtype=float)
    t0_vft = min(float(p_vft[2]), tmin - 1.0)
    ea_vft = float(p_vft[1])
    lntau_vft_fit = p_vft[0] + ea_vft / (_KB * np.maximum(t - t0_vft, _EPS))
    aic_v, bic_v, r2_v = _compute_metrics(lntau, lntau - lntau_vft_fit, 3)
    vft = {
        "tau0": math.exp(p_vft[0]),
        "Ea_eV": ea_vft,
        "T0": t0_vft,
        "R2": r2_v,
        "AIC": aic_v,
        "BIC": bic_v,
    }

    delta_aic = aic_a - aic_v
    delta_bic = bic_a - bic_v
    return {
        "arrhenius": arrhenius,
        "vft": vft,
        "preferred": "VFT" if delta_bic > 0 else "Arrhenius",
        "deltaAIC": delta_aic,
        "deltaBIC": delta_bic,
    }
