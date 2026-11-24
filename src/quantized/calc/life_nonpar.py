"""Nonparametric life estimates for right-censored data (GAP_AUDIT_9 G8).

Kaplan-Meier with Greenwood pointwise bands, and the plotting positions used
by the probability plot. Pure numpy/scipy (lifelines is only the test oracle).

- Kaplan-Meier: product-limit estimate at each distinct failure time; a
  censoring tied with a failure is treated as occurring just after it.
  Pointwise confidence band: the exponential-Greenwood (log-log) interval,
  ``S ** exp(+/- z * se_ll)`` with ``se_ll = sqrt(sum d/(n(n-d))) / |ln S|``
  (Kalbfleisch & Prentice 2002, sec. 1.4; the same form lifelines uses). It
  stays inside (0, 1), unlike the plain Greenwood ``S +/- z se(S)`` band.
- Plotting positions (provisional, owner to confirm: ``median-rank`` default):
  ``median-rank`` = Johnson's adjusted ranks with Benard's median-rank
  approximation ``(adj - 0.3) / (n + 0.4)`` (Johnson 1964; Benard & Bos-Levenbach
  1953; Abernethy, *The New Weibull Handbook*, 5th ed., ch. 2/5), one point per
  failure. ``kaplan-meier`` = the midpoint of each Kaplan-Meier step,
  ``(F(t-) + F(t)) / 2``, one point per distinct failure time (the last step
  of a fully-failed sample reaches F = 1, so its midpoint is used instead of
  the step top, which cannot be drawn on a probability axis).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import stats as sps

from quantized.calc.life_core import LifeData

__all__ = ["PLOTTING_METHODS", "kaplan_meier_censored", "plotting_positions"]

PLOTTING_METHODS = ("median-rank", "kaplan-meier")


def kaplan_meier_censored(data: LifeData, alpha: float = 0.05) -> dict[str, Any]:
    """Product-limit estimate at the distinct failure times, with Greenwood bands."""
    order = np.lexsort((~data.failed, data.time))  # time, then failures before censorings
    t, failed = data.time[order], data.failed[order]
    times, inverse = np.unique(t[failed], return_inverse=True)
    n_total = t.size
    deaths_arr = np.bincount(inverse, minlength=times.size)
    at_risk_arr = n_total - np.searchsorted(t, times, side="left")  # units with t >= failure time
    zc = float(sps.norm.ppf(1.0 - alpha / 2.0))
    with np.errstate(divide="ignore", invalid="ignore"):
        surv_arr = np.cumprod(1.0 - deaths_arr / at_risk_arr)
        terms = np.where(
            at_risk_arr > deaths_arr,
            deaths_arr / (at_risk_arr * (at_risk_arr - deaths_arr)),
            np.inf,
        )
        green = np.cumsum(terms)
        se_arr = surv_arr * np.sqrt(green)
        w = zc * np.sqrt(green) / np.abs(np.log(surv_arr))
        lo_arr, hi_arr = surv_arr ** np.exp(w), surv_arr ** np.exp(-w)
    undefined = (surv_arr <= 0.0) | ~np.isfinite(green)
    for arr in (se_arr, lo_arr, hi_arr):
        arr[undefined] = np.nan
    surv = [float(x) for x in surv_arr]
    se = [float(x) for x in se_arr]
    ci_lo = [float(x) for x in lo_arr]
    ci_hi = [float(x) for x in hi_arr]
    at_risk = [int(x) for x in at_risk_arr]
    deaths = [int(x) for x in deaths_arr]
    sv = np.asarray(surv)
    below = np.nonzero(sv <= 0.5)[0]
    return {
        "times": [float(x) for x in times],
        "survival": surv,
        "std_error": se,
        "ci_low": ci_lo,
        "ci_high": ci_hi,
        "at_risk": at_risk,
        "events": deaths,
        "median": float(times[below[0]]) if below.size else None,
        "n": n_total,
        "ci_method": "pointwise exponential Greenwood (log-log)",
    }


def plotting_positions(data: LifeData, method: str = "median-rank") -> dict[str, Any]:
    """Probability-plot points ``(t, F)`` for the failures of a censored sample."""
    if method not in PLOTTING_METHODS:
        raise ValueError(f"plotting method must be one of {list(PLOTTING_METHODS)}, got {method!r}")
    n = data.n
    if method == "kaplan-meier":
        km = kaplan_meier_censored(data)
        surv = np.asarray(km["survival"])
        prev = np.concatenate([[1.0], surv[:-1]])
        f_mid = ((1.0 - prev) + (1.0 - surv)) / 2.0
        return {"method": method, "times": km["times"], "probabilities": [float(x) for x in f_mid]}
    order = np.lexsort((~data.failed, data.time))
    t, failed = data.time[order], data.failed[order]
    adj = 0.0
    times, probs = [], []
    for i in range(n):
        if not failed[i]:
            continue
        reverse_rank = n - i
        adj = adj + (n + 1.0 - adj) / (1.0 + reverse_rank)
        times.append(float(t[i]))
        probs.append(float((adj - 0.3) / (n + 0.4)))
    return {"method": method, "times": times, "probabilities": probs}
