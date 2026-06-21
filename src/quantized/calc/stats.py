"""Pure statistics utilities (no Statistics Toolbox). Ports of MATLAB +utilities.

All use MATLAB conventions: sample std/var (ddof=1), bias-corrected sample
skewness/kurtosis (excess), quartiles by linear interpolation on 1..n.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.special import betainc

__all__ = ["descriptive_stats", "lin_regress"]

_EPS = float(np.finfo(float).eps)


def _t_cdf(t: NDArray[np.float64], nu: float) -> NDArray[np.float64]:
    """Student-t CDF via regularized incomplete beta (matches MATLAB tcdf_local)."""
    tv = np.asarray(t, dtype=float)
    x = nu / (nu + tv**2)
    p = 1.0 - 0.5 * betainc(nu / 2.0, 0.5, x)
    return np.asarray(np.where(tv < 0, 1.0 - p, p), dtype=float)


def _f_cdf(f: float, d1: float, d2: float) -> float:
    """F-distribution CDF via regularized incomplete beta (matches fcdf_builtin)."""
    x = d1 * f / (d1 * f + d2)
    return float(betainc(d1 / 2.0, d2 / 2.0, x))


def descriptive_stats(x: NDArray[np.float64]) -> dict[str, Any]:
    """Descriptive statistics of a 1-D array (NaNs dropped). Port of descriptiveStats."""
    arr = np.asarray(x, dtype=float).ravel()
    arr = arr[~np.isnan(arr)]
    n = int(arr.size)
    nan = float("nan")
    if n == 0:
        keys = ["mean", "median", "std", "sem", "var", "min", "max", "range",
                "q1", "q3", "iqr", "skewness", "kurtosis"]
        return {"N": 0, **{k: nan for k in keys}}

    mean = float(np.mean(arr))
    std = float(np.std(arr, ddof=1)) if n > 1 else nan
    s: dict[str, Any] = {
        "N": n,
        "mean": mean,
        "median": float(np.median(arr)),
        "std": std,
        "sem": (std / math.sqrt(max(n, 1))) if not math.isnan(std) else nan,
        "var": float(np.var(arr, ddof=1)) if n > 1 else nan,
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
    }
    s["range"] = s["max"] - s["min"]

    if n >= 4:
        xs = np.sort(arr)
        idx = np.arange(1, n + 1, dtype=float)
        s["q1"] = float(np.interp(0.25 * (n + 1), idx, xs))
        s["q3"] = float(np.interp(0.75 * (n + 1), idx, xs))
        s["iqr"] = s["q3"] - s["q1"]
    else:
        s["q1"] = s["q3"] = s["iqr"] = nan

    if n >= 3 and not math.isnan(std) and std > 0:
        m3 = float(np.mean((arr - mean) ** 3))
        s["skewness"] = m3 / std**3 * (n**2 / ((n - 1) * (n - 2)))
    else:
        s["skewness"] = nan

    if n >= 4 and not math.isnan(std) and std > 0:
        m4 = float(np.mean((arr - mean) ** 4))
        raw_kurt = m4 / std**4
        s["kurtosis"] = ((n + 1) * raw_kurt - 3 * (n - 1)) * (n - 1) / ((n - 2) * (n - 3))
    else:
        s["kurtosis"] = nan

    return s


def lin_regress(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    order: int = 1,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Polynomial least-squares regression with inference. Port of utilities.linRegress.

    Returns coefficients (low→high power), standard errors, t-stats and p-values,
    R^2 / adjusted R^2, the F-statistic and its p-value, RMSE, residuals and the
    fitted curve. The MATLAB ``confBand``/``predBand`` function handles are not
    ported (call sites recompute bands directly when needed).

    p-values use the regularized incomplete beta (``scipy.special.betainc``), which
    matches the MATLAB local ``tcdf``/``fcdf`` implementations exactly.
    """
    if order < 1:
        raise ValueError("order must be a positive integer")
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    n = xv.size
    k = order + 1
    if n < k + 1:
        raise ValueError(f"need at least {k + 1} points for order-{order} regression")

    # Vandermonde with increasing powers: columns x^0, x^1, ..., x^order.
    xmat = np.vander(xv, k, increasing=True)
    xtx = xmat.T @ xmat
    coeffs = np.linalg.solve(xtx, xmat.T @ yv)
    y_fit = xmat @ coeffs
    residuals = yv - y_fit
    df = n - k

    ss_res = float(np.sum(residuals**2))
    ss_tot = float(np.sum((yv - np.mean(yv)) ** 2))
    ss_reg = ss_tot - ss_res
    r2 = 1.0 - ss_res / max(ss_tot, _EPS)
    r2_adj = 1.0 - (ss_res / df) / (ss_tot / (n - 1))
    mse = ss_res / df
    rmse = math.sqrt(mse)
    f_stat = (ss_reg / order) / max(mse, _EPS)
    f_pvalue = 1.0 - _f_cdf(f_stat, order, df)

    cov_b = mse * np.linalg.inv(xtx)
    se = np.sqrt(np.maximum(np.diag(cov_b), 0.0))
    t_stats = coeffs / np.maximum(se, _EPS)
    p_values = 2.0 * (1.0 - _t_cdf(np.abs(t_stats), df))

    return {
        "coeffs": coeffs,
        "se": se,
        "tStats": t_stats,
        "pValues": p_values,
        "R2": r2,
        "R2adj": r2_adj,
        "fStat": f_stat,
        "fPvalue": f_pvalue,
        "RMSE": rmse,
        "residuals": residuals,
        "yFit": y_fit,
        "N": n,
        "df": df,
    }
