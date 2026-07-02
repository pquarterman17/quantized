"""Nonparametric hypothesis tests + normality/variance assumption checks.

Thin, typed wrappers around ``scipy.stats`` (BSD) returning uniform result
dicts, in the style of ``calc.stats``. New capability beyond MATLAB parity
(ORIGIN_GAP_PLAN #25 + the wrapper half of #26); validated against
hand-derivable exact small-sample values in ``tests/test_calc_stats_tests.py``.

All functions are pure: ndarrays in, plain dicts out. No FastAPI imports.
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

_ALTERNATIVES = ("two-sided", "less", "greater")


def _check_alternative(alternative: str) -> str:
    if alternative not in _ALTERNATIVES:
        raise ValueError(f"alternative must be one of {_ALTERNATIVES}, got {alternative!r}")
    return alternative


def _clean(x: NDArray[np.float64]) -> NDArray[np.float64]:
    x = np.asarray(x, dtype=float).ravel()
    return x[np.isfinite(x)]


def mann_whitney(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    alternative: str = "two-sided",
) -> dict[str, Any]:
    """Mann-Whitney U test (independent two-sample rank test).

    Exact p-value for small samples without ties, normal approximation
    otherwise (scipy ``method='auto'``). Reference: Conover, *Practical
    Nonparametric Statistics*, 3rd ed., ch. 5.
    """
    x, y = _clean(x), _clean(y)
    _check_alternative(alternative)
    if x.size < 1 or y.size < 1:
        raise ValueError("mann_whitney needs at least one observation per group")
    res = sps.mannwhitneyu(x, y, alternative=alternative, method="auto")
    return {
        "U": float(res.statistic),
        "p": float(res.pvalue),
        "n1": int(x.size),
        "n2": int(y.size),
        "alternative": alternative,
        "method": "Mann-Whitney U",
    }


def wilcoxon_signed_rank(
    x: NDArray[np.float64],
    y: NDArray[np.float64] | None = None,
    mu: float = 0.0,
    alternative: str = "two-sided",
) -> dict[str, Any]:
    """Wilcoxon signed-rank test (paired two-sample, or one-sample vs ``mu``).

    Zero differences are dropped (Wilcoxon's original treatment). Exact
    p-value for small samples without ties. Reference: Conover ch. 5.7.
    """
    x = _clean(x)
    _check_alternative(alternative)
    if y is not None:
        y = np.asarray(y, dtype=float).ravel()
        if y.size != x.size:
            raise ValueError("wilcoxon_signed_rank: x and y must be the same length")
        d = x - y
    else:
        d = x - mu
    d = d[np.isfinite(d)]
    if not np.any(d != 0.0):
        raise ValueError("wilcoxon_signed_rank: all differences are zero")
    res = sps.wilcoxon(d, alternative=alternative, zero_method="wilcox", method="auto")
    return {
        "W": float(res.statistic),
        "p": float(res.pvalue),
        "n": int(np.count_nonzero(d)),
        "alternative": alternative,
        "method": "Wilcoxon signed-rank",
    }


def kruskal_wallis(groups: list[NDArray[np.float64]]) -> dict[str, Any]:
    """Kruskal-Wallis H test (one-way ANOVA on ranks, k independent groups).

    H is chi-squared distributed with k-1 degrees of freedom under H0.
    Reference: Kruskal & Wallis, JASA 47 (1952) 583.
    """
    cleaned = [_clean(g) for g in groups]
    if len(cleaned) < 2:
        raise ValueError("kruskal_wallis needs at least 2 groups")
    if any(g.size < 1 for g in cleaned):
        raise ValueError("kruskal_wallis: every group needs at least one observation")
    res = sps.kruskal(*cleaned)
    return {
        "H": float(res.statistic),
        "p": float(res.pvalue),
        "df": len(cleaned) - 1,
        "n_groups": len(cleaned),
        "N": int(sum(g.size for g in cleaned)),
        "method": "Kruskal-Wallis H",
    }


def friedman(groups: list[NDArray[np.float64]]) -> dict[str, Any]:
    """Friedman test (repeated measures on ranks; k treatments x n blocks).

    Each entry of ``groups`` is one treatment measured over the same n
    blocks (equal lengths required). Reference: Friedman, JASA 32 (1937) 675.
    """
    arrs = [np.asarray(g, dtype=float).ravel() for g in groups]
    if len(arrs) < 3:
        raise ValueError("friedman needs at least 3 treatments (scipy restriction)")
    n = arrs[0].size
    if n < 2 or any(a.size != n for a in arrs):
        raise ValueError("friedman: all treatments need the same number (>=2) of blocks")
    res = sps.friedmanchisquare(*arrs)
    return {
        "chi2": float(res.statistic),
        "p": float(res.pvalue),
        "df": len(arrs) - 1,
        "n_treatments": len(arrs),
        "n_blocks": n,
        "method": "Friedman chi-square",
    }


def sign_test(
    x: NDArray[np.float64],
    y: NDArray[np.float64] | None = None,
    mu: float = 0.0,
    alternative: str = "two-sided",
) -> dict[str, Any]:
    """Sign test (paired or one-sample vs ``mu``) via exact binomial test.

    Ignores zero differences; p from Binomial(n_pos + n_neg, 1/2).
    ``alternative='greater'`` tests median > mu (i.e. an excess of positive
    differences). Reference: Conover ch. 3.4.
    """
    x = _clean(x)
    _check_alternative(alternative)
    if y is not None:
        y = np.asarray(y, dtype=float).ravel()
        if y.size != x.size:
            raise ValueError("sign_test: x and y must be the same length")
        d = x - y
    else:
        d = x - mu
    d = d[np.isfinite(d) & (d != 0.0)]
    if d.size == 0:
        raise ValueError("sign_test: no nonzero differences")
    n_pos = int(np.count_nonzero(d > 0))
    n = int(d.size)
    res = sps.binomtest(n_pos, n, 0.5, alternative=alternative)
    return {
        "n_pos": n_pos,
        "n_neg": n - n_pos,
        "n": n,
        "p": float(res.pvalue),
        "alternative": alternative,
        "method": "sign test (exact binomial)",
    }


def shapiro_wilk(x: NDArray[np.float64]) -> dict[str, Any]:
    """Shapiro-Wilk normality test. Valid for 3 <= n <= 5000.

    Reference: Shapiro & Wilk, Biometrika 52 (1965) 591.
    """
    x = _clean(x)
    if x.size < 3:
        raise ValueError("shapiro_wilk needs at least 3 observations")
    if x.size > 5000:
        raise ValueError("shapiro_wilk p-value unreliable above n=5000; subsample first")
    res = sps.shapiro(x)
    return {
        "W": float(res.statistic),
        "p": float(res.pvalue),
        "N": int(x.size),
        "method": "Shapiro-Wilk",
    }


def anderson_darling(x: NDArray[np.float64]) -> dict[str, Any]:
    """Anderson-Darling normality test (parameters estimated from the data).

    Returns the A^2 statistic with critical values at fixed significance
    levels instead of a p-value (Stephens' tabulation, as in scipy).
    Reference: Stephens, JASA 69 (1974) 730.
    """
    x = _clean(x)
    if x.size < 3:
        raise ValueError("anderson_darling needs at least 3 observations")
    # keep the classic critical-value-table behavior (scipy >= 1.17 warns
    # pending a p-value API migration; revisit when we require that API)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FutureWarning)
        res = sps.anderson(x, dist="norm")
    crit = np.asarray(res.critical_values, dtype=float)
    sig = np.asarray(res.significance_level, dtype=float)
    a2 = float(res.statistic)
    return {
        "A2": a2,
        "critical_values": crit.tolist(),
        "significance_levels_pct": sig.tolist(),
        "reject_at_5pct": bool(a2 > crit[sig == 5.0][0]) if np.any(sig == 5.0) else None,
        "N": int(x.size),
        "method": "Anderson-Darling (normal)",
    }


def levene(groups: list[NDArray[np.float64]], center: str = "median") -> dict[str, Any]:
    """Levene test for equal variances across k groups.

    ``center='median'`` is the robust Brown-Forsythe variant (default);
    ``'mean'`` is the classic Levene test. Reference: Brown & Forsythe,
    JASA 69 (1974) 364.
    """
    if center not in ("median", "mean", "trimmed"):
        raise ValueError("center must be 'median', 'mean', or 'trimmed'")
    cleaned = [_clean(g) for g in groups]
    if len(cleaned) < 2 or any(g.size < 2 for g in cleaned):
        raise ValueError("levene needs >=2 groups with >=2 observations each")
    res = sps.levene(*cleaned, center=center)
    return {
        "W": float(res.statistic),
        "p": float(res.pvalue),
        "center": center,
        "n_groups": len(cleaned),
        "method": "Brown-Forsythe" if center == "median" else "Levene",
    }


def ks_normal(
    x: NDArray[np.float64],
    loc: float | None = None,
    scale: float | None = None,
) -> dict[str, Any]:
    """One-sample Kolmogorov-Smirnov test against a normal distribution.

    When ``loc``/``scale`` are omitted they are estimated from the sample
    (mean, ddof=1 std); the p-value is then only approximate (Lilliefors
    situation) and flagged via ``params_estimated``. Prefer Shapiro-Wilk
    for pure normality checks; use this when loc/scale are known a priori.
    """
    x = _clean(x)
    if x.size < 3:
        raise ValueError("ks_normal needs at least 3 observations")
    estimated = loc is None or scale is None
    loc_v = float(np.mean(x)) if loc is None else float(loc)
    scale_v = float(np.std(x, ddof=1)) if scale is None else float(scale)
    if scale_v <= 0:
        raise ValueError("ks_normal: scale must be positive")
    # frozen-cdf form: the string form ("norm" + args) trips a broken
    # ndtr fast path in some scipy releases
    res = sps.kstest(x, sps.norm(loc=loc_v, scale=scale_v).cdf)
    return {
        "D": float(res.statistic),
        "p": float(res.pvalue),
        "loc": loc_v,
        "scale": scale_v,
        "params_estimated": estimated,
        "N": int(x.size),
        "method": "Kolmogorov-Smirnov (normal)",
    }


def ks_two_sample(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    alternative: str = "two-sided",
) -> dict[str, Any]:
    """Two-sample Kolmogorov-Smirnov test (same-distribution null)."""
    x, y = _clean(x), _clean(y)
    _check_alternative(alternative)
    if x.size < 1 or y.size < 1:
        raise ValueError("ks_two_sample needs at least one observation per sample")
    res = sps.ks_2samp(x, y, alternative=alternative)
    return {
        "D": float(res.statistic),
        "p": float(res.pvalue),
        "n1": int(x.size),
        "n2": int(y.size),
        "alternative": alternative,
        "method": "Kolmogorov-Smirnov (two-sample)",
    }
