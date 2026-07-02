"""Distribution fitting with goodness-of-fit + t-test power / sample size.

ORIGIN_GAP_PLAN #28 — new capability beyond MATLAB parity, scipy (BSD) only
(statsmodels not required: power uses the exact noncentral-t formulation).
Validated in tests against published values (Cohen's power tables / G*Power)
and closed-form MLE identities.

Conventions: positive-support families (lognormal / weibull / gamma /
exponential) are fitted with ``loc`` fixed at 0 — the 2-parameter forms
instrument-data practice (and Origin) use. KS p-values are flagged
approximate when parameters were estimated from the same sample
(the Lilliefors situation).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

__all__ = ["fit_distribution", "fit_distributions", "required_n", "t_test_power"]

# family -> (scipy dist, fit kwargs, n free params, positive support required)
_FAMILIES: dict[str, tuple[Any, dict[str, float], int, bool]] = {
    "normal": (sps.norm, {}, 2, False),
    "lognormal": (sps.lognorm, {"floc": 0.0}, 2, True),
    "weibull": (sps.weibull_min, {"floc": 0.0}, 2, True),
    "gamma": (sps.gamma, {"floc": 0.0}, 2, True),
    "exponential": (sps.expon, {"floc": 0.0}, 1, True),
}

_KINDS = ("one-sample", "paired", "two-sample")


def fit_distribution(x: NDArray[np.float64], dist: str = "normal") -> dict[str, Any]:
    """MLE-fit one distribution family; return params + log-likelihood + AIC
    + a KS goodness-of-fit test against the fitted distribution.

    ``params`` holds scipy's (shape, loc, scale) plus friendly aliases
    (normal: mu/sigma; lognormal: mu/sigma of ln x; weibull: shape/scale;
    gamma: shape/scale; exponential: rate).
    """
    if dist not in _FAMILIES:
        raise ValueError(f"dist must be one of {sorted(_FAMILIES)}, got {dist!r}")
    xv = np.asarray(x, dtype=float).ravel()
    xv = xv[np.isfinite(xv)]
    if xv.size < 5:
        raise ValueError("fit_distribution needs at least 5 finite observations")
    family, fit_kw, n_params, positive = _FAMILIES[dist]
    if positive and np.any(xv <= 0):
        raise ValueError(f"{dist} requires strictly positive data")

    fitted = family.fit(xv, **fit_kw)
    loglike = float(np.sum(family.logpdf(xv, *fitted)))
    aic = 2.0 * n_params - 2.0 * loglike
    frozen = family(*fitted)
    ks = sps.kstest(xv, frozen.cdf)

    shapes = [float(v) for v in fitted[:-2]]
    loc, scale = float(fitted[-2]), float(fitted[-1])
    params: dict[str, float] = {"loc": loc, "scale": scale}
    if shapes:
        params["shape"] = shapes[0]
    if dist == "normal":
        params.update(mu=loc, sigma=scale)
    elif dist == "lognormal":
        params.update(mu=math.log(scale), sigma=shapes[0])
    elif dist == "exponential":
        params.update(rate=1.0 / scale)

    return {
        "dist": dist,
        "params": params,
        "loglike": loglike,
        "aic": aic,
        "n_params": n_params,
        "ks_d": float(ks.statistic),
        "ks_p": float(ks.pvalue),
        "ks_p_approximate": True,  # params estimated from the same sample
        "N": int(xv.size),
    }


def fit_distributions(
    x: NDArray[np.float64], dists: list[str] | None = None
) -> dict[str, Any]:
    """Fit several families and rank them by AIC (lowest first).

    Families whose support the data violates (or that fail to converge) are
    reported under ``skipped`` with the reason, never silently dropped.
    """
    names = list(_FAMILIES) if dists is None else dists
    fits: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for name in names:
        try:
            fits.append(fit_distribution(x, name))
        except ValueError as exc:
            skipped.append({"dist": name, "reason": str(exc)})
        except Exception as exc:  # noqa: BLE001 — scipy fit convergence failures
            skipped.append({"dist": name, "reason": f"fit failed: {exc}"})
    if not fits:
        raise ValueError("no distribution family could be fitted")
    fits.sort(key=lambda f: f["aic"])
    return {"fits": fits, "best": fits[0]["dist"], "skipped": skipped}


def _power_from_n(kind: str, d: float, n: int, alpha: float, tails: int) -> float:
    """Exact noncentral-t power for a t-test at the given per-group n."""
    if kind == "two-sample":
        df = 2 * n - 2
        ncp = abs(d) * math.sqrt(n / 2.0)
    else:  # one-sample / paired
        df = n - 1
        ncp = abs(d) * math.sqrt(n)
    if df < 1:
        return 0.0
    if tails == 2:
        tc = float(sps.t.ppf(1.0 - alpha / 2.0, df))
        return float(1.0 - sps.nct.cdf(tc, df, ncp) + sps.nct.cdf(-tc, df, ncp))
    tc = float(sps.t.ppf(1.0 - alpha, df))
    return float(1.0 - sps.nct.cdf(tc, df, ncp))


def t_test_power(
    effect_size: float,
    n: int,
    *,
    kind: str = "two-sample",
    alpha: float = 0.05,
    tails: int = 2,
) -> dict[str, Any]:
    """Power of a t-test at Cohen's d = ``effect_size`` and per-group ``n``.

    Exact noncentral-t computation (what G*Power does): ncp = d·sqrt(n/2)
    with df = 2n-2 for two-sample; ncp = d·sqrt(n), df = n-1 for
    one-sample/paired. Reference: Cohen, *Statistical Power Analysis*, ch. 2.
    """
    if kind not in _KINDS:
        raise ValueError(f"kind must be one of {_KINDS}, got {kind!r}")
    if tails not in (1, 2):
        raise ValueError("tails must be 1 or 2")
    if n < 2:
        raise ValueError("n must be >= 2")
    if not 0 < alpha < 1:
        raise ValueError("alpha must be in (0, 1)")
    power = _power_from_n(kind, effect_size, n, alpha, tails)
    return {
        "power": power,
        "effect_size": float(effect_size),
        "n": int(n),
        "kind": kind,
        "alpha": alpha,
        "tails": tails,
    }


def required_n(
    effect_size: float,
    power: float = 0.8,
    *,
    kind: str = "two-sample",
    alpha: float = 0.05,
    tails: int = 2,
) -> dict[str, Any]:
    """Smallest per-group n reaching the target power (doubling + bisection)."""
    if kind not in _KINDS:
        raise ValueError(f"kind must be one of {_KINDS}, got {kind!r}")
    if not 0 < power < 1:
        raise ValueError("power must be in (0, 1)")
    if effect_size == 0:
        raise ValueError("effect_size must be nonzero")
    lo, hi = 2, 4
    while _power_from_n(kind, effect_size, hi, alpha, tails) < power:
        hi *= 2
        if hi > 2**22:
            raise ValueError("required n exceeds 4e6 — effect size too small")
    while lo < hi:
        mid = (lo + hi) // 2
        if _power_from_n(kind, effect_size, mid, alpha, tails) >= power:
            hi = mid
        else:
            lo = mid + 1
    achieved = _power_from_n(kind, effect_size, lo, alpha, tails)
    return {
        "n": int(lo),
        "achieved_power": achieved,
        "target_power": power,
        "effect_size": float(effect_size),
        "kind": kind,
        "alpha": alpha,
        "tails": tails,
    }
