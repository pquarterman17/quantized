"""Origin-style nonlinear-fit report statistics (pure).

Given a finished least-squares fit (``calc.fitting.curve_fit``'s params,
errors, covariance and residuals, plus the data and optional weights), this
derives the tables Origin's NLFit report shows and the Curve Fit panel did
not:

* per-parameter t value, two-sided Prob>|t| and confidence limits at a chosen
  level, on the fit's residual degrees of freedom;
* the ANOVA table in NLFit's convention — Regression / Residual /
  Uncorrected Total / Corrected Total, with the Regression row taking the
  *uncorrected* total (a nonlinear model need not contain an intercept, so the
  centered decomposition does not hold), F = MS_reg / MS_res and Prob>F;
* the parameter correlation matrix (from the covariance);
* N, residual df, weighted RSS, reduced chi-square, R² (COD), adjusted R² and
  Root-MSE = sqrt(reduced chi-square) (Origin's "Root-MSE (SD)").

New module rather than an edit of ``calc.fitting``: no fit is re-run here, so
the optimizer and its covariance stay the single source of the numbers this
module only re-expresses. Held parameters (error NaN / zero covariance row)
get null inference columns instead of a fabricated t of +-inf.

Weights are the same ``w`` the fit minimised (``sum w r**2``); ``None`` is
unweighted. The ANOVA sums of squares and R² use the same weights, matching
``curve_fit``'s own weighted R².
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy import stats

__all__ = ["anova_table", "correlation_matrix", "fit_report", "parameter_inference"]


def _finite(v: float) -> float | None:
    return float(v) if math.isfinite(v) else None


def parameter_inference(
    params: ArrayLike,
    errors: ArrayLike,
    dof: int,
    level: float = 0.95,
) -> list[dict[str, float | None]]:
    """t value, two-sided Prob>|t| and the ``level`` confidence limits.

    ``errors`` are the fit's standard errors; a NaN, non-positive or missing
    error (a held parameter, or a fit without covariance) yields nulls rather
    than an infinite t. ``dof`` is the residual degrees of freedom
    (N - free parameters); below 1 there is no inference and every column but
    the value is null.
    """
    if not 0.0 < level < 1.0:
        raise ValueError(f"level must be in (0, 1), got {level}")
    p = np.asarray(params, dtype=float).ravel()
    se = np.asarray(errors, dtype=float).ravel()
    if se.size != p.size:
        raise ValueError(f"errors ({se.size}) must match params ({p.size})")
    t_crit = float(stats.t.ppf(1.0 - (1.0 - level) / 2.0, dof)) if dof >= 1 else math.nan
    rows: list[dict[str, float | None]] = []
    for value, err in zip(p, se, strict=True):
        usable = dof >= 1 and math.isfinite(err) and err > 0
        if not usable:
            rows.append({"value": _finite(value), "error": _finite(err) if err > 0 else None,
                         "t": None, "prob": None, "lcl": None, "ucl": None})
            continue
        t = float(value / err)
        prob = float(2.0 * stats.t.sf(abs(t), dof))
        half = t_crit * float(err)
        rows.append({
            "value": _finite(value), "error": _finite(err), "t": _finite(t),
            "prob": _finite(prob), "lcl": _finite(value - half), "ucl": _finite(value + half),
        })
    return rows


def anova_table(
    y: ArrayLike,
    residuals: ArrayLike,
    n_free: int,
    weights: ArrayLike | None = None,
) -> list[dict[str, Any]]:
    """NLFit's ANOVA rows: Regression, Residual, Uncorrected Total, Corrected Total.

    Regression SS = uncorrected total SS - residual SS on ``n_free`` df; the
    corrected total is the weighted sum of squares about the weighted mean on
    N - 1 df. F and Prob>F are on the Regression row only (null elsewhere, and
    null when the residual df or MS is zero).
    """
    yv = np.asarray(y, dtype=float).ravel()
    rv = np.asarray(residuals, dtype=float).ravel()
    if yv.size != rv.size:
        raise ValueError(f"residuals ({rv.size}) must match y ({yv.size})")
    w = np.ones_like(yv) if weights is None else np.asarray(weights, dtype=float).ravel()
    if w.size != yv.size:
        raise ValueError(f"weights ({w.size}) must match y ({yv.size})")
    n = int(yv.size)
    ss_res = float(np.sum(w * rv**2))
    ss_unc = float(np.sum(w * yv**2))
    w_mean = float(np.sum(w * yv) / np.sum(w)) if np.sum(w) > 0 else math.nan
    ss_cor = float(np.sum(w * (yv - w_mean) ** 2))
    ss_reg = ss_unc - ss_res
    df_reg, df_res = int(n_free), n - int(n_free)
    ms_reg = ss_reg / df_reg if df_reg > 0 else math.nan
    ms_res = ss_res / df_res if df_res > 0 else math.nan
    f_val = ms_reg / ms_res if df_res > 0 and ms_res > 0 and df_reg > 0 else math.nan
    prob_f = float(stats.f.sf(f_val, df_reg, df_res)) if math.isfinite(f_val) else math.nan

    def row(source: str, df: int, ss: float, ms: float = math.nan,
            f: float = math.nan, p: float = math.nan) -> dict[str, Any]:
        return {"source": source, "df": df, "ss": _finite(ss), "ms": _finite(ms),
                "f": _finite(f), "prob": _finite(p)}

    return [
        row("Regression", df_reg, ss_reg, ms_reg, f_val, prob_f),
        row("Residual", df_res, ss_res, ms_res),
        row("Uncorrected Total", n, ss_unc),
        row("Corrected Total", n - 1, ss_cor),
    ]


def correlation_matrix(covar: ArrayLike | None) -> list[list[float | None]] | None:
    """Correlation from a covariance matrix; null entries for held parameters.

    A parameter whose variance is not positive (held, or undetermined) has no
    correlation with anything, including itself, so its row and column are
    null rather than a NaN that would serialize ambiguously.
    """
    if covar is None:
        return None
    c = _symmetric(covar)
    sd = np.sqrt(np.where(np.diag(c) > 0, np.diag(c), np.nan))
    corr = np.asarray(np.clip(c / np.outer(sd, sd), -1.0, 1.0), dtype=float)
    # A parameter correlates with itself exactly: sd*sd need not round back to
    # the variance, which printed a diagonal of 1.0000000000000002.
    corr[np.diag_indices_from(corr)] = np.where(np.isfinite(sd), 1.0, np.nan)
    return [[_finite(float(v)) for v in r] for r in corr]


def _symmetric(covar: ArrayLike) -> NDArray[np.float64]:
    """``covar`` as a square array, made exactly symmetric.

    A covariance is symmetric by definition, but the fitter's is a product of
    floating-point matrices (``J C J^T``) whose two triangles differ in the
    last digit; reported as-is, cov(A, tau) and cov(tau, A) disagree in the
    exported table. The mean of the two triangles is the reported value.
    """
    c = np.asarray(covar, dtype=float)
    if c.ndim != 2 or c.shape[0] != c.shape[1]:
        raise ValueError("covar must be a square matrix")
    return np.asarray((c + c.T) / 2.0, dtype=float)


def fit_report(
    params: Sequence[float],
    errors: Sequence[float | None],
    covar: Sequence[Sequence[float]] | None,
    y: Sequence[float],
    residuals: Sequence[float],
    n_free: int,
    *,
    weights: Sequence[float] | None = None,
    level: float = 0.95,
) -> dict[str, Any]:
    """Everything the fit report shows, from one finished fit."""
    err = [math.nan if e is None else float(e) for e in errors]
    yv = np.asarray(y, dtype=float).ravel()
    rv = np.asarray(residuals, dtype=float).ravel()
    n = int(yv.size)
    dof = n - int(n_free)
    anova = anova_table(yv, rv, n_free, weights)
    ss_res = float(anova[1]["ss"] or 0.0)
    ss_cor = anova[3]["ss"]
    red_chi = ss_res / dof if dof > 0 else math.nan
    r2 = 1.0 - ss_res / ss_cor if ss_cor else math.nan
    adj = 1.0 - (1.0 - r2) * (n - 1) / dof if dof > 0 and math.isfinite(r2) else math.nan
    cov_arr: NDArray[np.float64] | None = None if covar is None else _symmetric(covar)
    return {
        "level": level,
        "parameters": parameter_inference(params, err, dof, level),
        "anova": anova,
        "covariance": (
            None if cov_arr is None else [[_finite(float(v)) for v in r] for r in cov_arr]
        ),
        "correlation": correlation_matrix(cov_arr),
        "stats": {
            "n": n,
            "dof": dof,
            "rss": _finite(ss_res),
            "reducedChiSq": _finite(red_chi),
            "R2": _finite(r2),
            "adjR2": _finite(adj),
            "rootMSE": (
                _finite(math.sqrt(red_chi)) if math.isfinite(red_chi) and red_chi >= 0 else None
            ),
        },
    }
