"""Fit Life by X (GAP_AUDIT_9 G8): one regressor, a location-scale life regression.

``mu_i = b0 + b1 * x'_i`` where ``x' = h(x)`` is the chosen life-stress
transform, with a common ``sigma`` (so the log-time distribution shifts with
stress and keeps its shape: the accelerated-failure-time form). Right-censored
data (``censor``: 1 = censored). Families: weibull, lognormal, loglogistic,
exponential (the log-time families; the identity-time ``sev`` family has no
multiplicative acceleration factor and is refused).

Transforms (JMP *Fit Life by X* relationships; JMP 16 documentation library,
Reliability and Survival Methods):

- ``arrhenius-celsius``: ``x' = 1 / (k_B (T + 273.15))`` in 1/eV, so ``b1`` is
  the activation energy ``Ea`` in eV (Arrhenius: ``t ~ exp(Ea / k_B T)``);
  ``k_B`` is read from ``scipy.constants`` (CODATA), not typed in.
- ``arrhenius-kelvin``: the same with ``x`` already in kelvin.
- ``power``: ``x' = ln x`` (inverse power law, ``t ~ x^b1``; ``b1`` < 0 means
  life falls with stress). ``x`` must be positive.
- ``linear``: ``x' = x`` (exponential relationship).

Reports the coefficients with Wald SE/CIs, sigma, AICc/BIC, the life at the
user's *use condition* (quantiles with bands) and the acceleration factor of
the use condition over each tested stress level,
``AF = t_p(use) / t_p(stress) = exp(b1 (x'_use - x'_stress))`` (independent of
``p`` for a log-time location-scale model). Provisional, owner to confirm:
the transform list and the Wald intervals.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps
from scipy.constants import physical_constants

from quantized.calc.life_core import DISTRIBUTIONS, LIFE_DISTS, check_life_data, fit_ml
from quantized.calc.life_predict import predict_quantiles
from quantized.calc.stats_life import CI_METHOD, DEFAULT_QUANTILES, info_criteria

__all__ = ["LIFE_TRANSFORMS", "fit_life_by_x", "transform_stress"]

LIFE_TRANSFORMS = ("arrhenius-celsius", "arrhenius-kelvin", "power", "linear")
_INV_KB_EV = 1.0 / physical_constants["Boltzmann constant in eV/K"][0]  # 1/(k_B) in K/eV


def transform_stress(x: NDArray[np.float64] | float, kind: str) -> NDArray[np.float64]:
    """Apply the life-stress transform ``h(x)``; refuses values outside its domain."""
    v = np.asarray(x, dtype=float)
    if kind not in LIFE_TRANSFORMS:
        raise ValueError(f"transform must be one of {list(LIFE_TRANSFORMS)}, got {kind!r}")
    if kind in ("arrhenius-celsius", "arrhenius-kelvin"):
        kelvin = v + 273.15 if kind == "arrhenius-celsius" else v
        if np.any(kelvin <= 0):
            raise ValueError("temperature must be above absolute zero")
        return _INV_KB_EV / kelvin  # type: ignore[no-any-return]
    if kind == "power":
        if np.any(v <= 0):
            raise ValueError("the power (log) transform needs a positive regressor")
        return np.log(v)  # type: ignore[no-any-return]
    return v


def fit_life_by_x(
    time: Any,
    censor: Any,
    x: Any,
    *,
    distribution: str = "weibull",
    transform: str = "arrhenius-celsius",
    use_x: float | None = None,
    alpha: float = 0.05,
    quantile_probs: list[float] | None = None,
) -> dict[str, Any]:
    """Life-by-stress regression; ``use_x`` (raw units) enables life at use + AFs."""
    if distribution not in DISTRIBUTIONS or not DISTRIBUTIONS[distribution][1]:
        raise ValueError(
            f"Fit Life by X supports {[d for d in LIFE_DISTS if DISTRIBUTIONS[d][1]]}, "
            f"got {distribution!r}"
        )
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be strictly between 0 and 1")
    xv = np.asarray(x, dtype=float).ravel()
    if not np.all(np.isfinite(xv)):
        raise ValueError("the regressor must be finite (drop incomplete rows first)")
    data = check_life_data(time, censor, log_time=True)
    if xv.size != data.n:
        raise ValueError(f"regressor length {xv.size} != time length {data.n}")
    levels = np.unique(xv)
    if levels.size < 2:
        raise ValueError("the regressor needs at least 2 distinct stress levels")
    xt = transform_stress(xv, transform)
    fail_levels = np.unique(xv[data.failed])
    if fail_levels.size < 2:
        raise ValueError(
            "failures must occur at 2 or more distinct stress levels to estimate the slope"
        )
    X = np.column_stack([np.ones(data.n), xt])
    fit = fit_ml(data, distribution, X)
    zc = float(sps.norm.ppf(1.0 - alpha / 2.0))
    se = [float(v) for v in np.sqrt(np.diag(fit.cov))]
    s = fit.log_sigma
    rows = [
        {
            "name": "intercept (b0)",
            "estimate": float(fit.beta[0]),
            "se": float(se[0]),
            "ci_low": float(fit.beta[0] - zc * se[0]),
            "ci_high": float(fit.beta[0] + zc * se[0]),
        },
        {
            "name": "slope (b1) on " + transform,
            "estimate": float(fit.beta[1]),
            "se": float(se[1]),
            "ci_low": float(fit.beta[1] - zc * se[1]),
            "ci_high": float(fit.beta[1] + zc * se[1]),
        },
    ]
    if not DISTRIBUTIONS[distribution][2]:
        rows.append(
            {
                "name": "sigma (scale of ln t)",
                "estimate": fit.sigma,
                "se": float(fit.sigma * se[2]),
                "ci_low": float(np.exp(s - zc * se[2])),
                "ci_high": float(np.exp(s + zc * se[2])),
            }
        )
    aicc, bic = info_criteria(fit.loglik, fit.n_params, fit.n)
    probs = list(DEFAULT_QUANTILES if quantile_probs is None else quantile_probs)
    out: dict[str, Any] = {
        "distribution": distribution,
        "transform": transform,
        "n": data.n,
        "n_failed": data.r,
        "n_censored": data.n - data.r,
        "alpha": alpha,
        "ci_method": CI_METHOD,
        "parameters": rows,
        "loglik": fit.loglik,
        "n_params": fit.n_params,
        "aicc": aicc,
        "bic": bic,
        "levels": [
            {
                "x": float(lv),
                "x_transformed": float(transform_stress(lv, transform)),
                "n": int(np.sum(xv == lv)),
                "n_failed": int(np.sum(data.failed & (xv == lv))),
            }
            for lv in levels
        ],
        "use_x": use_x,
        "use_quantiles": [],
        "acceleration": [],
    }
    if use_x is not None:
        if not np.isfinite(use_x):
            raise ValueError("use condition must be finite")
        xu = float(transform_stress(use_x, transform))
        x0 = np.array([1.0, xu])
        out["use_quantiles"] = predict_quantiles(fit, x0, probs, zc)
        for lv in levels:
            dx = xu - float(transform_stress(lv, transform))
            g = np.zeros(fit.cov.shape[0])
            g[1] = dx
            sd = float(np.sqrt(max(float(g @ fit.cov @ g), 0.0)))
            lg = float(fit.beta[1]) * dx
            out["acceleration"].append(
                {
                    "x": float(lv),
                    "factor": float(np.exp(lg)),
                    "ci_low": float(np.exp(lg - zc * sd)),
                    "ci_high": float(np.exp(lg + zc * sd)),
                }
            )
    return out
