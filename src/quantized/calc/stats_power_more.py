"""Power of three more tests: the exact binomial test, chi-square (Cohen's w) and correlation.

Forward half only; ``stats_power_solve`` searches over these like the others.

* **Exact binomial** (one proportion, H0: p = p0, true p = p1): the rejection region
  is whatever the exact binomial test rejects at ``alpha`` (two-sided by scipy's
  "minimum likelihood" rule, the same one ``scipy.stats.binomtest`` uses; one-sided
  in the direction of ``p1 - p0``), and the power is the probability of landing in it
  under ``p1``. Unlike the arcsine approximation it is correct for small n, but it
  is a sawtooth in n (the test is discrete and conservative), so a larger n can have
  *less* power; ``binomial_actual_alpha`` gives the real size of the test.
* **Chi-square, Cohen's w** (goodness of fit or contingency table): the noncentral
  chi-square with ``df`` degrees of freedom and ``ncp = w^2 * n``, n the total count.
* **Correlation** (H0: rho = 0): the Fisher z approximation,
  ``z = atanh(r)``, ``ncp = z * sqrt(n - 3)``, the standard textbook method
  (Cohen 1988, ch. 3; n = 85 gives 80 % power for r = 0.3 two-sided at 5 %).

References: Cohen (1988), *Statistical Power Analysis for the Behavioral Sciences*.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray
from scipy import stats

__all__ = [
    "BINOMIAL_MAX_N",
    "binomial_actual_alpha",
    "binomial_exact_power",
    "binomial_rejection_region",
    "chisq_power",
    "correlation_power",
]

BINOMIAL_MAX_N = 20_000
_REL = 1.0 + 1e-7  # scipy's tolerance for "as likely as the observed count"


def _check(alpha: float, tails: int) -> None:
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be in (0, 1)")
    if tails not in (1, 2):
        raise ValueError("tails must be 1 or 2")


def binomial_rejection_region(
    n: int, p0: float, alpha: float, tails: int, upper: bool
) -> NDArray[np.bool_]:
    """Which counts 0..n the exact binomial test of p = p0 rejects at ``alpha``.

    ``tails=2`` is the two-sided "minimum likelihood" test (as in scipy's
    ``binomtest``: the p-value sums every outcome no more likely than the one
    seen). ``tails=1`` tests ``p > p0`` when ``upper`` else ``p < p0``.
    """
    if not 2 <= n <= BINOMIAL_MAX_N:
        raise ValueError(f"the exact binomial power needs 2 <= n <= {BINOMIAL_MAX_N}")
    if not 0.0 < p0 < 1.0:
        raise ValueError("p0 must be strictly between 0 and 1")
    k = np.arange(n + 1)
    if tails == 1:
        pval = stats.binom.sf(k - 1, n, p0) if upper else stats.binom.cdf(k, n, p0)
    else:
        pmf = stats.binom.pmf(k, n, p0)
        order = np.argsort(pmf, kind="stable")
        csum = np.cumsum(pmf[order])
        # p(k) = total mass of outcomes with pmf <= pmf[k] * (1 + 1e-7)
        idx = np.searchsorted(pmf[order], pmf * _REL, side="right") - 1
        pval = csum[idx]
    return np.asarray(pval <= alpha, dtype=bool)


def binomial_exact_power(
    p0: float, p1: float, n: int, *, alpha: float = 0.05, tails: int = 2
) -> float:
    """Exact power of the binomial test of ``p = p0`` when the true proportion is ``p1``."""
    _check(alpha, tails)
    if not 0.0 <= p1 <= 1.0:
        raise ValueError("p1 must be between 0 and 1")
    region = binomial_rejection_region(int(n), p0, alpha, tails, p1 >= p0)
    pmf1 = stats.binom.pmf(np.arange(int(n) + 1), int(n), p1)
    return float(min(1.0, max(0.0, float(np.sum(pmf1[region])))))


def binomial_actual_alpha(
    p0: float, n: int, *, alpha: float = 0.05, tails: int = 2, upper: bool = True
) -> float:
    """The true type I error of the exact test (at most ``alpha``, usually well below)."""
    _check(alpha, tails)
    region = binomial_rejection_region(int(n), p0, alpha, tails, upper)
    return float(np.sum(stats.binom.pmf(np.arange(int(n) + 1), int(n), p0)[region]))


def chisq_power(w: float, n: float, df: int, *, alpha: float = 0.05) -> float:
    """Power of a chi-square test at Cohen's w, total count ``n`` and ``df`` degrees of freedom."""
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be in (0, 1)")
    if df < 1:
        raise ValueError("the degrees of freedom must be at least 1")
    crit = float(stats.chi2.isf(alpha, df))
    ncp = w * w * n
    if ncp == 0.0:  # scipy's ncx2 is unreliable at exactly 0: the null is the central chi-square
        return float(stats.chi2.sf(crit, df))
    return float(stats.ncx2.sf(crit, df, ncp))


def correlation_power(r: float, n: float, *, alpha: float = 0.05, tails: int = 2) -> float:
    """Power of the test of H0: rho = 0 at true correlation ``r`` (Fisher z approximation)."""
    _check(alpha, tails)
    if not abs(r) < 1.0:
        raise ValueError("the correlation must be strictly between -1 and 1")
    if not n > 3.0:
        return 0.0
    ncp = abs(math.atanh(r)) * math.sqrt(n - 3.0)
    if tails == 2:
        zc = float(stats.norm.isf(alpha / 2.0))
        return float(stats.norm.sf(zc - ncp) + stats.norm.cdf(-zc - ncp))
    return float(stats.norm.sf(float(stats.norm.isf(alpha)) - ncp))
