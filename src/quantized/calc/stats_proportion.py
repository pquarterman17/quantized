"""Proportion tests: one-sample binomial, two-sample proportions, Fisher 2x2.

GAP_AUDIT_9 G6. Summary-count inputs (successes out of trials). Pure scipy.

References:
- Clopper & Pearson (1934), Biometrika 26, 404-413 (exact CI).
- Wilson (1927), JASA 22, 209-212 (score CI).
- Newcombe (1998), Stat. Med. 17, 873-890 (hybrid-score CI for p1 - p2).
- Cohen (1988), Statistical Power Analysis, ch. 6 (effect size h).
- Fisher (1935); scipy.stats.contingency.odds_ratio for the conditional-MLE
  odds ratio and its exact CI (Agresti, Categorical Data Analysis, 3rd ed.).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy import stats as sps
from scipy.stats.contingency import odds_ratio as _odds_ratio

_ALT = ("two-sided", "less", "greater")


def _count(v: float, name: str) -> int:
    if not np.isfinite(v) or v < 0 or v != int(v):
        raise ValueError(f"{name} must be a whole number, 0 or more")
    return int(v)


def _pair(x: float, n: float, label: str) -> tuple[int, int]:
    xi, ni = _count(x, f"{label} successes"), _count(n, f"{label} trials")
    if ni < 1:
        raise ValueError(f"{label} trials must be at least 1")
    if xi > ni:
        raise ValueError(f"{label} successes ({xi}) cannot exceed trials ({ni})")
    return xi, ni


def _check(alternative: str, alpha: float) -> None:
    if alternative not in _ALT:
        raise ValueError(f"alternative must be one of {_ALT}, got {alternative!r}")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")


def _h(p1: float, p0: float) -> float:
    return 2.0 * math.asin(math.sqrt(p1)) - 2.0 * math.asin(math.sqrt(p0))


def _wilson(x: int, n: int, alpha: float) -> tuple[float, float]:
    z = float(sps.norm.isf(alpha / 2.0))
    p = x / n
    d = 1.0 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def binomial_test(
    successes: float,
    trials: float,
    *,
    p0: float = 0.5,
    method: str = "exact",
    alternative: str = "two-sided",
    alpha: float = 0.05,
) -> dict[str, Any]:
    """One-sample proportion test of ``H0: p = p0``.

    ``exact``: binomial test (scipy ``binomtest``; two-sided p sums
    probabilities not larger than the observed one) with the Clopper-Pearson
    CI. ``normal``: z = (phat - p0) / sqrt(p0 (1 - p0) / n) with the Wilson
    score CI; refused unless n p0 and n (1 - p0) are both at least 5.
    ``effect_size`` is Cohen's h."""
    _check(alternative, alpha)
    if method not in ("exact", "normal"):
        raise ValueError("method must be 'exact' or 'normal'")
    if not 0.0 < p0 < 1.0:
        raise ValueError("the hypothesised proportion p0 must be strictly between 0 and 1")
    x, n = _pair(successes, trials, "the")
    phat = x / n
    base: dict[str, Any] = {
        "x": x,
        "n": n,
        "phat": phat,
        "p0": p0,
        "alternative": alternative,
        "alpha": alpha,
        "effect_size": _h(phat, p0),
    }
    if method == "exact":
        res = sps.binomtest(x, n, p0, alternative=alternative)
        ci = sps.binomtest(x, n, p0).proportion_ci(confidence_level=1 - alpha, method="exact")
        return {
            **base,
            "p": float(res.pvalue),
            "statistic": None,
            "ci_low": float(ci.low),
            "ci_high": float(ci.high),
            "ci_method": "Clopper-Pearson",
            "method": "Exact binomial test",
            "significant": bool(res.pvalue < alpha),
        }
    if n * p0 < 5 or n * (1 - p0) < 5:
        raise ValueError(
            "the normal approximation needs n*p0 and n*(1-p0) both at least 5; use the exact test"
        )
    z = (phat - p0) / math.sqrt(p0 * (1 - p0) / n)
    p = {"two-sided": 2 * sps.norm.sf(abs(z)), "less": sps.norm.cdf(z), "greater": sps.norm.sf(z)}[
        alternative
    ]
    lo, hi = _wilson(x, n, alpha)
    return {
        **base,
        "p": float(p),
        "statistic": float(z),
        "ci_low": lo,
        "ci_high": hi,
        "ci_method": "Wilson score",
        "method": "Normal-approximation proportion test (z)",
        "significant": bool(p < alpha),
    }


def two_proportions(
    x1: float,
    n1: float,
    x2: float,
    n2: float,
    *,
    alternative: str = "two-sided",
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Two-sample proportion z test (pooled SE under H0: p1 = p2) with the
    Newcombe hybrid-score CI for ``p1 - p2``. Reports the risk ratio, odds
    ratio and Cohen's h. Refused when any expected cell count is below 5 (use
    Fisher's exact test) or when the pooled proportion is 0 or 1."""
    _check(alternative, alpha)
    a, na = _pair(x1, n1, "group 1")
    b, nb = _pair(x2, n2, "group 2")
    p1, p2 = a / na, b / nb
    pool = (a + b) / (na + nb)
    if pool in (0.0, 1.0):
        raise ValueError(
            "every observation is a success (or every one a failure); the z test is undefined"
        )
    exp = [na * pool, na * (1 - pool), nb * pool, nb * (1 - pool)]
    if min(exp) < 5:
        raise ValueError(
            "an expected cell count is below 5; the z test is unreliable, use Fisher's exact test"
        )
    z = (p1 - p2) / math.sqrt(pool * (1 - pool) * (1 / na + 1 / nb))
    p = {"two-sided": 2 * sps.norm.sf(abs(z)), "less": sps.norm.cdf(z), "greater": sps.norm.sf(z)}[
        alternative
    ]
    l1, u1 = _wilson(a, na, alpha)
    l2, u2 = _wilson(b, nb, alpha)
    diff = p1 - p2
    lo = diff - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)
    hi = diff + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)
    rr = p1 / p2 if p2 > 0 else None
    orr = (a * (nb - b)) / (b * (na - a)) if b * (na - a) > 0 else None
    return {
        "x1": a,
        "n1": na,
        "x2": b,
        "n2": nb,
        "p1": p1,
        "p2": p2,
        "diff": diff,
        "statistic": float(z),
        "p": float(p),
        "ci_low": lo,
        "ci_high": hi,
        "ci_method": "Newcombe hybrid score",
        "risk_ratio": rr,
        "odds_ratio": orr,
        "effect_size": _h(p1, p2),
        "alternative": alternative,
        "alpha": alpha,
        "significant": bool(p < alpha),
        "method": "Two-proportion z test (pooled)",
    }


def _fin(v: float) -> float | None:
    return float(v) if np.isfinite(v) else None


def fisher_2x2(
    x1: float,
    n1: float,
    x2: float,
    n2: float,
    *,
    alternative: str = "two-sided",
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Fisher's exact test on ``[[x1, n1-x1], [x2, n2-x2]]``. The odds ratio is
    the conditional MLE with its exact (Fisher non-central hypergeometric) CI,
    from ``scipy.stats.contingency.odds_ratio``; ``sample_odds_ratio`` is the
    plain cross-product. Two-sided p sums tables no more likely than observed."""
    _check(alternative, alpha)
    a, na = _pair(x1, n1, "group 1")
    b, nb = _pair(x2, n2, "group 2")
    table = np.array([[a, na - a], [b, nb - b]], dtype=int)
    if np.any(table.sum(axis=0) == 0):
        raise ValueError(
            "an outcome column is all zero (no successes, or no failures); uninformative"
        )
    p = float(sps.fisher_exact(table, alternative=alternative)[1])
    res = _odds_ratio(table, kind="conditional")
    ci = res.confidence_interval(confidence_level=1 - alpha, alternative=alternative)
    cross = (a * (nb - b)) / (b * (na - a)) if b * (na - a) > 0 else None
    return {
        "table": table.tolist(),
        "p1": a / na,
        "p2": b / nb,
        "p": p,
        "odds_ratio": _fin(res.statistic),
        "sample_odds_ratio": cross,
        "ci_low": _fin(ci.low),
        "ci_high": _fin(ci.high),
        "ci_method": "conditional exact",
        "effect_size": _h(a / na, b / nb),
        "alternative": alternative,
        "alpha": alpha,
        "significant": bool(p < alpha),
        "method": "Fisher exact test (2x2)",
    }
