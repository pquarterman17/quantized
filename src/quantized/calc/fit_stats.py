"""Fit-quality statistics: model comparison, residual diagnostics, error bands.

Ports of fitting.fitCompare / residualDiagnostics / fitBands. Pure calc layer,
all closed-form. The F-test p-value uses the regularized incomplete beta
(scipy.special.betainc). ``fit_bands`` takes its Student-t quantile from
``scipy.stats.t.ppf``: MATLAB's Cornish-Fisher approximation (built on a
4.5e-4-accurate normal quantile) was ~2e-4 off, and the band no longer has a
MATLAB golden to stay bit-compatible with (see ``fit_bands``).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import betainc
from scipy.stats import t as student_t

from .fit_metrics import information_criteria

__all__ = ["fit_bands", "fit_compare", "residual_diagnostics"]

_EPS = float(np.finfo(float).eps)
ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


def _norm_inv(p: NDArray[np.float64]) -> NDArray[np.float64]:
    """Standard-normal quantile (Abramowitz-Stegun 26.2.23), vectorized."""
    pa = np.asarray(p, dtype=float)
    pk = np.where(pa > 0.5, 1 - pa, pa)
    t = np.sqrt(-2 * np.log(pk))
    num = 2.515517 + 0.802853 * t + 0.010328 * t**2
    den = 1 + 1.432788 * t + 0.189269 * t**2 + 0.001308 * t**3
    approx = t - num / den
    return np.asarray(np.where(pa > 0.5, approx, -approx), dtype=float)


def fit_compare(
    y: ArrayLike,
    residuals: ArrayLike,
    n_params: int,
    *,
    resid_ref: ArrayLike | None = None,
    n_params_ref: float = float("nan"),
    weights: ArrayLike | None = None,
) -> dict[str, Any]:
    """Model-comparison metrics (R2/adjR2/AIC/AICc/BIC + nested F-test). Port of fitCompare.

    AIC/AICc/BIC follow ``calc.fit_metrics`` -- the SAME definition as
    ``curve_fit``'s (statsmodels' ``-2 llf + 2k``), computed on the weighted
    chi² when the fit's ``weights`` are passed -- so the Diagnostics panel and
    the fit result agree for the same fit (fitting audit, finding 16).
    MATLAB fitCompare used ``n·ln(RSS/n) + 2k``, a constant ``n(1 + ln 2π)``
    lower, on the unweighted RSS; the golden test documents the departure.
    ``rmse`` stays the unweighted ``√(RSS/n)`` in data units.
    """
    yv = np.asarray(y, dtype=float).ravel()
    res = np.asarray(residuals, dtype=float).ravel()
    n = yv.size
    p = n_params
    rss = float(np.sum(res**2))
    wv = None if weights is None else np.asarray(weights, dtype=float).ravel()
    if wv is not None and wv.size != n:
        raise ValueError(f"weights must have {n} entries (one per point), got {wv.size}")
    tss = float(np.sum((yv - np.mean(yv)) ** 2))
    rmse = math.sqrt(rss / max(n, 1))

    if tss < _EPS:
        r2 = adj_r2 = float("nan")
    else:
        r2 = 1 - rss / tss
        dof_denom = n - p - 1
        adj_r2 = 1 - (1 - r2) * (n - 1) / dof_denom if dof_denom > 0 else float("nan")

    chi_sq = rss if wv is None else float(np.sum(wv * res**2))
    sum_log_w = 0.0 if wv is None else float(np.sum(np.log(wv[wv > 0])))
    ic = information_criteria(chi_sq if chi_sq >= _EPS else 0.0, n, p, sum_log_w)
    aic, aicc, bic = ic["AIC"], ic["AICc"], ic["BIC"]

    f_stat = f_pvalue = float("nan")
    if resid_ref is not None and not math.isnan(n_params_ref):
        ref = np.asarray(resid_ref, dtype=float).ravel()
        p_ref = n_params_ref
        rss_ref = float(np.sum(ref**2))
        if ref.size == n and p_ref < p and p < n:
            df1 = p - p_ref
            df2 = n - p
            if df2 > 0 and rss > _EPS:
                f_stat = ((rss_ref - rss) / df1) / (rss / df2)
                x = df2 / (df2 + df1 * f_stat)
                f_pvalue = float(betainc(df2 / 2, df1 / 2, x))
            elif rss < _EPS:
                f_stat, f_pvalue = float("inf"), 0.0

    return {
        "R2": r2, "adjR2": adj_r2, "aic": aic, "aicc": aicc, "bic": bic,
        "rmse": rmse, "fStat": f_stat, "fPvalue": f_pvalue, "n": n, "p": p,
    }


def residual_diagnostics(residuals: ArrayLike) -> dict[str, Any]:
    """Residual diagnostics (QQ/DW/runs/skew/kurtosis). Port of residualDiagnostics."""
    r = np.asarray(residuals, dtype=float).ravel()
    n = r.size
    nan = float("nan")
    if n < 3:
        keys = ["durbinWatson", "runsTestZ", "runsTestP", "nRuns", "nPos", "nNeg",
                "skewness", "kurtosis"]
        return {"qqX": [], "qqY": [], **{k: nan for k in keys}}

    qq_y = np.sort(r)
    idx = np.arange(1, n + 1, dtype=float)
    qq_x = _norm_inv((idx - 0.375) / (n + 0.25))
    durbin_watson = float(np.sum(np.diff(r) ** 2) / np.sum(r**2))

    signs = r >= 0
    n_pos = int(np.sum(signs))
    n_neg = n - n_pos
    n_runs = 1 + int(np.sum(signs[:-1] != signs[1:]))
    if n_pos < 1 or n_neg < 1:
        runs_z = runs_p = nan
    else:
        mu_runs = (2 * n_pos * n_neg) / n + 1
        var_runs = (2 * n_pos * n_neg * (2 * n_pos * n_neg - n)) / (n**2 * (n - 1))
        if var_runs <= 0:
            runs_z = runs_p = nan
        else:
            runs_z = (n_runs - mu_runs) / math.sqrt(var_runs)
            runs_p = 2 * (0.5 * math.erfc(abs(runs_z) / math.sqrt(2)))

    mu = float(np.mean(r))
    s = float(np.std(r))  # population std (ddof=0)
    if s < _EPS:
        skew = kurt = nan
    else:
        skew = float(np.mean(((r - mu) / s) ** 3))
        kurt = float(np.mean(((r - mu) / s) ** 4) - 3)

    return {
        "qqX": qq_x, "qqY": qq_y, "durbinWatson": durbin_watson,
        "runsTestZ": runs_z, "runsTestP": runs_p, "nRuns": n_runs,
        "nPos": n_pos, "nNeg": n_neg, "skewness": skew, "kurtosis": kurt,
    }


def fit_bands(
    x_grid: ArrayLike,
    model_fcn: ModelFn,
    params: ArrayLike,
    covar: ArrayLike | None,
    n_points: int,
    n_free: int,
    *,
    level: float = 0.95,
    mse: float | None = None,
) -> dict[str, Any]:
    """Confidence + prediction bands from a fit (numerical Jacobian). Port of
    fitBands, with two latent MATLAB bugs fixed (docs/fitting_statistics.md):

    * prediction variance = ``var_ci + mse``, where ``mse`` is the fit's
      observation variance (``curve_fit``'s ``MSE``: the reduced chi² for an
      unweighted fit; for a weighted fit the mean per-point sigma², times the
      reduced chi² when errors are scaled). MATLAB used
      ``Σ var_ci / tr(JᵀJ)`` -- a curve-variance average, not the residual
      scatter -- which made the band ~7x too narrow. ``mse=None`` (unknown)
      returns NaN prediction limits rather than a wrong band.
    * the Student-t quantile uses the residual dof ``n_points - n_free``;
      MATLAB used ``n_free`` (3 dof for a Gaussian: a CI ~1.6x too wide).

    Both now match statsmodels ``get_prediction`` (linear) and the delta
    method on scipy's ``pcov`` (nonlinear).
    """
    xg = np.asarray(x_grid, dtype=float).ravel()
    pp = np.asarray(params, dtype=float).ravel()
    m, p_count = xg.size, pp.size
    nan_col = np.full(m, np.nan)

    cov = np.asarray(covar, dtype=float) if covar is not None else np.zeros((0, 0))
    if cov.shape != (p_count, p_count):
        return {"yFit": np.asarray(model_fcn(xg, pp), dtype=float), "ciLo": nan_col,
                "ciHi": nan_col, "piLo": nan_col, "piHi": nan_col, "level": level}
    try:
        # Positive SEMI-definite is enough: a held parameter's row/column is 0.
        np.linalg.cholesky(cov + np.eye(p_count) * _EPS * max(float(np.max(np.abs(cov))), _EPS))
    except np.linalg.LinAlgError:
        return {"yFit": np.asarray(model_fcn(xg, pp), dtype=float), "ciLo": nan_col,
                "ciHi": nan_col, "piLo": nan_col, "piHi": nan_col, "level": level}

    y_fit = np.asarray(model_fcn(xg, pp), dtype=float)
    dp = np.maximum(np.abs(pp) * 1e-7, 1e-10)
    jac = np.zeros((m, p_count))
    for j in range(p_count):
        p_plus = pp.copy()
        p_plus[j] += dp[j]
        jac[:, j] = (np.asarray(model_fcn(xg, p_plus), dtype=float) - y_fit) / dp[j]

    var_ci = np.maximum(np.sum((jac @ cov) * jac, axis=1), 0.0)
    t_crit = float(student_t.ppf(1 - (1 - level) / 2, max(n_points - n_free, 1)))
    half_ci = t_crit * np.sqrt(var_ci)
    if mse is None or not math.isfinite(mse) or mse < 0:
        pi_lo, pi_hi = nan_col, nan_col
    else:
        half_pi = t_crit * np.sqrt(var_ci + mse)
        pi_lo, pi_hi = y_fit - half_pi, y_fit + half_pi

    return {
        "yFit": y_fit,
        "ciLo": y_fit - half_ci, "ciHi": y_fit + half_ci,
        "piLo": pi_lo, "piHi": pi_hi,
        "level": level,
    }
