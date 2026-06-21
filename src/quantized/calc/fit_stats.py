"""Fit-quality statistics: model comparison, residual diagnostics, error bands.

Ports of fitting.fitCompare / residualDiagnostics / fitBands. Pure calc layer,
all closed-form. The F-test p-value and the Student-t quantile use the
regularized incomplete beta (scipy.special.betainc); ``fit_bands`` replicates
MATLAB's Cornish-Fisher + bisection t-quantile for exact parity.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import betainc

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
) -> dict[str, Any]:
    """Model-comparison metrics (R2/adjR2/AIC/AICc/BIC + nested F-test). Port of fitCompare."""
    yv = np.asarray(y, dtype=float).ravel()
    res = np.asarray(residuals, dtype=float).ravel()
    n = yv.size
    p = n_params
    rss = float(np.sum(res**2))
    tss = float(np.sum((yv - np.mean(yv)) ** 2))
    rmse = math.sqrt(rss / max(n, 1))

    if tss < _EPS:
        r2 = adj_r2 = float("nan")
    else:
        r2 = 1 - rss / tss
        dof_denom = n - p - 1
        adj_r2 = 1 - (1 - r2) * (n - 1) / dof_denom if dof_denom > 0 else float("nan")

    if rss < _EPS:
        aic = aicc = bic = float("-inf")
    elif n < 2:
        aic = aicc = bic = float("nan")
    else:
        log_rss_n = math.log(rss / n)
        aic = n * log_rss_n + 2 * p
        bic = n * log_rss_n + p * math.log(n)
        dof_aicc = n - p - 1
        aicc = aic + 2 * p * (p + 1) / dof_aicc if dof_aicc > 0 else float("inf")

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


def _t_cdf(t: float, dof: float) -> float:
    return 1 - 0.5 * float(betainc(dof / 2, 0.5, dof / (dof + t**2)))


def _t_inv_bisection(p: float, dof: float) -> float:
    a, b = 0.0, 1000.0
    for _ in range(80):
        mid = (a + b) / 2
        if _t_cdf(mid, dof) < p:
            a = mid
        else:
            b = mid
        if (b - a) < 1e-8:
            break
    return (a + b) / 2


def _t_inv_two_tail(alpha: float, dof: float) -> float:
    p = 1 - alpha / 2
    z = float(_norm_inv(np.asarray(p)))
    if dof >= 1e6:
        return z
    if dof <= 5:
        return _t_inv_bisection(p, dof)
    g1 = (z**3 + z) / (4 * dof)
    g2 = (5 * z**5 + 16 * z**3 + 3 * z) / (96 * dof**2)
    g3 = (3 * z**7 + 19 * z**5 + 17 * z**3 - 15 * z) / (384 * dof**3)
    g4 = (79 * z**9 + 776 * z**7 + 1482 * z**5 - 1920 * z**3 - 945 * z) / (92160 * dof**4)
    return z + g1 + g2 + g3 + g4


def fit_bands(
    x_grid: ArrayLike,
    model_fcn: ModelFn,
    params: ArrayLike,
    covar: ArrayLike | None,
    n_points: int,
    n_free: int,
    *,
    level: float = 0.95,
) -> dict[str, Any]:
    """Confidence + prediction bands from a fit (numerical Jacobian). Port of fitBands."""
    xg = np.asarray(x_grid, dtype=float).ravel()
    pp = np.asarray(params, dtype=float).ravel()
    m, p_count = xg.size, pp.size
    nan_col = np.full(m, np.nan)

    cov = np.asarray(covar, dtype=float) if covar is not None else np.zeros((0, 0))
    if cov.shape != (p_count, p_count):
        return {"yFit": np.asarray(model_fcn(xg, pp), dtype=float), "ciLo": nan_col,
                "ciHi": nan_col, "piLo": nan_col, "piHi": nan_col, "level": level}
    try:
        np.linalg.cholesky(cov)
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
    tr_jtj = max(float(np.trace(jac.T @ jac)), _EPS)
    s2 = float(np.sum(var_ci)) / tr_jtj
    var_pi = var_ci + s2
    t_crit = _t_inv_two_tail(1 - level, max(n_free, 1))
    half_ci = t_crit * np.sqrt(var_ci)
    half_pi = t_crit * np.sqrt(var_pi)

    return {
        "yFit": y_fit,
        "ciLo": y_fit - half_ci, "ciHi": y_fit + half_ci,
        "piLo": y_fit - half_pi, "piHi": y_fit + half_pi,
        "level": level,
    }
