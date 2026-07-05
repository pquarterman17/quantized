"""Multivariate statistics: multiple linear regression + correlation matrices.

ORIGIN_GAP_PLAN #27 — new capability beyond MATLAB parity, numpy/scipy only.
Result-dict key names mirror ``calc.stats.lin_regress`` so downstream code
(routes, future report sheets) treats simple and multiple regression alike;
the single-predictor case is validated against ``lin_regress`` (itself
golden-verified vs MATLAB) in ``tests/test_calc_stats_multivar.py``.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.stats import _f_cdf, _t_cdf, _t_inv

_EPS = float(np.finfo(float).tiny)


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


def multiple_regression(
    predictors: list[NDArray[np.float64]] | NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Multiple linear regression ``y = b0 + b1·x1 + … + bk·xk`` with inference.

    ``predictors`` is a list of k same-length columns (or an (n, k) matrix);
    the intercept is always included. Returns coefficients (intercept first),
    standard errors, t-stats/p-values, confidence intervals, R²/adjusted R²,
    the overall F-test, RMSE, residuals and fitted values — the same key
    vocabulary as ``lin_regress``. Rows containing any non-finite value are
    dropped (listwise deletion).
    """
    xmat0 = _as_matrix(predictors)
    yv = np.asarray(y, dtype=float).ravel()
    if yv.size != xmat0.shape[0]:
        raise ValueError(f"y length {yv.size} != predictor length {xmat0.shape[0]}")
    keep = np.isfinite(yv) & np.all(np.isfinite(xmat0), axis=1)
    xmat0, yv = xmat0[keep], yv[keep]
    n, k = xmat0.shape
    if n < k + 2:
        raise ValueError(f"need at least {k + 2} complete rows for {k} predictors")

    xmat = np.column_stack([np.ones(n), xmat0])
    xtx = xmat.T @ xmat
    try:
        coeffs = np.asarray(np.linalg.solve(xtx, xmat.T @ yv), dtype=float)
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "regression is singular — a predictor is constant or predictors are collinear"
        ) from exc
    y_fit = np.asarray(xmat @ coeffs, dtype=float)
    residuals = np.asarray(yv - y_fit, dtype=float)
    df = n - (k + 1)

    ss_res = float(np.sum(residuals**2))
    ss_tot = float(np.sum((yv - np.mean(yv)) ** 2))
    ss_reg = ss_tot - ss_res
    r2 = 1.0 - ss_res / max(ss_tot, _EPS)
    _adj_denom = ss_tot / (n - 1)
    r2_adj = 1.0 - (ss_res / df) / _adj_denom if _adj_denom != 0.0 else float("nan")
    mse = ss_res / df
    f_stat = (ss_reg / k) / max(mse, _EPS)

    cov_b = mse * np.linalg.inv(xtx)
    se = np.asarray(np.sqrt(np.maximum(np.diag(cov_b), 0.0)), dtype=float)
    t_stats = np.asarray(coeffs / np.maximum(se, _EPS), dtype=float)
    p_values = np.asarray(2.0 * (1.0 - _t_cdf(np.abs(t_stats), df)), dtype=float)
    t_crit = _t_inv(1.0 - alpha / 2.0, df)

    return {
        "coeffs": coeffs,  # intercept first, then one per predictor
        "se": se,
        "tStats": t_stats,
        "pValues": p_values,
        "ciLow": np.asarray(coeffs - t_crit * se, dtype=float),
        "ciHigh": np.asarray(coeffs + t_crit * se, dtype=float),
        "R2": r2,
        "R2adj": r2_adj,
        "fStat": f_stat,
        "fPvalue": 1.0 - _f_cdf(f_stat, k, df),
        "RMSE": math.sqrt(mse),
        "residuals": residuals,
        "yFit": y_fit,
        "N": n,
        "df": df,
        "alpha": alpha,
    }


def _rankdata(x: NDArray[np.float64]) -> NDArray[np.float64]:
    """Average ranks (ties share the mean rank) — Spearman's transform."""
    order = np.argsort(x, kind="stable")
    ranks = np.empty(x.size, dtype=float)
    sx = x[order]
    i = 0
    while i < x.size:
        j = i
        while j + 1 < x.size and sx[j + 1] == sx[i]:
            j += 1
        ranks[order[i : j + 1]] = 0.5 * (i + j) + 1.0
        i = j + 1
    return ranks


def correlation_matrix(
    columns: list[NDArray[np.float64]] | NDArray[np.float64],
    *,
    method: str = "pearson",
) -> dict[str, Any]:
    """Pairwise correlation matrix with significance.

    ``method='pearson'`` (linear) or ``'spearman'`` (rank). p-values from the
    exact t-transform ``t = r·sqrt((n-2)/(1-r²))`` with n-2 dof (the classic
    test, as in MATLAB corrcoef); the diagonal is r=1, p=1 by convention.
    Rows containing any non-finite value are dropped (listwise deletion).
    """
    if method not in ("pearson", "spearman"):
        raise ValueError(f'method must be "pearson" or "spearman", got "{method}"')
    data = _as_matrix(columns)
    data = data[np.all(np.isfinite(data), axis=1)]
    n, k = data.shape
    if k < 2:
        raise ValueError("correlation needs at least 2 columns")
    if n < 3:
        raise ValueError("correlation needs at least 3 complete rows")
    if method == "spearman":
        data = np.column_stack([_rankdata(data[:, j]) for j in range(k)])

    r = np.asarray(np.corrcoef(data, rowvar=False), dtype=float)
    # t-transform off-diagonal; clamp so |r|=1 gives p=0 instead of a 0-division.
    rr = np.clip(r, -1.0, 1.0)
    denom = np.maximum(1.0 - rr**2, _EPS)
    # |r|==1 floors denom to _EPS, so (n-2)/denom overflows to +inf for larger
    # n. That is intentional: sqrt(inf)=inf and _t_cdf(inf)=1 give the exact
    # p=0. Suppress the expected overflow rather than raise the floor — a bigger
    # floor would, for dof=1 (heavy Cauchy tail), turn that exact 0 into a
    # spurious ~1e-7.
    with np.errstate(over="ignore", divide="ignore"):
        t = np.abs(rr) * np.sqrt((n - 2) / denom)
    p = np.asarray(2.0 * (1.0 - _t_cdf(t, n - 2)), dtype=float)
    np.fill_diagonal(p, 1.0)

    return {"r": r, "p": p, "N": n, "method": method}


def partial_correlation(
    columns: list[NDArray[np.float64]] | NDArray[np.float64],
) -> dict[str, Any]:
    """Partial correlation of every pair, controlling for ALL other columns.

    Computed from the precision matrix: ``r_ij·rest = -P_ij / sqrt(P_ii·P_jj)``
    with ``P = inv(corrcoef)`` (pseudo-inverse for near-singular inputs).
    """
    data = _as_matrix(columns)
    data = data[np.all(np.isfinite(data), axis=1)]
    n, k = data.shape
    if k < 3:
        raise ValueError("partial correlation needs at least 3 columns (a control variable)")
    if n < k + 2:
        raise ValueError(f"partial correlation needs at least {k + 2} complete rows")
    r = np.corrcoef(data, rowvar=False)
    prec = np.asarray(np.linalg.pinv(r), dtype=float)
    d = np.sqrt(np.maximum(np.outer(np.diag(prec), np.diag(prec)), _EPS))
    partial = np.asarray(-prec / d, dtype=float)
    np.fill_diagonal(partial, 1.0)
    return {"r": partial, "N": n, "controlled": k - 2}


def _subset_criterion(
    x: NDArray[np.float64], y: NDArray[np.float64], idx: list[int], criterion: str
) -> float:
    """AIC/BIC of the OLS model using predictor columns ``idx`` (RSS form).

    AIC = n·ln(SSE/n) + 2p, BIC = n·ln(SSE/n) + p·ln(n), p = len(idx) + 1
    (intercept). Constant-only model when ``idx`` is empty. +inf for a
    singular subset so the search simply never selects it.
    """
    n = y.size
    if idx:
        try:
            fit = multiple_regression(x[:, idx], y)
        except ValueError:
            return float("inf")
        sse = float(np.sum(np.asarray(fit["residuals"]) ** 2))
    else:
        sse = float(np.sum((y - np.mean(y)) ** 2))
    sse = max(sse, _EPS)
    p = len(idx) + 1
    penalty = 2.0 * p if criterion == "aic" else p * math.log(n)
    return n * math.log(sse / n) + penalty


def stepwise_regression(
    predictors: list[NDArray[np.float64]] | NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    criterion: str = "aic",
    direction: str = "forward",
) -> dict[str, Any]:
    """Stepwise predictor selection over :func:`multiple_regression`.

    ``direction='forward'`` starts from the intercept-only model and adds the
    predictor that most improves the criterion; ``'backward'`` starts from the
    full model and drops the worst; ``'both'`` is forward with a drop pass
    after every addition. Stops when no single move improves the criterion.
    Returns the selected column indices (original order), the search history,
    and the refitted final model (empty selection = intercept-only, model None).
    """
    if criterion not in ("aic", "bic"):
        raise ValueError(f'criterion must be "aic" or "bic", got "{criterion}"')
    if direction not in ("forward", "backward", "both"):
        raise ValueError(f'direction must be forward/backward/both, got "{direction}"')
    xmat = _as_matrix(predictors)
    yv = np.asarray(y, dtype=float).ravel()
    if yv.size != xmat.shape[0]:
        raise ValueError(f"y length {yv.size} != predictor length {xmat.shape[0]}")
    keep = np.isfinite(yv) & np.all(np.isfinite(xmat), axis=1)
    xmat, yv = xmat[keep], yv[keep]
    k = xmat.shape[1]

    selected = list(range(k)) if direction == "backward" else []
    current = _subset_criterion(xmat, yv, selected, criterion)
    history: list[dict[str, Any]] = [
        {"action": "start", "index": None, "criterion": current}
    ]

    def best_add() -> tuple[int, float] | None:
        cands = [
            (j, _subset_criterion(xmat, yv, sorted([*selected, j]), criterion))
            for j in range(k)
            if j not in selected
        ]
        if not cands:
            return None
        j, c = min(cands, key=lambda t: t[1])
        return (j, c) if c < current else None

    def best_drop() -> tuple[int, float] | None:
        cands = [
            (j, _subset_criterion(xmat, yv, [i for i in selected if i != j], criterion))
            for j in selected
        ]
        if not cands:
            return None
        j, c = min(cands, key=lambda t: t[1])
        return (j, c) if c < current else None

    for _ in range(4 * k + 4):  # generous bound; each move strictly improves
        move = best_drop() if direction == "backward" else best_add()
        action = "drop" if direction == "backward" else "add"
        if move is None and direction == "both":
            move, action = best_drop(), "drop"
        if move is None:
            break
        j, current = move
        if action == "add":
            selected = sorted([*selected, j])
        else:
            selected = [i for i in selected if i != j]
        history.append({"action": action, "index": j, "criterion": current})

    model = multiple_regression(xmat[:, selected], yv) if selected else None
    return {
        "selected": selected,
        "criterion": criterion,
        "criterion_value": current,
        "direction": direction,
        "history": history,
        "model": model,
        "n_candidates": k,
    }
