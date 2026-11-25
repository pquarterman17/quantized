"""Censored life-distribution fitting (GAP_AUDIT_9 G8): the public calc API.

Weibull, lognormal, exponential, loglogistic and smallest-extreme-value fits by
maximum likelihood with right-censoring (``censor``: 1 = censored, 0 = failed,
as in JMP), parameter tables with Wald SE/CIs, AICc / BIC model comparison, the
Kaplan-Meier estimate with Greenwood bands, B-life quantiles and failure
probabilities at user times, and the linearised probability-plot data (points,
fitted line, confidence band). Fit Life by X lives in ``stats_life_byx``.

Method sources (cited per JMP / Origin practice): JMP *Reliability and
Survival Methods*, Life Distribution platform (JMP 16 documentation library);
Origin *Parametric Distribution Analysis* (reliability). Math: Meeker &
Escobar (1998) and Lawless (2003); see ``life_core``.

Provisional, owner to confirm: the Weibull default, 95% confidence, Wald
intervals, the median-rank plotting default, refusing fewer than 2 failures.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import stats as sps

from quantized.calc.life_core import (
    DISTRIBUTIONS,
    LIFE_DISTS,
    LifeData,
    MLFit,
    check_life_data,
    fit_ml,
    std_quantile,
)
from quantized.calc.life_interval import IntervalData, interval_loglik
from quantized.calc.life_nonpar import kaplan_meier_censored, plotting_positions
from quantized.calc.life_predict import fitted_line, predict_probabilities, predict_quantiles
from quantized.calc.life_profile import lr_parameter_intervals, lr_quantile_rows

__all__ = ["LIFE_DISTS", "fit_life", "info_criteria"]

CI_METHOD = "Wald (normal approximation on a log scale for positive quantities)"
LR_METHOD = (
    "Likelihood ratio (profile likelihood, chi-square 1 df) for the parameters and B-lives; "
    "failure-probability and probability-plot bands stay Wald"
)
CI_METHODS = ("wald", "likelihood-ratio")
_TICK_PROBS = (0.001, 0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 0.99, 0.999)
DEFAULT_QUANTILES = (0.01, 0.1, 0.5)


def info_criteria(loglik: float, k: int, n: int) -> tuple[float | None, float]:
    """(AICc, BIC); AICc is None when n <= k + 1 (the correction is undefined)."""
    aic = -2.0 * loglik + 2.0 * k
    aicc = aic + 2.0 * k * (k + 1) / (n - k - 1) if n - k - 1 > 0 else None
    return aicc, -2.0 * loglik + k * float(np.log(n))


def _row(name: str, est: float, se: float | None, lo: float, hi: float) -> dict[str, Any]:
    return {"name": name, "estimate": est, "se": se, "ci_low": lo, "ci_high": hi}


def _parameter_rows(
    fit: MLFit, zc: float, lr: dict[str, tuple[float, float]] | None = None
) -> list[dict[str, Any]]:
    mu, s = float(fit.beta[0]), fit.log_sigma
    se_mu = float(np.sqrt(fit.cov[0, 0]))
    se_s = float(np.sqrt(fit.cov[1, 1]))
    sig, d = fit.sigma, fit.dist
    mu_ci = (mu - zc * se_mu, mu + zc * se_mu)
    sig_ci = (float(np.exp(s - zc * se_s)), float(np.exp(s + zc * se_s)))
    if lr is not None:  # profile-likelihood limits replace the Wald ones (ln-scale -> sigma)
        mu_ci = lr["mu"]
        if "log_sigma" in lr:
            sig_ci = (float(np.exp(lr["log_sigma"][0])), float(np.exp(lr["log_sigma"][1])))
    if d == "weibull":
        eta = float(np.exp(mu))
        return [
            _row(
                "eta (scale, 63.2% life)",
                eta,
                eta * se_mu,
                float(np.exp(mu_ci[0])),
                float(np.exp(mu_ci[1])),
            ),
            _row("beta (shape)", 1.0 / sig, se_s / sig, 1.0 / sig_ci[1], 1.0 / sig_ci[0]),
            _row("mu = ln(eta)", mu, se_mu, *mu_ci),
            _row("sigma = 1/beta", sig, sig * se_s, *sig_ci),
        ]
    if d == "exponential":
        theta = float(np.exp(mu))
        return [
            _row(
                "theta (mean life)",
                theta,
                theta * se_mu,
                float(np.exp(mu_ci[0])),
                float(np.exp(mu_ci[1])),
            ),
            _row(
                "lambda (failure rate)",
                1.0 / theta,
                se_mu / theta,
                float(np.exp(-mu_ci[1])),
                float(np.exp(-mu_ci[0])),
            ),
        ]
    if d == "sev":
        return [
            _row("mu (location)", mu, se_mu, *mu_ci),
            _row("sigma (scale)", sig, sig * se_s, *sig_ci),
        ]
    med = float(np.exp(mu))
    return [
        _row("mu (mean of ln t)", mu, se_mu, *mu_ci),
        _row(
            "sigma (sd of ln t)" if d == "lognormal" else "sigma (scale of ln t)",
            sig,
            sig * se_s,
            *sig_ci,
        ),
        _row(
            "median = exp(mu)", med, med * se_mu, float(np.exp(mu_ci[0])), float(np.exp(mu_ci[1]))
        ),
    ]


def _plot_block(data: LifeData, fit: MLFit, method: str, zc: float) -> dict[str, Any]:
    std, log_time, _ = DISTRIBUTIONS[fit.dist]
    pp = plotting_positions(data, method)
    pts_t = np.asarray(pp["times"], dtype=float)
    pts_f = np.asarray(pp["probabilities"], dtype=float)
    lo, hi = float(data.time.min()), float(data.time.max())
    if log_time:
        grid = np.exp(np.linspace(np.log(lo / 1.5), np.log(hi * 1.5), 80))
    else:
        pad = 0.1 * (hi - lo or 1.0)
        grid = np.linspace(max(lo - pad, 0.0), hi + pad, 80)
    line = fitted_line(fit, np.ones(1), grid, zc)
    return {
        "dist": fit.dist,
        "std": std,
        "x_log": log_time,
        "method": method,
        "points": [
            {"t": float(t), "p": float(f), "z": float(z)}
            for t, f, z in zip(pts_t, pts_f, std_quantile(std, pts_f), strict=True)
        ],
        "line": line,
        "ticks": [{"p": p, "z": float(std_quantile(std, p))} for p in _TICK_PROBS],
    }


def _fit_row(name: str, fit: MLFit) -> dict[str, Any]:
    aicc, bic = info_criteria(fit.loglik, fit.n_params, fit.n)
    return {
        "distribution": name,
        "loglik": fit.loglik,
        "n_params": fit.n_params,
        "aicc": aicc,
        "bic": bic,
    }


def fit_life(
    time: Any,
    censor: Any,
    *,
    distribution: str = "weibull",
    compare: bool = False,
    alpha: float = 0.05,
    quantile_probs: list[float] | None = None,
    eval_times: list[float] | None = None,
    plotting: str = "median-rank",
    ci_method: str = "wald",
) -> dict[str, Any]:
    """Fit ``distribution`` to right-censored life data (``censor``: 1 = censored).

    ``ci_method``: ``"wald"`` (default) or ``"likelihood-ratio"`` (profile intervals for
    the parameters and the B-life quantiles).

    ``compare`` also fits every other family (those the data cannot support are
    listed with the reason). Quantiles/probabilities use the primary fit.
    """
    if distribution not in DISTRIBUTIONS:
        raise ValueError(f"distribution must be one of {list(LIFE_DISTS)}, got {distribution!r}")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be strictly between 0 and 1")
    if ci_method not in CI_METHODS:
        raise ValueError(f"ci_method must be one of {list(CI_METHODS)}, got {ci_method!r}")
    log_time = DISTRIBUTIONS[distribution][1]
    data = check_life_data(time, censor, log_time=log_time)
    zc = float(sps.norm.ppf(1.0 - alpha / 2.0))
    fit = fit_ml(data, distribution)
    aicc, bic = info_criteria(fit.loglik, fit.n_params, fit.n)
    x0 = np.ones(1)
    quantiles = predict_quantiles(
        fit, x0, list(DEFAULT_QUANTILES if quantile_probs is None else quantile_probs), zc
    )
    lr = None
    if ci_method == "likelihood-ratio":
        idata = IntervalData(data.time, np.where(data.failed, data.time, np.inf))

        def ll(mu: float, s: float) -> float:
            return interval_loglik(idata, distribution, mu, s)

        lr = lr_parameter_intervals(ll, fit, alpha)
        quantiles = lr_quantile_rows(ll, fit, quantiles, alpha)
    comparison: list[dict[str, Any]] = []
    if compare:
        for name in LIFE_DISTS:
            try:
                comparison.append(
                    _fit_row(
                        name,
                        fit
                        if name == distribution
                        else fit_ml(
                            check_life_data(time, censor, log_time=DISTRIBUTIONS[name][1]), name
                        ),
                    )
                )
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
    return {
        "distribution": distribution,
        "n": data.n,
        "n_failed": data.r,
        "n_censored": data.n - data.r,
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
        "kaplan_meier": kaplan_meier_censored(data, alpha),
        "plot": _plot_block(data, fit, plotting, zc),
    }
