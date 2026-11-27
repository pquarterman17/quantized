"""Power of the common tests, exactly: the forward half of power analysis.

Each ``*_power`` function is the probability that the test rejects at level
``alpha`` when the true effect is ``effect``, at the stated sample size. The
solvers for sample size and detectable effect are in ``stats_power_solve`` and
only ever call these, so the three questions (power, n, effect) always agree.

Conventions (G*Power's, which statsmodels shares):

* ``tails=2`` is the two-sided test; ``tails=1`` is one-sided *in the direction
  of the effect*, so the sign of the effect is ignored (``abs``) - the same
  convention the t-test power in ``stats_dist`` has always had.
* ``n`` is per group for a two-sample test (the second group has ``n2``) and
  for each ANOVA group; it is the number of pairs for a paired test.
* t-tests use the noncentral t, ANOVA the noncentral F (Cohen's f, ncp =
  f^2 * N), proportions the arcsine transform (Cohen's h, a normal
  approximation), and the one-sample variance test the exact scaled
  chi-square.

References: Cohen (1988), *Statistical Power Analysis for the Behavioral
Sciences*, 2nd ed., ch. 2 (t), 6 (h), 8 (f); G*Power 3 manual.
"""

from __future__ import annotations

import math

from scipy import stats

__all__ = [
    "T_KINDS",
    "anova_power",
    "cohens_h",
    "proportion_power",
    "t_power",
    "variance_power",
]

T_KINDS = ("one-sample", "paired", "two-sample")


def _check_alpha(alpha: float) -> None:
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be in (0, 1)")


def _tails(tails: int) -> None:
    if tails not in (1, 2):
        raise ValueError("tails must be 1 or 2")


def t_power(
    kind: str,
    effect: float,
    n: float,
    *,
    alpha: float = 0.05,
    tails: int = 2,
    n2: float | None = None,
) -> float:
    """Power of a one-sample, paired or two-sample t-test at Cohen's d = ``effect``.

    ``n`` is the (first) group size; a two-sample test with ``n2`` unset has
    ``n2 = n``. The noncentrality is ``d * sqrt(n1 * n2 / (n1 + n2))`` with
    ``n1 + n2 - 2`` degrees of freedom; one-sample and paired use
    ``d * sqrt(n)`` and ``n - 1``.
    """
    if kind not in T_KINDS:
        raise ValueError(f"kind must be one of {T_KINDS}, got {kind!r}")
    _check_alpha(alpha)
    _tails(tails)
    if kind == "two-sample":
        m = n if n2 is None else n2
        df = n + m - 2.0
        ncp = abs(effect) * math.sqrt(n * m / (n + m))
    else:
        df = n - 1.0
        ncp = abs(effect) * math.sqrt(n)
    if not df >= 1.0:
        return 0.0
    tc = float(stats.t.isf(alpha / 2.0 if tails == 2 else alpha, df))
    if ncp == 0.0:  # scipy's nct is wrong at exactly 0: the null is the central t
        upper = float(stats.t.sf(tc, df))
        return upper + float(stats.t.cdf(-tc, df)) if tails == 2 else upper
    upper = float(stats.nct.sf(tc, df, ncp))
    lower = float(stats.nct.cdf(-tc, df, ncp)) if tails == 2 else 0.0
    if not (math.isfinite(upper) and math.isfinite(lower)):
        # scipy gives NaN for a very large ncp; there the power is 1 (ncp far above the cutoff).
        return 1.0 if ncp > tc else 0.0
    return upper + lower


def anova_power(effect: float, n: float, groups: int, *, alpha: float = 0.05) -> float:
    """Power of a balanced one-way ANOVA F test at Cohen's f = ``effect``.

    ``n`` per group, ``groups`` (k >= 2) groups; ``ncp = f^2 * k * n`` with
    ``(k - 1, k*n - k)`` degrees of freedom. The F test is always upper-tailed.
    """
    _check_alpha(alpha)
    if groups < 2:
        raise ValueError("an ANOVA needs at least 2 groups")
    total = groups * n
    df1, df2 = groups - 1.0, total - groups
    if not df2 >= 1.0:
        return 0.0
    crit = float(stats.f.isf(alpha, df1, df2))
    ncp = effect * effect * total
    if ncp == 0.0:  # scipy's ncf is wrong at exactly 0: the null is the central F
        return float(stats.f.sf(crit, df1, df2))
    return float(stats.ncf.sf(crit, df1, df2, ncp))


def cohens_h(p1: float, p0: float) -> float:
    """Cohen's h: the arcsine-transformed difference of two proportions."""
    for p in (p1, p0):
        if not 0.0 <= p <= 1.0:
            raise ValueError("proportions must be in [0, 1]")
    return 2.0 * math.asin(math.sqrt(p1)) - 2.0 * math.asin(math.sqrt(p0))


def proportion_power(
    h: float,
    n: float,
    *,
    alpha: float = 0.05,
    tails: int = 2,
    n2: float | None = None,
) -> float:
    """Power of a z test of one proportion (``n2`` None) or two, at Cohen's h.

    One proportion tests ``p = p0`` with ``ncp = h * sqrt(n)``; two proportions
    test ``p1 = p2`` with ``ncp = h * sqrt(n1 * n2 / (n1 + n2))``. This is the
    arcsine normal approximation (statsmodels' ``NormalIndPower``): reliable
    from roughly n*p >= 10, optimistic for tiny samples.
    """
    _check_alpha(alpha)
    _tails(tails)
    m = n if n2 is None else n * n2 / (n + n2)
    ncp = abs(h) * math.sqrt(m)
    if tails == 2:
        zc = float(stats.norm.isf(alpha / 2.0))
        return float(stats.norm.sf(zc - ncp) + stats.norm.cdf(-zc - ncp))
    return float(stats.norm.sf(float(stats.norm.isf(alpha)) - ncp))


def variance_power(ratio: float, n: float, *, alpha: float = 0.05, tails: int = 2) -> float:
    """Power of the chi-square test of one variance, H0: sigma^2 = sigma0^2.

    ``ratio`` = sigma1^2 / sigma0^2 (the true variance over the hypothesised
    one), ``n`` the sample size, ``df = n - 1``. Under the alternative
    ``(n - 1) s^2 / sigma0^2`` is ``ratio`` times a chi-square(df), so the
    power is exact. Two-sided uses equal-tailed critical values. One-sided
    follows the effect: ``ratio > 1`` is the upper-tailed test of
    ``sigma^2 > sigma0^2``, ``ratio < 1`` the lower-tailed test.
    """
    _check_alpha(alpha)
    _tails(tails)
    if not ratio > 0.0:
        raise ValueError("the variance ratio must be positive")
    df = n - 1.0
    if not df >= 1.0:
        return 0.0
    if tails == 2:
        lo = float(stats.chi2.ppf(alpha / 2.0, df))
        hi = float(stats.chi2.isf(alpha / 2.0, df))
        return float(stats.chi2.cdf(lo / ratio, df) + stats.chi2.sf(hi / ratio, df))
    if ratio >= 1.0:
        return float(stats.chi2.sf(float(stats.chi2.isf(alpha, df)) / ratio, df))
    return float(stats.chi2.cdf(float(stats.chi2.ppf(alpha, df)) / ratio, df))
