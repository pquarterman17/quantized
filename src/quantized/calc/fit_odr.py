"""Orthogonal distance (Deming) regression. Port of fitting.odrFit.

Pure calc layer. Linear fit ``y = slope·x + intercept`` minimising the squared
*perpendicular* distances (errors in both x and y), with a variance ratio
``lambda = σy²/σx²`` (λ→∞ → OLS, λ→0 → inverse OLS, λ=1 → symmetric ODR). The
estimator is closed-form (Deming); standard errors come from jackknife
leave-one-out refits — exactly as the MATLAB original.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["odr_fit"]

_EPS = float(np.finfo(float).eps)


def _deming_fit(x: NDArray[np.float64], y: NDArray[np.float64], lam: float) -> tuple[float, float]:
    """Closed-form Deming regression on centered moments (port of demingFit)."""
    xbar, ybar = float(np.mean(x)), float(np.mean(y))
    xc = x - xbar
    yc = y - ybar
    sxx = float(np.sum(xc**2))
    syy = float(np.sum(yc**2))
    sxy = float(np.sum(xc * yc))
    if abs(sxy) < _EPS:
        slope = 0.0  # no linear correlation → flat line anchored at the mean
    else:
        disc = (syy - lam * sxx) ** 2 + 4.0 * lam * sxy**2
        slope = (syy - lam * sxx + math.copysign(1.0, sxy) * math.sqrt(disc)) / (2.0 * sxy)
    intercept = ybar - slope * xbar
    return slope, intercept


def odr_fit(
    x: ArrayLike,
    y: ArrayLike,
    *,
    lambda_: float = 1.0,
    x_error: ArrayLike | None = None,
    y_error: ArrayLike | None = None,
) -> dict[str, Any]:
    """Deming/orthogonal linear regression. Port of fitting.odrFit.

    ``lambda_`` is the σy²/σx² ratio (default 1 → symmetric ODR). If both
    ``x_error`` and ``y_error`` are given, λ is derived as
    ``(mean(y_error)/mean(x_error))²``. Returns a dict with ``slope``/``intercept``,
    jackknife ``slopeErr``/``interceptErr``, ``lambda``, ``rss``, ``rmse``, ``n``.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    n = xv.size
    if n < 3:
        raise ValueError(f"ODR requires at least 3 points (got {n})")

    lam = float(lambda_)
    if lam <= 0:
        raise ValueError("lambda_ must be positive")
    if x_error is not None and y_error is not None:
        xe_mean = float(np.nanmean(np.asarray(x_error, dtype=float)))
        ye_mean = float(np.nanmean(np.asarray(y_error, dtype=float)))
        if xe_mean <= 0:
            raise ValueError("mean x_error must be positive")
        lam = (ye_mean / xe_mean) ** 2

    slope, intercept = _deming_fit(xv, yv, lam)

    # Orthogonal residuals: perpendicular distance from each point to the line.
    res = (slope * xv - yv + intercept) / math.sqrt(slope**2 + 1.0)
    rss = float(np.sum(res**2))
    rmse = math.sqrt(rss / n)

    # Jackknife standard errors — refit n times leaving one point out.
    slopes = np.empty(n)
    intercepts = np.empty(n)
    for k in range(n):
        mask = np.arange(n) != k
        slopes[k], intercepts[k] = _deming_fit(xv[mask], yv[mask], lam)
    factor = (n - 1) / n
    slope_err = math.sqrt(factor * float(np.sum((slopes - np.mean(slopes)) ** 2)))
    intercept_err = math.sqrt(factor * float(np.sum((intercepts - np.mean(intercepts)) ** 2)))

    return {
        "slope": slope,
        "intercept": intercept,
        "slopeErr": slope_err,
        "interceptErr": intercept_err,
        "lambda": lam,
        "rss": rss,
        "rmse": rmse,
        "n": n,
    }
