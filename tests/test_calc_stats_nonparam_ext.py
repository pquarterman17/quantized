"""Dunn-Sidak, Mood's median, Poisson rate and Wilks tolerance (GAP_AUDIT_9 G6).

Oracles: scipy (median_test, binomtest, kruskal), R ``poisson.test`` documentation
examples, NIST/SEMATECH 7.2.6.4 (N = 25 table) and independent re-derivations.
"""

from __future__ import annotations

import itertools
import math

import numpy as np
import pytest
from scipy import stats as sps

from quantized.calc.stats_nonparam_ext import (
    dunn_sidak,
    mood_median,
    poisson_rate_test,
    tolerance_interval_np,
    wilks_confidence,
)

RNG = np.random.default_rng(7)
G = [RNG.normal(0, 1, 12), RNG.normal(0.8, 1, 15), RNG.normal(2.0, 1.5, 10)]


def test_dunn_matches_independent_formula() -> None:
    r = dunn_sidak(G, alpha=0.05)
    allv = np.concatenate(G)
    rk = sps.rankdata(allv)
    n = len(allv)
    sizes = [len(g) for g in G]
    cut = np.cumsum([0, *sizes])
    mr = [rk[cut[i] : cut[i + 1]].mean() for i in range(3)]
    for row in r["pairs"]:
        i, j = row["i"], row["j"]
        z = (mr[i] - mr[j]) / math.sqrt(n * (n + 1) / 12 * (1 / sizes[i] + 1 / sizes[j]))
        p = 2 * sps.norm.sf(abs(z))
        assert row["statistic"] == pytest.approx(z, rel=1e-10)
        assert row["p_raw"] == pytest.approx(p, rel=1e-10)
        assert row["p"] == pytest.approx(1 - (1 - p) ** 3, rel=1e-10)
    assert r["omnibus_p"] == pytest.approx(sps.kruskal(*G).pvalue)
    assert [x["i"] for x in r["pairs"]] == [0, 0, 1]


def test_dunn_hand_fixture_with_ties() -> None:
    # Dunn (1964) tie correction: ranks of [1,2,2] | [3,4,4]: N=6, ties 2 x (2^3-2)=12
    a, b = np.array([1.0, 2.0, 2.0]), np.array([3.0, 4.0, 4.0])
    r = dunn_sidak([a, b])
    var0 = 6 * 7 / 12 - 12 / (12 * 5)  # 3.5 - 0.2
    z = (2.0 - 5.0) / math.sqrt(var0 * (2 / 3))  # mean ranks: (1+2.5+2.5)/3 = 2, (4+5.5+5.5)/3 = 5
    assert r["pairs"][0]["statistic"] == pytest.approx(z)
    assert r["pairs"][0]["p"] == pytest.approx(2 * sps.norm.sf(abs(z)))  # m = 1: Sidak = raw


def test_dunn_refusals() -> None:
    with pytest.raises(ValueError):
        dunn_sidak([np.ones(4), np.ones(4)])  # all identical
    with pytest.raises(ValueError):
        dunn_sidak([np.array([1.0, 2.0])])


@pytest.mark.parametrize("groups", [G, G[:2], [G[0], G[1] + 1.0, G[2], G[2][::-1] - 0.3]])
def test_mood_median_matches_scipy(groups: list[np.ndarray]) -> None:
    r = mood_median(groups)
    stat, p, med, table = sps.median_test(*groups)
    assert r["statistic"] == pytest.approx(stat, rel=1e-10)
    assert r["p"] == pytest.approx(p, rel=1e-10)
    assert r["grand_median"] == pytest.approx(med)
    assert [[g["above"] for g in r["groups"]], [g["below"] for g in r["groups"]]] == table.tolist()


def test_mood_median_ties_at_median_count_below() -> None:
    gs = [np.array([1.0, 2.0, 3.0, 3.0, 3.0]), np.array([3.0, 3.0, 4.0, 5.0, 6.0])]
    r = mood_median(gs)
    stat, p, _, _ = sps.median_test(*gs)  # scipy default ties="below"
    assert r["p"] == pytest.approx(p) and r["statistic"] == pytest.approx(stat)


def test_mood_median_refuses_all_tied() -> None:
    with pytest.raises(ValueError):
        mood_median([np.full(5, 2.0), np.full(5, 2.0)])


def test_poisson_one_sample_r_documentation_example() -> None:
    # R ?poisson.test: poisson.test(137, 24.19893): estimate 5.661407, 95% CI 4.753125-6.692709.
    r = poisson_rate_test(137, 24.19893, rate0=1.0)
    assert r["rate1"] == pytest.approx(5.661407, abs=1e-6)
    assert r["ci_low"] == pytest.approx(4.753125, abs=1e-6)
    assert r["ci_high"] == pytest.approx(6.692709, abs=1e-6)
    assert r["p"] < 1e-50 and r["significant"]


def test_poisson_two_sample_r_documentation_example() -> None:
    # R ?poisson.test: poisson.test(c(11, 6+8+7), c(800, 1083+1050+878)):
    # p = 0.07967, ratio 1.971488, 95% CI 0.8584264-4.2772659.
    r = poisson_rate_test(11, 800, x2=21, t2=3011)
    assert r["p"] == pytest.approx(0.07967, abs=5e-6)
    assert r["ratio"] == pytest.approx(1.971488, abs=1e-6)
    assert r["ci_low"] == pytest.approx(0.8584264, abs=1e-6)
    assert r["ci_high"] == pytest.approx(4.2772659, abs=1e-6)
    assert not r["significant"]


def test_poisson_two_sample_is_conditional_binomial() -> None:
    r = poisson_rate_test(9, 2.0, x2=4, t2=3.0, ratio0=1.5, alternative="greater")
    p = 1.5 * 2.0 / (1.5 * 2.0 + 3.0)
    assert r["p"] == pytest.approx(sps.binom.sf(8, 13, p), rel=1e-12)


@pytest.mark.parametrize("x,mu", [(0, 3.0), (2, 5.5), (9, 5.5), (12, 4.0), (5, 5.0)])
def test_poisson_one_sample_minlike_matches_brute_force(x: int, mu: float) -> None:
    pm = sps.poisson.pmf(np.arange(0, 400), mu)
    brute = float(pm[pm <= sps.poisson.pmf(x, mu) * (1 + 1e-7)].sum())
    assert poisson_rate_test(x, 1.0, rate0=mu)["p"] == pytest.approx(brute, rel=1e-9, abs=1e-12)


def test_poisson_one_sided_and_ci() -> None:
    lo = poisson_rate_test(3, 2.0, rate0=3.0, alternative="less")
    assert lo["p"] == pytest.approx(sps.poisson.cdf(3, 6.0)) and lo["ci_low"] == 0.0
    hi = poisson_rate_test(10, 2.0, rate0=3.0, alternative="greater")
    assert hi["p"] == pytest.approx(sps.poisson.sf(9, 6.0)) and math.isinf(hi["ci_high"])
    zero = poisson_rate_test(0, 5.0)  # Garwood x=0: lower 0, upper -ln(alpha/2)/t
    assert zero["ci_low"] == 0.0 and zero["ci_high"] == pytest.approx(-math.log(0.025) / 5.0)


def test_poisson_refusals() -> None:
    for kw in (
        {"x1": -1},
        {"x1": 2.5},
        {"x1": 3, "t1": 0},
        {"x1": 3, "rate0": 0},
        {"x1": 3, "x2": 2},
        {"x1": 0, "t1": 1, "x2": 0, "t2": 1},
        {"x1": 3, "x2": 2, "t2": 1, "ratio0": 0},
    ):
        with pytest.raises(ValueError):
            poisson_rate_test(**kw)  # type: ignore[arg-type]


def test_wilks_nist_7_2_6_4_table_n25() -> None:
    # NIST 7.2.6.4: confidence of (min, max) as tolerance limits, N = 25.
    nist = {
        0.5: 1.000,
        0.75: 0.993,
        0.9: 0.729,
        0.95: 0.358,
        0.975: 0.129,
        0.99: 0.026,
        0.995: 0.007,
    }
    for cov, conf in nist.items():
        formula = 1 - 25 * cov**24 + 24 * cov**25
        assert wilks_confidence(25, cov, 2) == pytest.approx(formula, abs=1e-12)
        assert round(wilks_confidence(25, cov, 2), 3) == conf


def test_wilks_by_simulation() -> None:
    # coverage of (x_(2), x_(n-1)) for n = 40: simulate the achieved confidence at p = 0.85.
    rng = np.random.default_rng(1)
    n, p, trials = 40, 0.85, 20000
    x = np.sort(rng.uniform(size=(trials, n)), axis=1)
    cover = x[:, n - 2] - x[:, 1]
    assert np.mean(cover >= p) == pytest.approx(wilks_confidence(n, p, 4), abs=0.012)


def test_tolerance_np_two_sided_picks_tightest() -> None:
    x = np.arange(1.0, 101.0)
    r = tolerance_interval_np(x, coverage=0.9, confidence=0.95)
    assert (r["lower"], r["upper"], r["rank_from_each_end"]) == (2.0, 99.0, 2)
    k = r["rank_from_each_end"]
    assert r["achieved_confidence"] >= 0.95 > wilks_confidence(100, 0.9, 2 * (k + 1))
    assert r["lower"] == x[k - 1] and r["upper"] == x[100 - k]
    assert r["min_n_extremes"] == 46  # smallest n for (min, max) at 0.9 / 0.95 (NIST-style table)


def test_tolerance_np_one_sided() -> None:
    x = np.arange(1.0, 60.0)  # n = 59: classic 95/95 one-sided, k = 1 -> sample max
    r = tolerance_interval_np(x, coverage=0.95, confidence=0.95, sides="upper")
    assert r["upper"] == 59.0 and r["lower"] is None
    assert r["achieved_confidence"] == pytest.approx(1 - 0.95**59)
    assert r["min_n_extremes"] == 59  # the well-known n = 59 for 95/95
    lo = tolerance_interval_np(x, coverage=0.95, confidence=0.95, sides="lower")
    assert lo["lower"] == 1.0 and lo["upper"] is None


def test_tolerance_np_refuses_small_n_with_requirement() -> None:
    with pytest.raises(ValueError, match="at least 46"):
        tolerance_interval_np(np.arange(20.0), coverage=0.9, confidence=0.95)
    with pytest.raises(ValueError, match="at least 59"):
        tolerance_interval_np(np.arange(30.0), coverage=0.95, confidence=0.95, sides="upper")
    with pytest.raises(ValueError):
        tolerance_interval_np(np.arange(50.0), coverage=1.0)
    with pytest.raises(ValueError):
        tolerance_interval_np(np.array([1.0, np.inf, 3.0]))


def test_min_n_agrees_with_brute_force() -> None:
    for cov, conf, ell in itertools.product((0.8, 0.9, 0.99), (0.9, 0.95), (1, 2)):
        r = tolerance_interval_np(
            np.arange(1.0, 2001.0),
            coverage=cov,
            confidence=conf,
            sides="upper" if ell == 1 else "two",
        )
        n = next(n for n in range(ell + 1, 5000) if wilks_confidence(n, cov, ell) >= conf)
        assert r["min_n_extremes"] == n
