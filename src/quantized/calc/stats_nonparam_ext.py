"""Nonparametric / exact-count tests (GAP_AUDIT_9 G6 leftovers).

Pure numpy/scipy (BSD). Plain dicts out, like ``calc.stats_group_tests``.

* ``dunn_sidak``: Dunn's (1964) rank-sum post hoc with Sidak-adjusted p values,
  for use after Kruskal-Wallis. Dunn, O. J., *Technometrics* 6(3), 241-252;
  Sidak, Z., *JASA* 62, 626-633 (1967). z = (Rbar_i - Rbar_j) /
  sqrt((N(N+1)/12 - sum(t^3-t)/(12(N-1))) (1/n_i + 1/n_j)) (tie-corrected);
  p_adj = 1 - (1 - p)^m with m = k(k-1)/2 comparisons.
* ``mood_median``: Mood's median test (Mood 1950; Brown & Mood 1951). Counts of
  values above / not above the grand median, chi-square test of homogeneity
  (Yates-corrected for 2 x 2, matching ``scipy.stats.median_test``, the oracle).
  Values equal to the grand median count as NOT above (scipy's ``ties="below"``).
* ``poisson_rate_test``: exact one- and two-sample Poisson rate tests. One
  sample: ``x ~ Poisson(rate0 * t)``, two-sided p by the minimum-likelihood rule
  (sum of all outcomes no more likely than the observed one), Garwood
  chi-square CI. Two samples: conditional on ``x1 + x2`` the count ``x1`` is
  binomial with ``p = r0 t1 / (r0 t1 + t2)`` (Przyborowski & Wilenski 1940), so
  the p value and the rate-ratio CI come from the exact binomial test. Checked
  against the worked examples of R's ``poisson.test`` (see tests).
* ``tolerance_interval_np``: distribution-free tolerance limits from order
  statistics (Wilks, *Ann. Math. Stat.* 12, 91-96, 1941). Excluding ``ell``
  observations in total, the covered share is Beta(n-ell+1, ell), so
  ``confidence = P(Binomial(n, p) <= n - ell)``; for the sample min and max
  ``1 - n p^(n-1) + (n-1) p^n`` (NIST/SEMATECH e-Handbook 7.2.6.4,
  https://www.itl.nist.gov/div898/handbook/prc/section2/prc264.htm). The
  tightest limits whose confidence reaches the request are returned; if even
  the extremes cannot, the call refuses and says how many observations it needs.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.stats_group_tests import _check_alpha, _groups


def dunn_sidak(groups: list[NDArray[np.float64]], *, alpha: float = 0.05) -> dict[str, Any]:
    """Dunn's all-pairs rank comparisons with Sidak-adjusted p (posthoc shape)."""
    _check_alpha(alpha)
    gs = _groups(groups)
    allv = np.concatenate(gs)
    n_tot = allv.size
    ranks = sps.rankdata(allv)
    _, counts = np.unique(allv, return_counts=True)
    tie = float(np.sum(counts.astype(float) ** 3 - counts))
    var0 = n_tot * (n_tot + 1) / 12.0 - tie / (12.0 * (n_tot - 1))
    if var0 <= 0.0:
        raise ValueError("all observations are identical; rank comparisons are undefined")
    edges = np.cumsum([0] + [g.size for g in gs])
    mean_rank = [float(ranks[edges[i] : edges[i + 1]].mean()) for i in range(len(gs))]
    k = len(gs)
    m = k * (k - 1) // 2
    rows = []
    for i in range(k):
        for j in range(i + 1, k):
            se = math.sqrt(var0 * (1.0 / gs[i].size + 1.0 / gs[j].size))
            diff = mean_rank[i] - mean_rank[j]
            z = diff / se
            p_raw = float(2.0 * sps.norm.sf(abs(z)))
            p = float(-math.expm1(m * math.log1p(-min(p_raw, 1.0 - 1e-16))))
            rows.append(
                {
                    "i": i,
                    "j": j,
                    "diff": diff,
                    "se": se,
                    "statistic": z,
                    "df": None,
                    "p_raw": p_raw,
                    "p": p,
                    "ciLow": None,
                    "ciHigh": None,
                    "effect_size": None,
                    "significant": bool(p < alpha),
                }
            )
    kw = sps.kruskal(*gs)
    return {
        "pairs": rows,
        "n_groups": k,
        "alpha": alpha,
        "method": "Dunn (Sidak-adjusted)",
        "key": "dunn-sidak",
        "omnibus_p": float(kw.pvalue),
        "adjusted": True,
        "groups": [{"index": i, "n": int(g.size), "mean": mean_rank[i]} for i, g in enumerate(gs)],
        "diff_kind": "mean rank",
    }


def mood_median(groups: list[NDArray[np.float64]], *, alpha: float = 0.05) -> dict[str, Any]:
    """Mood's median test of equal medians across ``groups`` (k >= 2)."""
    _check_alpha(alpha)
    gs = _groups(groups, min_n=1)
    gmed = float(np.median(np.concatenate(gs)))
    above = np.array([int(np.sum(g > gmed)) for g in gs])
    below = np.array([g.size for g in gs]) - above
    table = np.vstack([above, below])
    if above.sum() == 0 or below.sum() == 0:
        raise ValueError(
            "no observation is above the grand median (or none at or below it); "
            "the test is undefined for this many ties"
        )
    chi2, p, dof, expected = sps.chi2_contingency(table, correction=True)
    return {
        "statistic": float(chi2),
        "df": int(dof),
        "p": float(p),
        "grand_median": gmed,
        "alpha": alpha,
        "significant": bool(p < alpha),
        "n_groups": len(gs),
        "min_expected": float(expected.min()),
        "groups": [
            {
                "index": i,
                "n": int(g.size),
                "above": int(above[i]),
                "below": int(below[i]),
                "median": float(np.median(g)),
            }
            for i, g in enumerate(gs)
        ],
        "method": "Mood's median test" + (" (Yates-corrected)" if len(gs) == 2 else ""),
    }


def _count(v: float, name: str) -> int:
    if not math.isfinite(v) or v < 0 or v != int(v):
        raise ValueError(f"{name} must be a whole number of 0 or more")
    return int(v)


def _exposure(v: float, name: str) -> float:
    if not math.isfinite(v) or v <= 0:
        raise ValueError(f"{name} must be greater than 0")
    return float(v)


def _poisson_two_sided(x: int, mu: float) -> float:
    """Minimum-likelihood two-sided exact p for ``x ~ Poisson(mu)``."""
    d = float(sps.poisson.pmf(x, mu)) * (1.0 + 1e-7)
    if x == mu:
        return 1.0
    if x < mu:
        hi = max(int(math.ceil(2 * mu - x)), x + 1)
        while sps.poisson.pmf(hi, mu) > d:
            hi *= 2
        tail = np.arange(int(math.ceil(mu)), hi + 1)
        n_le = int(np.sum(sps.poisson.pmf(tail, mu) <= d))
        return min(1.0, float(sps.poisson.cdf(x, mu) + sps.poisson.sf(hi - n_le, mu)))
    head = np.arange(0, int(math.floor(mu)) + 1)
    n_le = int(np.sum(sps.poisson.pmf(head, mu) <= d))
    return min(1.0, float(sps.poisson.sf(x - 1, mu) + sps.poisson.cdf(n_le - 1, mu)))


def _garwood(x: int, t: float, a_lo: float, a_hi: float) -> tuple[float, float]:
    lo = 0.0 if x == 0 else float(sps.chi2.ppf(a_lo, 2 * x)) / 2.0 / t
    hi = float(sps.chi2.ppf(1.0 - a_hi, 2 * x + 2)) / 2.0 / t
    return lo, hi


def poisson_rate_test(
    x1: float,
    t1: float = 1.0,
    *,
    rate0: float = 1.0,
    x2: float | None = None,
    t2: float | None = None,
    ratio0: float = 1.0,
    alternative: str = "two-sided",
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Exact Poisson rate test: one sample (``rate0``) or two (``ratio0`` of rates)."""
    _check_alpha(alpha)
    if alternative not in ("two-sided", "less", "greater"):
        raise ValueError("alternative must be two-sided, less or greater")
    a = _count(x1, "count 1")
    ta = _exposure(t1, "exposure 1")
    two = alternative == "two-sided"
    if x2 is None:
        if not math.isfinite(rate0) or rate0 <= 0:
            raise ValueError("the hypothesized rate must be greater than 0")
        mu = rate0 * ta
        if alternative == "less":
            p = float(sps.poisson.cdf(a, mu))
        elif alternative == "greater":
            p = float(sps.poisson.sf(a - 1, mu))
        else:
            p = _poisson_two_sided(a, mu)
        lo, hi = _garwood(a, ta, alpha / 2 if two else alpha, alpha / 2 if two else alpha)
        if alternative == "less":
            lo = 0.0
        elif alternative == "greater":
            hi = math.inf
        return {
            "samples": 1,
            "x1": a,
            "t1": ta,
            "rate1": a / ta,
            "rate0": rate0,
            "p": min(1.0, p),
            "ci_low": lo,
            "ci_high": hi,
            "alternative": alternative,
            "alpha": alpha,
            "significant": bool(p < alpha),
            "method": "Exact Poisson test (Garwood interval)",
        }
    if t2 is None:
        raise ValueError("exposure 2 is required for the two-sample test")
    b = _count(x2, "count 2")
    tb = _exposure(t2, "exposure 2")
    if not math.isfinite(ratio0) or ratio0 <= 0:
        raise ValueError("the hypothesized rate ratio must be greater than 0")
    if a + b == 0:
        raise ValueError("both counts are 0; the rate ratio is undefined")
    n = a + b
    res = sps.binomtest(a, n, ratio0 * ta / (ratio0 * ta + tb), alternative=alternative)
    ci = res.proportion_ci(confidence_level=1.0 - alpha, method="exact")
    scale = tb / ta

    def to_ratio(q: float) -> float:
        return math.inf if q >= 1.0 else q / (1.0 - q) * scale

    return {
        "samples": 2,
        "x1": a,
        "t1": ta,
        "x2": b,
        "t2": tb,
        "rate1": a / ta,
        "rate2": b / tb,
        "ratio": math.inf if b == 0 else (a / ta) / (b / tb),
        "ratio0": ratio0,
        "p": float(res.pvalue),
        "ci_low": to_ratio(float(ci.low)),
        "ci_high": to_ratio(float(ci.high)),
        "alternative": alternative,
        "alpha": alpha,
        "significant": bool(res.pvalue < alpha),
        "method": "Exact conditional test (binomial given x1 + x2)",
    }


def wilks_confidence(n: int, coverage: float, excluded: int) -> float:
    """P(at least ``coverage`` of the population lies in an interval that
    leaves ``excluded`` of the ``n`` order statistics out in total)."""
    return float(sps.binom.cdf(n - excluded, n, coverage))


def _min_n_extremes(coverage: float, confidence: float, excluded: int) -> int:
    n = excluded + 1
    while wilks_confidence(n, coverage, excluded) < confidence:
        n = n * 2 if n < 1_000_000 else n + 10_000_000
        if n > 100_000_000:
            raise ValueError("coverage and confidence are too extreme to reach")
    lo = max(excluded + 1, n // 2)
    while lo < n:
        mid = (lo + n) // 2
        if wilks_confidence(mid, coverage, excluded) >= confidence:
            n = mid
        else:
            lo = mid + 1
    return n


def tolerance_interval_np(
    x: NDArray[np.float64],
    *,
    coverage: float = 0.9,
    confidence: float = 0.95,
    sides: str = "two",
) -> dict[str, Any]:
    """Order-statistic (Wilks) tolerance limits; see the module docstring."""
    if sides not in ("two", "upper", "lower"):
        raise ValueError("sides must be two, upper or lower")
    if not (0.0 < coverage < 1.0 and 0.0 < confidence < 1.0):
        raise ValueError("coverage and confidence must each be between 0 and 1")
    v = np.sort(np.asarray(x, dtype=float).ravel())
    if not np.all(np.isfinite(v)):
        raise ValueError("values must be finite")
    n = int(v.size)
    per_end = 2 if sides == "two" else 1
    if n < per_end + 1 or wilks_confidence(n, coverage, per_end) < confidence:
        need = _min_n_extremes(coverage, confidence, per_end)
        raise ValueError(
            f"n = {n} is too small: a distribution-free {'two' if per_end == 2 else 'one'}-sided "
            f"limit at {coverage:g} coverage and {confidence:g} confidence needs at least "
            f"{need} observations"
        )
    r = 1  # observations dropped from each used end
    while True:
        ell = 2 * (r + 1) if sides == "two" else r + 1
        if n - ell < 0 or (sides == "two" and r + 1 >= n + 1 - (r + 1)):
            break
        if wilks_confidence(n, coverage, ell) < confidence:
            break
        r += 1
    ell = 2 * r if sides == "two" else r
    lower = float(v[r - 1]) if sides in ("two", "lower") else None
    upper = float(v[n - r]) if sides in ("two", "upper") else None
    return {
        "n": n,
        "coverage": coverage,
        "confidence": confidence,
        "sides": sides,
        "lower": lower,
        "upper": upper,
        "rank_from_each_end": r,
        "achieved_confidence": wilks_confidence(n, coverage, ell),
        "extremes_confidence": wilks_confidence(n, coverage, per_end),
        "min_n_extremes": _min_n_extremes(coverage, confidence, per_end),
        "method": "Distribution-free tolerance limits (Wilks, order statistics)",
    }
