"""Likelihood-ratio (profile-likelihood) confidence intervals for life fits (GAP_AUDIT_9 G8).

For a scalar target ``phi`` of the location-scale parameters ``(mu, s = ln sigma)``
the interval is ``{phi : 2 (ll_hat - ll_p(phi)) <= chi2_1(1 - alpha)}`` with
``ll_p(phi) = max over the remaining parameter of ll``. Targets and their
re-parameterisation (the nuisance parameter is always one scalar):

- ``mu``        : ``mu = phi``, nuisance ``s``           (eta = e^mu follows by monotone map)
- ``log_sigma`` : ``s = phi``,  nuisance ``mu``          (beta = 1/sigma follows)
- ``quantile``  : ``mu = phi - e^s w_p`` with ``phi = y_p = mu + sigma w_p`` (a B-life),
  nuisance ``s``

Families with fixed sigma (exponential) have no nuisance parameter. The limits
are found by expanding outward from the MLE until the cutoff is crossed, then
Brent's method; a side that never crosses within the search (a likelihood that
stays flat, e.g. a scale not bounded by the data) is returned as ``nan``
(an open bound), never silently replaced by the Wald value.

Likelihood-ratio intervals are invariant to monotone re-parameterisation and are
recommended over Wald for small or heavily censored samples (Meeker & Escobar
1998, sec. 8.3.2; Lawless 2003, sec. 5.1; Venzon & Moolgavkar 1988 for the
profile root-finding idea). Oracle in tests: a brute-force grid search of the
profile with the chi-square cutoff.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

import numpy as np
from scipy import optimize
from scipy import stats as sps

from quantized.calc.life_core import DISTRIBUTIONS, MLFit, std_quantile

__all__ = ["lr_interval", "lr_parameter_intervals", "lr_quantile_interval", "lr_quantile_rows"]

LogLik = Callable[[float, float], float]  # (mu, s) -> log-likelihood
Target = Literal["mu", "log_sigma", "quantile"]
_NUISANCE_SPAN = 8.0


def _profile(ll: LogLik, fit: MLFit, target: Target, phi: float, w: float, fixed: bool) -> float:
    mu_hat, s_hat = float(fit.beta[0]), fit.log_sigma
    if fixed:
        return ll(phi - w if target == "quantile" else phi, 0.0)
    if target == "log_sigma":
        span = 5.0 * _NUISANCE_SPAN * float(np.exp(phi)) + 1e-9  # +/- 40 sigma around the MLE
        res = optimize.minimize_scalar(
            lambda m: -ll(float(m), phi),
            bounds=(mu_hat - span, mu_hat + span),
            method="bounded",
            options={"xatol": 1e-11},
        )
        return float(-res.fun)

    def neg(s: float) -> float:
        mu = phi if target == "mu" else phi - float(np.exp(s)) * w
        return -ll(mu, float(s))

    res = optimize.minimize_scalar(
        neg,
        bounds=(s_hat - _NUISANCE_SPAN, s_hat + _NUISANCE_SPAN),
        method="bounded",
        options={"xatol": 1e-11},
    )
    return float(-res.fun)


def lr_interval(
    ll: LogLik,
    fit: MLFit,
    target: Target,
    alpha: float,
    *,
    w: float = 0.0,
    phi_hat: float,
    se_hint: float,
) -> tuple[float, float]:
    """(low, high) of the profile-likelihood interval for ``phi``; ``nan`` = open side."""
    fixed = DISTRIBUTIONS[fit.dist][2]
    if target == "log_sigma" and fixed:
        raise ValueError("sigma is fixed for this distribution")
    cut = float(sps.chi2.ppf(1.0 - alpha, 1))
    ll_hat = max(fit.loglik, _profile(ll, fit, target, phi_hat, w, fixed))

    def g(phi: float) -> float:
        return 2.0 * (ll_hat - _profile(ll, fit, target, phi, w, fixed)) - cut

    step = max(se_hint, 1e-6 * max(1.0, abs(phi_hat)))
    out = []
    for sign in (-1.0, 1.0):
        edge = np.nan
        a, k = phi_hat, 0
        while k < 40:
            b = phi_hat + sign * step * 2.0**k
            with np.errstate(all="ignore"):
                if g(b) > 0.0:
                    lo, hi = (b, a) if sign < 0 else (a, b)
                    edge = float(optimize.brentq(g, lo, hi, xtol=1e-12, rtol=1e-12))
                    break
            a, k = b, k + 1
        out.append(edge)
    return out[0], out[1]


def lr_parameter_intervals(ll: LogLik, fit: MLFit, alpha: float) -> dict[str, tuple[float, float]]:
    """LR intervals for ``mu`` and (unless fixed) ``log_sigma``."""
    res = {
        "mu": lr_interval(
            ll, fit, "mu", alpha, phi_hat=float(fit.beta[0]), se_hint=float(np.sqrt(fit.cov[0, 0]))
        )
    }
    if not DISTRIBUTIONS[fit.dist][2]:
        res["log_sigma"] = lr_interval(
            ll,
            fit,
            "log_sigma",
            alpha,
            phi_hat=fit.log_sigma,
            se_hint=float(np.sqrt(fit.cov[1, 1])),
        )
    return res


def lr_quantile_interval(ll: LogLik, fit: MLFit, p: float, alpha: float) -> tuple[float, float]:
    """LR interval for the quantile ``y_p`` on the fitted (log-)time scale."""
    std = DISTRIBUTIONS[fit.dist][0]
    w = float(std_quantile(std, p))
    y = float(fit.beta[0]) + fit.sigma * w
    g = np.array([1.0, fit.sigma * w])
    se = float(np.sqrt(max(g @ fit.cov @ g, 0.0)))
    return lr_interval(ll, fit, "quantile", alpha, w=w, phi_hat=y, se_hint=se)


def lr_quantile_rows(
    ll: LogLik, fit: MLFit, rows: list[dict[str, Any]], alpha: float
) -> list[dict[str, Any]]:
    """Replace the Wald band of ``predict_quantiles`` rows with the LR interval (time scale)."""
    log_time = DISTRIBUTIONS[fit.dist][1]
    out = []
    for r in rows:
        lo, hi = lr_quantile_interval(ll, fit, float(r["p"]), alpha)
        if log_time:
            lo, hi = float(np.exp(lo)), float(np.exp(hi))
        out.append({**r, "ci_low": lo, "ci_high": hi})
    return out
