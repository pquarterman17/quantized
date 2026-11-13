"""Goodness-of-fit metrics with ONE definition of each, shared by every fitter.

Pure calc layer. Used by ``calc.fitting.curve_fit`` (the main fit result) and
``calc.fit_stats.fit_compare`` (the Diagnostics panel / model comparison), so
the AIC a user reads for a fit is the same number in both places (fitting
audit, finding 16 -- they used to differ by a constant, and by weighting).

Definitions (``r`` = residuals ``y - f``, ``w`` = fit weights, ``k`` = free
parameters, ``n`` = points):

* ``SSR  = Σ r²`` -- unweighted, data units squared.
* ``RMSE = √(SSR / n)`` -- unweighted, in the units of y. (It used to be the
  weighted ``√(Σ w r² / n)`` for weighted fits: a unitless number labelled as
  if it were in data units.)
* ``chiSq = Σ w r²`` -- the weighted objective the fit minimised (``= SSR``
  for an unweighted fit); ``chiSqRed = chiSq / (n - k)``.
* ``logLik`` -- the Gaussian log-likelihood with the variance profiled out and
  the weights taken as relative precisions:
  ``-n/2 · (ln(2π · chiSq/n) + 1) + ½ Σ ln w``. This is statsmodels'
  ``OLS/WLS.llf`` exactly, and MATLAB ``fitting.curveFit``'s for unit weights.
* ``AIC = 2k - 2 logLik``, ``AICc = AIC + 2k(k+1)/(n-k-1)``,
  ``BIC = k ln n - 2 logLik`` (statsmodels ``aic``/``bic``).

A perfect fit (``chiSq == 0``) has ``logLik = +inf`` -> AIC/AICc/BIC ``-inf``
(MATLAB's value); fewer than 2 points -> NaN.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

__all__ = ["fit_metrics", "information_criteria"]


def information_criteria(chi_sq: float, n: int, k: int, sum_log_w: float = 0.0) -> dict[str, float]:
    """``logLik``/``AIC``/``AICc``/``BIC`` from the weighted SSR (see module doc)."""
    nan = float("nan")
    if n < 2 or not math.isfinite(chi_sq):
        return {"logLik": nan, "AIC": nan, "AICc": nan, "BIC": nan}
    if chi_sq <= 0:
        return {"logLik": math.inf, "AIC": -math.inf, "AICc": -math.inf, "BIC": -math.inf}
    log_lik = -n / 2 * (math.log(2 * math.pi * chi_sq / n) + 1) + 0.5 * sum_log_w
    aic = 2 * k - 2 * log_lik
    dof_c = n - k - 1
    aicc = aic + 2 * k * (k + 1) / dof_c if dof_c > 0 else math.inf
    bic = k * math.log(n) - 2 * log_lik
    return {"logLik": log_lik, "AIC": aic, "AICc": aicc, "BIC": bic}


def fit_metrics(
    residuals: ArrayLike, k: int, weights: ArrayLike | None = None, *, legacy: bool = False
) -> dict[str, Any]:
    """SSR / RMSE / chiSq / chiSqRed / dof / n + information criteria (module doc).

    A zero-weight point is not an observation (direct weighting uses 0 to
    switch a point off): it is excluded from ``n``, the dof, SSR/RMSE and the
    information criteria, exactly as if it had been deleted. ``legacy``
    reproduces the pre-2026-11 curve_fit numbers for recomputing an old saved
    result: ``RMSE = √(chiSq/n)`` (weighted) and no ``Σ ln w`` in logLik.
    """
    r_all = np.asarray(residuals, dtype=float).ravel()
    w_all = np.ones(r_all.size) if weights is None else np.asarray(weights, dtype=float).ravel()
    used = w_all > 0
    r, w = r_all[used], w_all[used]
    n = int(r.size)
    ssr = float(np.sum(r**2))
    chi_sq = float(np.sum(w * r**2))
    dof = n - k
    sum_log_w = float(np.sum(np.log(w))) if weights is not None and not legacy else 0.0
    mean_sq = (chi_sq if legacy else ssr) / n if n > 0 else float("nan")
    return {
        "SSR": ssr,
        "RMSE": math.sqrt(mean_sq) if n > 0 else float("nan"),
        "chiSq": chi_sq,
        "chiSqRed": chi_sq / max(dof, 1),
        "dof": dof,
        "n": n,
        **information_criteria(chi_sq, n, k, sum_log_w),
    }
