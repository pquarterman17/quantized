"""Quantiles, failure probabilities and the fitted line of a life fit, with
Wald bands by the delta method (GAP_AUDIT_9 G8).

For a fit with linear predictor ``mu0 = x0 . b`` at a covariate row ``x0``:

- quantile ``p``: ``y_p = mu0 + sigma * w_p`` (``w_p`` = standard quantile);
  ``var(y_p)`` from the gradient ``[x0, sigma * w_p]`` over ``(b, ln sigma)``.
  The band is ``y_p +/- z se`` and, for the log families, ``t_p = exp(y_p)``
  so it is a positive multiplicative band (exponential Wald, as in Meeker &
  Escobar 1998, sec. 8.3).
- failure probability at ``t``: ``F = G(z_t)`` with ``z_t = (g(t) - mu0)/sigma``;
  the band is ``G(z_t +/- z se(z_t))`` (gradient ``[-x0/sigma, -z_t]``), so it
  stays inside (0, 1).
- the fitted probability-plot line is ``z_t`` against ``g(t)``; its band is the
  same ``z_t +/- z se`` in plot coordinates.

Wald bands are approximate for small samples (Meeker & Escobar recommend
likelihood-ratio bands there); provisional, owner to confirm.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.life_core import DISTRIBUTIONS, MLFit, std_cdf, std_quantile

__all__ = ["fitted_line", "predict_probabilities", "predict_quantiles"]


def _grad_cov(fit: MLFit, g: NDArray[np.float64]) -> float:
    """Variance of a linear functional ``g`` of (b, ln sigma)."""
    return float(g @ fit.cov @ g)


def predict_quantiles(
    fit: MLFit, x0: NDArray[np.float64], probs: list[float], zc: float
) -> list[dict[str, Any]]:
    std, log_time, _ = DISTRIBUTIONS[fit.dist]
    mu0 = float(x0 @ fit.beta)
    out = []
    for p in probs:
        if not 0.0 < p < 1.0:
            raise ValueError(f"quantile probabilities must be strictly between 0 and 1, got {p}")
        w = float(std_quantile(std, p))
        y = mu0 + fit.sigma * w
        se = float(np.sqrt(max(_grad_cov(fit, np.append(x0, fit.sigma * w)), 0.0)))
        lo, hi = y - zc * se, y + zc * se
        if log_time:
            out.append(
                {
                    "p": p,
                    "time": float(np.exp(y)),
                    "ci_low": float(np.exp(lo)),
                    "ci_high": float(np.exp(hi)),
                    "se_log": se,
                }
            )
        else:
            out.append({"p": p, "time": y, "ci_low": lo, "ci_high": hi, "se": se})
    return out


def _z_and_se(
    fit: MLFit, x0: NDArray[np.float64], times: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    _, log_time, _ = DISTRIBUTIONS[fit.dist]
    y = np.log(times) if log_time else times
    z = (y - float(x0 @ fit.beta)) / fit.sigma
    se = np.empty(z.size)
    for i, zi in enumerate(z):
        se[i] = np.sqrt(max(_grad_cov(fit, np.append(-x0 / fit.sigma, -zi)), 0.0))
    return z, se


def predict_probabilities(
    fit: MLFit, x0: NDArray[np.float64], times: list[float], zc: float
) -> list[dict[str, Any]]:
    std, log_time, _ = DISTRIBUTIONS[fit.dist]
    t = np.asarray(times, dtype=float)
    if np.any(~np.isfinite(t)) or np.any(t < 0) or (log_time and np.any(t <= 0)):
        raise ValueError("evaluation times must be positive finite numbers")
    z, se = _z_and_se(fit, x0, t)
    f = std_cdf(std, z)
    lo, hi = std_cdf(std, z - zc * se), std_cdf(std, z + zc * se)
    return [
        {
            "time": float(t[i]),
            "probability": float(f[i]),
            "ci_low": float(lo[i]),
            "ci_high": float(hi[i]),
            "reliability": float(1.0 - f[i]),
        }
        for i in range(t.size)
    ]


def fitted_line(
    fit: MLFit, x0: NDArray[np.float64], times: NDArray[np.float64], zc: float
) -> list[dict[str, float]]:
    """The fitted line and its pointwise band in linearised-probability (z) coordinates."""
    z, se = _z_and_se(fit, x0, times)
    return [
        {
            "t": float(times[i]),
            "z": float(z[i]),
            "z_low": float(z[i] - zc * se[i]),
            "z_high": float(z[i] + zc * se[i]),
        }
        for i in range(times.size)
    ]
