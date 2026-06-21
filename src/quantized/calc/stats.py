"""Pure statistics utilities (no Statistics Toolbox). Ports of MATLAB +utilities.

All use MATLAB conventions: sample std/var (ddof=1), bias-corrected sample
skewness/kurtosis (excess), quartiles by linear interpolation on 1..n.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.special import beta as _beta
from scipy.special import betainc

__all__ = ["anova1", "descriptive_stats", "lin_regress", "t_test"]

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


def _norminv_approx(p: float) -> float:
    """Rational approx to the standard-normal quantile (Abramowitz-Stegun 26.2.23)."""
    t = math.sqrt(-2.0 * math.log(min(p, 1.0 - p)))
    c0, c1, c2 = 2.515517, 0.802853, 0.010328
    d1, d2, d3 = 1.432788, 0.189269, 0.001308
    z = t - (c0 + c1 * t + c2 * t**2) / (1.0 + d1 * t + d2 * t**2 + d3 * t**3)
    return -z if p < 0.5 else z


def _t_inv(p: float, nu: float) -> float:
    """Student-t quantile: normal-approx seed + Newton refinement (matches tinv_builtin)."""
    t = _norminv_approx(p)
    for _ in range(10):
        cp = float(_t_cdf(np.asarray(t, dtype=float), nu))
        pdf = (1.0 + t**2 / nu) ** (-(nu + 1.0) / 2.0) / (math.sqrt(nu) * _beta(nu / 2.0, 0.5))
        t = t - (cp - p) / max(pdf, _EPS)
    return t


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


def t_test(
    x: NDArray[np.float64],
    y: NDArray[np.float64] | None = None,
    *,
    mu: float = 0.0,
    paired: bool = False,
    alpha: float = 0.05,
    tail: str = "both",
) -> dict[str, Any]:
    """Student's t-test (one-sample / paired / Welch two-sample). Port of utilities.tTest.

    Returns ``testType``, ``meanDiff``, ``tStat``, ``df``, ``pValue``, ``ci``
    (a 2-element CI at level ``alpha``), ``reject`` and ``se``. NaNs are dropped
    per vector. Two-sample uses Welch's unequal-variance df.
    """
    if tail not in ("both", "left", "right"):
        raise ValueError("tail must be both/left/right")
    xv = np.asarray(x, dtype=float).ravel()
    xv = xv[~np.isnan(xv)]

    if y is None:
        test_type = "one-sample"
        n = xv.size
        s = float(np.std(xv, ddof=1))
        se = s / math.sqrt(n)
        mean_diff = float(np.mean(xv)) - mu
        df = float(n - 1)
    elif paired:
        yv = np.asarray(y, dtype=float).ravel()
        yv = yv[~np.isnan(yv)]
        if xv.size != yv.size:
            raise ValueError("paired test requires equal-length vectors")
        test_type = "paired"
        d = xv - yv
        n = d.size
        s = float(np.std(d, ddof=1))
        se = s / math.sqrt(n)
        mean_diff = float(np.mean(d))
        df = float(n - 1)
    else:
        yv = np.asarray(y, dtype=float).ravel()
        yv = yv[~np.isnan(yv)]
        test_type = "two-sample"
        n1, n2 = xv.size, yv.size
        s1, s2 = float(np.std(xv, ddof=1)), float(np.std(yv, ddof=1))
        v1, v2 = s1**2 / n1, s2**2 / n2
        se = math.sqrt(v1 + v2)
        mean_diff = float(np.mean(xv)) - float(np.mean(yv))
        df = (v1 + v2) ** 2 / (v1**2 / (n1 - 1) + v2**2 / (n2 - 1))

    t_stat = mean_diff / se if se != 0 else float("nan")
    if se == 0 or math.isnan(t_stat):
        if abs(mean_diff) < _EPS:
            p_value, t_stat = 1.0, 0.0
        else:
            p_value = 0.0
    elif tail == "both":
        p_value = 2.0 * (1.0 - float(_t_cdf(np.asarray(abs(t_stat)), df)))
    elif tail == "right":
        p_value = 1.0 - float(_t_cdf(np.asarray(t_stat), df))
    else:  # left
        p_value = float(_t_cdf(np.asarray(t_stat), df))

    t_crit = _t_inv(1.0 - alpha / 2.0, df)
    ci = np.array([mean_diff - t_crit * se, mean_diff + t_crit * se])
    return {
        "testType": test_type,
        "meanDiff": mean_diff,
        "tStat": t_stat,
        "df": df,
        "pValue": p_value,
        "ci": ci,
        "reject": bool(p_value < alpha),
        "se": se,
    }


def anova1(
    groups: list[NDArray[np.float64]],
    *,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """One-way ANOVA on a list of group vectors. Port of utilities.anova1.

    Returns the F-statistic and its p-value, the between/within/total sums of
    squares and mean squares, per-group means and counts, the grand mean and the
    reject flag. NaNs are dropped; empty groups are removed before the test.
    """
    cleaned: list[NDArray[np.float64]] = []
    for g in groups:
        gv = np.asarray(g, dtype=float).ravel()
        gv = gv[~np.isnan(gv)]
        if gv.size >= 1:
            cleaned.append(gv)
    k = len(cleaned)
    if k < 2:
        raise ValueError(f"ANOVA requires at least 2 non-empty groups (got {k})")

    group_n = np.array([g.size for g in cleaned], dtype=float)
    group_means = np.array([float(np.mean(g)) for g in cleaned])
    total_n = int(group_n.sum())
    grand_mean = float(np.sum(group_means * group_n) / total_n)
    ss_between = float(np.sum(group_n * (group_means - grand_mean) ** 2))
    ss_within = float(
        sum(float(np.sum((g - m) ** 2)) for g, m in zip(cleaned, group_means, strict=True))
    )
    ss_total = ss_between + ss_within
    df1 = k - 1
    df2 = total_n - k
    if df2 < 1:
        raise ValueError(f"need more observations than groups (N={total_n}, k={k})")
    ms_between = ss_between / df1
    ms_within = ss_within / df2
    if ms_within == 0:
        f_stat = 0.0 if ms_between == 0 else float("inf")
        p_value = 1.0 if ms_between == 0 else 0.0
    else:
        f_stat = ms_between / ms_within
        p_value = 1.0 - _f_cdf(f_stat, df1, df2)

    return {
        "fStat": f_stat,
        "df1": df1,
        "df2": df2,
        "pValue": p_value,
        "ssBetween": ss_between,
        "ssWithin": ss_within,
        "ssTotal": ss_total,
        "msBetween": ms_between,
        "msWithin": ms_within,
        "groupMeans": group_means,
        "groupN": group_n,
        "grandMean": grand_mean,
        "reject": bool(p_value < alpha),
    }
