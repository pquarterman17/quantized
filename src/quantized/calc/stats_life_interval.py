"""Interval- / left-censored life distributions with the Turnbull estimate (GAP_AUDIT_9 G8).

Public calc API for rows ``(lower, upper)`` (see ``life_interval`` for the row
semantics: ``lower == upper`` exact, ``lower == 0`` left-censored, null upper
right-censored). Parametric fits by maximum likelihood for the five families
(parameters with SE and Wald or likelihood-ratio CIs, AICc / BIC comparison,
B-lives, failure probabilities, a linearised probability plot with the fitted
line and band) plus the Turnbull nonparametric estimate (``life_turnbull``).

Probability-plot points come from the Turnbull estimate: one point per
innermost interval with a finite upper end, drawn at that upper end at the
midpoint of the cumulative step (the same convention as the Kaplan-Meier
midpoint option); where an interval is wide the true failure time is anywhere
inside it, so the point is indicative only.
Provisional, owner to confirm: Weibull default, 95% level, Wald default.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import stats as sps

from quantized.calc.life_core import DISTRIBUTIONS, LIFE_DISTS, MLFit, std_quantile
from quantized.calc.life_interval import (
    IntervalData,
    check_interval_data,
    fit_interval,
    interval_loglik,
)
from quantized.calc.life_predict import fitted_line, predict_probabilities, predict_quantiles
from quantized.calc.life_profile import lr_parameter_intervals, lr_quantile_rows
from quantized.calc.life_turnbull import turnbull
from quantized.calc.stats_life import (
    _TICK_PROBS,
    CI_METHOD,
    CI_METHODS,
    DEFAULT_QUANTILES,
    LR_METHOD,
    _fit_row,
    _parameter_rows,
    info_criteria,
)

__all__ = ["fit_life_interval"]


def _plot_block(data: IntervalData, fit: MLFit, tb: dict[str, Any], zc: float) -> dict[str, Any]:
    std, log_time, _ = DISTRIBUTIONS[fit.dist]
    up = np.asarray(tb["upper"])
    cdf = np.asarray(tb["cdf"])
    prev = np.concatenate([[0.0], cdf[:-1]])
    mid = (prev + cdf) / 2.0
    keep = np.isfinite(up) & (up > 0) & (mid > 0) & (mid < 1)
    pts_t, pts_f = up[keep], mid[keep]
    finite = np.concatenate([data.lower[data.lower > 0], data.upper[np.isfinite(data.upper)]])
    lo, hi = float(finite.min()), float(finite.max())
    if log_time:
        grid = np.exp(np.linspace(np.log(lo / 1.5), np.log(hi * 1.5), 80))
    else:
        pad = 0.1 * (hi - lo or 1.0)
        grid = np.linspace(max(lo - pad, 0.0), hi + pad, 80)
    return {
        "dist": fit.dist,
        "std": std,
        "x_log": log_time,
        "method": "turnbull",
        "points": [
            {"t": float(t), "p": float(f), "z": float(z)}
            for t, f, z in zip(pts_t, pts_f, std_quantile(std, pts_f), strict=True)
        ],
        "line": fitted_line(fit, np.ones(1), grid, zc),
        "ticks": [{"p": p, "z": float(std_quantile(std, p))} for p in _TICK_PROBS],
    }


def fit_life_interval(
    lower: Any,
    upper: Any,
    *,
    distribution: str = "weibull",
    compare: bool = False,
    alpha: float = 0.05,
    quantile_probs: list[float] | None = None,
    eval_times: list[float] | None = None,
    ci_method: str = "wald",
) -> dict[str, Any]:
    """Fit ``distribution`` to interval-censored rows and compute the Turnbull estimate."""
    if distribution not in DISTRIBUTIONS:
        raise ValueError(f"distribution must be one of {list(LIFE_DISTS)}, got {distribution!r}")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be strictly between 0 and 1")
    if ci_method not in CI_METHODS:
        raise ValueError(f"ci_method must be one of {list(CI_METHODS)}, got {ci_method!r}")
    data = check_interval_data(lower, upper, log_time=DISTRIBUTIONS[distribution][1])
    zc = float(sps.norm.ppf(1.0 - alpha / 2.0))
    fit = fit_interval(data, distribution)
    aicc, bic = info_criteria(fit.loglik, fit.n_params, fit.n)
    x0 = np.ones(1)
    quantiles = predict_quantiles(
        fit, x0, list(DEFAULT_QUANTILES if quantile_probs is None else quantile_probs), zc
    )
    lr = None
    if ci_method == "likelihood-ratio":

        def ll(mu: float, s: float) -> float:
            return interval_loglik(data, distribution, mu, s)

        lr = lr_parameter_intervals(ll, fit, alpha)
        quantiles = lr_quantile_rows(ll, fit, quantiles, alpha)
    comparison: list[dict[str, Any]] = []
    if compare:
        for name in LIFE_DISTS:
            try:
                other = (
                    fit
                    if name == distribution
                    else fit_interval(
                        check_interval_data(lower, upper, log_time=DISTRIBUTIONS[name][1]), name
                    )
                )
                comparison.append(_fit_row(name, other))
            except ValueError as exc:
                comparison.append(
                    {
                        "distribution": name,
                        "loglik": None,
                        "n_params": None,
                        "aicc": None,
                        "bic": None,
                        "note": str(exc),
                    }
                )
        best_a = min((r["aicc"] for r in comparison if r["aicc"] is not None), default=None)
        best_b = min((r["bic"] for r in comparison if r["bic"] is not None), default=None)
        for r in comparison:
            r["delta_aicc"] = None if best_a is None or r["aicc"] is None else r["aicc"] - best_a
            r["delta_bic"] = None if best_b is None or r["bic"] is None else r["bic"] - best_b
    tb = turnbull(data)
    n_exact, n_right = int(data.exact.sum()), int(data.right.sum())
    n_left = int(data.left.sum())
    return {
        "distribution": distribution,
        "n": data.n,
        "n_exact": n_exact,
        "n_interval": data.n - n_exact - n_right - n_left,
        "n_left": n_left,
        "n_right": n_right,
        "alpha": alpha,
        "ci_method": CI_METHOD if lr is None else LR_METHOD,
        "parameters": _parameter_rows(fit, zc, lr),
        "loglik": fit.loglik,
        "n_params": fit.n_params,
        "aicc": aicc,
        "bic": bic,
        "comparison": comparison,
        "quantiles": quantiles,
        "probabilities": predict_probabilities(fit, x0, list(eval_times or []), zc),
        "turnbull": tb,
        "plot": _plot_block(data, fit, tb, zc),
    }
