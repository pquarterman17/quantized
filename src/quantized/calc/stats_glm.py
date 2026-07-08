"""Generalized Linear Models: logistic and Poisson regression with inference.

GAP_PLAN #30 (stats extra) — GLM via statsmodels (BSD-3). Result-dict shapes
match ``stats_multivar.multiple_regression`` so downstream code (routes, report
sheets) treats linear/logistic/Poisson alike. Rows with any non-finite value
are dropped (listwise deletion). Requires ``pip install quantized[stats]``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["logistic_regression", "poisson_regression"]

_EPS = float(np.finfo(float).tiny)


def _check_statsmodels() -> None:
    """Raise a clear error if statsmodels is not installed."""
    try:
        import statsmodels  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            "GLM methods require statsmodels. Install with: pip install quantized[stats]"
        ) from exc


def _as_matrix(columns: list[NDArray[np.float64]] | NDArray[np.float64]) -> NDArray[np.float64]:
    """Stack same-length 1-D columns into an (n, k) matrix (validates lengths)."""
    if isinstance(columns, np.ndarray) and columns.ndim == 2:
        return np.asarray(columns, dtype=float)
    cols = [np.asarray(c, dtype=float).ravel() for c in columns]
    if len(cols) < 1:
        raise ValueError("need at least one column")
    n = cols[0].size
    if any(c.size != n for c in cols):
        raise ValueError("all columns must have the same length")
    return np.column_stack(cols)


def _binomial_deviance(y: NDArray[np.float64], mu: NDArray[np.float64]) -> float:
    """Bernoulli/binomial deviance: D = 2·Σ[y·log(y/μ) + (1-y)·log((1-y)/(1-μ))].

    ``statsmodels``' discrete-choice ``LogitResults`` does not expose a
    ``.deviance`` scalar (only per-observation ``resid_dev``), unlike the
    ``genmod.GLM`` family models — compute it directly from the standard
    formula (matches ``sm.GLM(..., family=Binomial()).deviance`` exactly).
    """
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = np.where(y > 0, y * np.log(y / mu), 0.0)
        t2 = np.where(y < 1, (1.0 - y) * np.log((1.0 - y) / (1.0 - mu)), 0.0)
    return float(2.0 * np.sum(t1 + t2))


def _poisson_deviance(y: NDArray[np.float64], mu: NDArray[np.float64]) -> float:
    """Poisson deviance: D = 2·Σ[y·log(y/μ) - (y - μ)].

    ``statsmodels``' discrete-choice ``PoissonResults`` does not expose a
    ``.deviance`` scalar — compute it directly (matches
    ``sm.GLM(..., family=Poisson()).deviance`` exactly).
    """
    with np.errstate(divide="ignore", invalid="ignore"):
        term = np.where(y > 0, y * np.log(y / mu), 0.0)
    return float(2.0 * np.sum(term - (y - mu)))


def logistic_regression(
    predictors: list[NDArray[np.float64]] | NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Logistic regression ``logit(p) = b0 + b1·x1 + … + bk·xk`` with inference.

    ``y`` must be binary (0/1). ``predictors`` is a list of k same-length
    columns (or an (n, k) matrix); the intercept is always included. Returns
    coefficients (intercept first), standard errors, z-stats/p-values, 95%
    confidence intervals, AIC, and deviance — same key vocabulary as
    ``multiple_regression``. Rows containing any non-finite value are dropped
    (listwise deletion).

    Reference: logistic GLM via statsmodels ``Logit(...).fit(disp=0)``
    (Newton-Raphson IRLS).
    """
    _check_statsmodels()
    import statsmodels.api as sm

    xmat0 = _as_matrix(predictors)
    yv = np.asarray(y, dtype=float).ravel()
    if yv.size != xmat0.shape[0]:
        raise ValueError(f"y length {yv.size} != predictor length {xmat0.shape[0]}")

    # Listwise NaN deletion
    keep = np.isfinite(yv) & np.all(np.isfinite(xmat0), axis=1)
    xmat0, yv = xmat0[keep], yv[keep]
    n, k = xmat0.shape

    if n < k + 2:
        raise ValueError(f"need at least {k + 2} complete rows for {k} predictors")

    # Check binary
    unique_y = np.unique(yv)
    is_binary = (
        np.array_equal(unique_y, [0.0, 1.0])
        or np.array_equal(unique_y, [0.0])
        or np.array_equal(unique_y, [1.0])
    )
    if not is_binary:
        raise ValueError("logistic regression requires binary y (0/1)")

    # Add constant, fit
    xmat = sm.add_constant(xmat0)
    model = sm.Logit(yv, xmat)
    result = model.fit(disp=0)

    coeffs = np.asarray(result.params, dtype=float)
    se = np.asarray(result.bse, dtype=float)
    z_stats = np.asarray(result.tvalues, dtype=float)
    p_values = np.asarray(result.pvalues, dtype=float)

    # 95% CIs (z_crit ≈ 1.96 for alpha=0.05)
    z_crit = 1.959964  # scipy.stats.norm.ppf(1 - alpha / 2)
    ci_low = np.asarray(coeffs - z_crit * se, dtype=float)
    ci_high = np.asarray(coeffs + z_crit * se, dtype=float)

    # Predictions for pseudo-R²
    y_pred = np.asarray(result.predict(xmat), dtype=float)

    # McFadden's pseudo-R² = 1 - (LL_full / LL_null)
    null_model = sm.Logit(yv, sm.add_constant(np.ones(n))).fit(disp=0)
    ll_full = float(result.llf)
    ll_null = float(null_model.llf)
    # ll_null is a log-likelihood (log of a probability mass ≤ 1), so it is
    # always ≤ 0 — guard the magnitude while preserving sign. `max(ll_null,
    # _EPS)` (the previous form) picks the tiny *positive* _EPS whenever
    # ll_null is negative (virtually always), which inverts the sign of the
    # ratio and silently saturates pseudoR2 to 1.0 for every non-degenerate
    # fit — verified against the McFadden pseudo-R² statsmodels itself
    # reports (0.374 on the spector logistic reference case).
    ll_null_safe = -max(abs(ll_null), _EPS)
    pseudo_r2 = 1.0 - (ll_full / ll_null_safe)

    return {
        "coeffs": coeffs,  # intercept first
        "se": se,
        "zStats": z_stats,
        "pValues": p_values,
        "ciLow": ci_low,
        "ciHigh": ci_high,
        "pseudoR2": float(np.clip(pseudo_r2, 0.0, 1.0)),
        "AIC": float(result.aic),
        "deviance": _binomial_deviance(yv, y_pred),
        "yPred": y_pred,
        "N": n,
        "alpha": alpha,
    }


def poisson_regression(
    predictors: list[NDArray[np.float64]] | NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Poisson regression ``log(μ) = b0 + b1·x1 + … + bk·xk`` with inference.

    ``y`` must be non-negative integers (counts). ``predictors`` is a list of
    k same-length columns (or an (n, k) matrix); the intercept is always
    included. Returns coefficients (intercept first), standard errors,
    z-stats/p-values, 95% confidence intervals, AIC, and deviance — same key
    vocabulary as ``multiple_regression``. Rows containing any non-finite
    value are dropped (listwise deletion).

    Reference: Poisson GLM via statsmodels ``Poisson(...).fit(disp=0)``
    (Fisher scoring / IRLS).
    """
    _check_statsmodels()
    import statsmodels.api as sm

    xmat0 = _as_matrix(predictors)
    yv = np.asarray(y, dtype=float).ravel()
    if yv.size != xmat0.shape[0]:
        raise ValueError(f"y length {yv.size} != predictor length {xmat0.shape[0]}")

    # Listwise NaN deletion
    keep = np.isfinite(yv) & np.all(np.isfinite(xmat0), axis=1)
    xmat0, yv = xmat0[keep], yv[keep]
    n, k = xmat0.shape

    if n < k + 2:
        raise ValueError(f"need at least {k + 2} complete rows for {k} predictors")

    # Check non-negative counts
    if np.any(yv < 0.0) or not np.allclose(yv, np.round(yv)):
        raise ValueError("Poisson regression requires non-negative integer y")

    # Add constant, fit
    xmat = sm.add_constant(xmat0)
    model = sm.Poisson(yv, xmat)
    result = model.fit(disp=0)

    coeffs = np.asarray(result.params, dtype=float)
    se = np.asarray(result.bse, dtype=float)
    z_stats = np.asarray(result.tvalues, dtype=float)
    p_values = np.asarray(result.pvalues, dtype=float)

    # 95% CIs
    z_crit = 1.959964
    ci_low = np.asarray(coeffs - z_crit * se, dtype=float)
    ci_high = np.asarray(coeffs + z_crit * se, dtype=float)

    # Predictions
    y_pred = np.asarray(result.predict(xmat), dtype=float)

    # McFadden's pseudo-R²
    null_model = sm.Poisson(yv, sm.add_constant(np.ones(n))).fit(disp=0)
    ll_full = float(result.llf)
    ll_null = float(null_model.llf)
    # ll_null is a log-likelihood (log of a probability mass ≤ 1), so it is
    # always ≤ 0 — guard the magnitude while preserving sign. `max(ll_null,
    # _EPS)` (the previous form) picks the tiny *positive* _EPS whenever
    # ll_null is negative (virtually always), which inverts the sign of the
    # ratio and silently saturates pseudoR2 to 1.0 for every non-degenerate
    # fit — verified against the McFadden pseudo-R² statsmodels itself
    # reports (0.374 on the spector logistic reference case).
    ll_null_safe = -max(abs(ll_null), _EPS)
    pseudo_r2 = 1.0 - (ll_full / ll_null_safe)

    return {
        "coeffs": coeffs,
        "se": se,
        "zStats": z_stats,
        "pValues": p_values,
        "ciLow": ci_low,
        "ciHigh": ci_high,
        "pseudoR2": float(np.clip(pseudo_r2, 0.0, 1.0)),
        "AIC": float(result.aic),
        "deviance": _poisson_deviance(yv, y_pred),
        "yPred": y_pred,
        "N": n,
        "alpha": alpha,
    }
