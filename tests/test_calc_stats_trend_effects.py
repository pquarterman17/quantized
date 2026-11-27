"""Mann-Kendall / Sen's slope, Steel-Dwass and ANOVA effect sizes: hand-checked."""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy import stats

from quantized.calc.stats import anova1
from quantized.calc.stats_anova2 import anova2
from quantized.calc.stats_anova_ext import anova2_unbalanced
from quantized.calc.stats_effect_sizes import anova_effect_sizes
from quantized.calc.stats_steel_dwass import steel_dwass
from quantized.calc.stats_trend import mann_kendall

# ---- Mann-Kendall ---------------------------------------------------------


def test_mk_monotone_series_by_hand() -> None:
    # y = 1..5: S = 10, Var = 5*4*15/18, Z = (10-1)/sqrt(Var), p = 2(1-Phi(Z)).
    r = mann_kendall([1, 2, 3, 4, 5])
    var = 5 * 4 * 15 / 18
    assert r["S"] == 10 and r["var_S"] == pytest.approx(var)
    assert r["Z"] == pytest.approx(9 / math.sqrt(var))
    assert r["p"] == pytest.approx(2 * stats.norm.sf(9 / math.sqrt(var)))
    assert r["p"] == pytest.approx(0.02747, abs=5e-5)
    assert r["tau"] == pytest.approx(1.0)
    assert (r["sen_slope"], r["sen_ci_low"], r["sen_ci_high"]) == (1.0, 1.0, 1.0)
    assert r["trend"] == "increasing"


def test_mk_with_ties_by_hand() -> None:
    # y = 1,2,2,3: S = 5; tie group t=2 -> sum = 2*1*9 = 18;
    # Var = (4*3*13 - 18)/18 = 138/18; Z = (5-1)/sqrt(Var) = 1.4446.
    r = mann_kendall([1, 2, 2, 3])
    var = (4 * 3 * 13 - 18) / 18
    assert r["S"] == 5 and r["var_S"] == pytest.approx(var) and r["n_tie_groups"] == 1
    assert r["Z"] == pytest.approx(4 / math.sqrt(var))
    assert r["Z"] == pytest.approx(1.4446, abs=5e-5)
    assert r["p"] == pytest.approx(0.1486, abs=5e-4)
    # tau-b = S / sqrt(n0 (n0 - n1)) with n0 = 6, n1 = 1
    assert r["tau"] == pytest.approx(5 / math.sqrt(6 * 5))
    assert r["tau"] == pytest.approx(stats.kendalltau(np.arange(4), [1, 2, 2, 3]).statistic)
    # slopes 1, .5, 2/3, 0, .5, 1 -> sorted 0,.5,.5,2/3,1,1 -> median (0.5 + 2/3)/2
    assert r["sen_slope"] == pytest.approx((0.5 + 2 / 3) / 2)
    # N = 6, C = 1.95996*sqrt(Var) = 5.427: ranks 0.287 and 6.713 clip to 1 and 6
    assert (r["sen_ci_low"], r["sen_ci_high"]) == (0.0, 1.0)
    assert r["sen_intercept"] == pytest.approx(2.0 - r["sen_slope"] * 1.5)


def test_mk_negative_s_and_no_trend() -> None:
    r = mann_kendall([5, 4, 3, 2, 1])
    assert r["S"] == -10 and r["Z"] == pytest.approx(-9 / math.sqrt(5 * 4 * 15 / 18))
    assert r["trend"] == "decreasing" and r["sen_slope"] == -1.0


def test_mk_zero_s_gives_z_zero() -> None:
    r = mann_kendall([1, 3, 2, 2])  # 1,3,2,2: S = +1 +1 +1 -1 -1 +0 = 1
    assert r["S"] == 1 and r["Z"] == 0.0 and r["p"] == pytest.approx(1.0)


def test_mk_uses_x_order_and_scales_slope() -> None:
    x = np.array([30.0, 10.0, 20.0, 50.0, 40.0])
    y = 2.0 * x + 1.0
    r = mann_kendall(y, x)
    assert r["S"] == 10 and r["sen_slope"] == pytest.approx(2.0)
    assert r["sen_intercept"] == pytest.approx(1.0)
    theil = stats.theilslopes(y, x)
    assert r["sen_slope"] == pytest.approx(theil.slope)


def test_mk_sen_slope_matches_theilslopes_on_noise() -> None:
    rng = np.random.default_rng(0)
    y = 0.3 * np.arange(40) + rng.normal(0, 1, 40)
    r = mann_kendall(y)
    assert r["sen_slope"] == pytest.approx(stats.theilslopes(y).slope)
    assert r["sen_ci_low"] < r["sen_slope"] < r["sen_ci_high"]
    assert r["p"] < 0.001


def test_mk_ci_ranks_independent_computation() -> None:
    rng = np.random.default_rng(5)
    y = rng.normal(0, 1, 12).cumsum()
    r = mann_kendall(y)
    n = 12
    slopes = sorted((y[j] - y[i]) / (j - i) for i in range(n) for j in range(i + 1, n))
    big_n = len(slopes)
    c = stats.norm.isf(0.025) * math.sqrt(r["var_S"])
    for rank, key in (((big_n - c) / 2, "sen_ci_low"), ((big_n + c) / 2 + 1, "sen_ci_high")):
        rank = min(max(rank, 1), big_n)
        lo = int(rank)
        val = slopes[lo - 1] + (rank - lo) * (slopes[min(lo, big_n - 1)] - slopes[lo - 1])
        assert r[key] == pytest.approx(val)


def test_mk_validation() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        mann_kendall([1, 2])
    with pytest.raises(ValueError, match="tied"):
        mann_kendall([2, 2, 2, 2])
    with pytest.raises(ValueError, match="distinct"):
        mann_kendall([1, 2, 3], [1, 1, 2])
    with pytest.raises(ValueError, match="same length"):
        mann_kendall([1, 2, 3], [1, 2])
    r = mann_kendall([1, np.nan, 3, 4, 6])
    assert r["n"] == 4


# ---- Steel-Dwass ----------------------------------------------------------


def _sd_reference(gs: list[np.ndarray], i: int, j: int) -> tuple[float, float]:
    """Brute-force z and q straight from the published formula."""
    a, b = gs[i], gs[j]
    allv = np.concatenate([a, b])
    n = allv.size
    ranks = np.array([np.sum(allv < v) + (np.sum(allv == v) + 1) / 2 for v in allv])
    w = ranks[: a.size].sum()
    e = a.size * (n + 1) / 2
    ties = sum(c**3 - c for c in np.unique(allv, return_counts=True)[1])
    var = a.size * b.size / 12 * ((n + 1) - ties / (n * (n - 1)))
    z = (w - e) / math.sqrt(var)
    return z, math.sqrt(2) * abs(z)


def test_steel_dwass_hand_example_k2_equals_normal_rank_sum() -> None:
    # A = 1,2,3 vs B = 4,5,6: W = 6, E = 10.5, Var = 9/12*7 = 5.25,
    # z = -4.5/sqrt(5.25) = -1.9640; with k = 2 the p is the normal two-sided one.
    r = steel_dwass([np.array([1.0, 2, 3]), np.array([4.0, 5, 6])])
    pr = r["pairs"][0]
    assert pr["W"] == 6.0 and pr["diff"] == -4.5
    assert pr["statistic"] == pytest.approx(-4.5 / math.sqrt(5.25))
    assert pr["p"] == pytest.approx(2 * stats.norm.sf(1.96396), abs=1e-5)
    assert pr["p"] == pytest.approx(0.04953, abs=1e-4)
    assert pr["q"] == pytest.approx(math.sqrt(2) * 1.96396, abs=1e-4)
    assert r["key"] == "steel-dwass"


def test_steel_dwass_matches_brute_force_with_ties_k4() -> None:
    gs = [
        np.array([1.0, 2, 2, 3, 5]),
        np.array([2.0, 4, 4, 6]),
        np.array([5.0, 6, 7, 7, 8, 9]),
        np.array([1.0, 1, 3, 4]),
    ]
    r = steel_dwass(gs)
    assert len(r["pairs"]) == 6
    for pr in r["pairs"]:
        z, q = _sd_reference(gs, pr["i"], pr["j"])
        assert pr["statistic"] == pytest.approx(z)
        assert pr["q"] == pytest.approx(q)
        assert pr["p"] == pytest.approx(float(stats.studentized_range.sf(q, 4, np.inf)))
        assert pr["p"] >= pr["p_raw"] - 1e-12  # familywise p is never below the raw one
    assert r["omnibus_p"] == pytest.approx(float(stats.kruskal(*gs).pvalue))


def test_steel_dwass_detects_the_shifted_group_only() -> None:
    rng = np.random.default_rng(2)
    gs = [rng.normal(0, 1, 12), rng.normal(0, 1, 12), rng.normal(4, 1, 12)]
    pairs = {(p["i"], p["j"]): p for p in steel_dwass(gs)["pairs"]}
    assert pairs[(0, 1)]["significant"] is False
    assert pairs[(0, 2)]["significant"] and pairs[(1, 2)]["significant"]
    assert pairs[(0, 2)]["statistic"] < 0  # group 0 ranks lower


def test_steel_dwass_validation() -> None:
    with pytest.raises(ValueError, match="completely tied"):
        steel_dwass([np.array([1.0, 1]), np.array([1.0, 1])])
    with pytest.raises(ValueError, match="at least 2 groups"):
        steel_dwass([np.array([1.0, 2.0])])
    with pytest.raises(ValueError, match="alpha"):
        steel_dwass([np.array([1.0, 2]), np.array([3.0, 4])], alpha=2)


# ---- ANOVA effect sizes ---------------------------------------------------


def test_effect_sizes_by_hand_from_a_table() -> None:
    # SS_b = 30, df_b = 2, SS_w = 60, df_w = 27 (N = 30), SS_t = 90.
    # MS_w = 60/27 = 2.2222; eta2 = 1/3; partial = 30/90 = 1/3;
    # omega2 = (30 - 2*2.2222)/(90 + 2.2222) = 25.5556/92.2222 = 0.27711;
    # partial omega2 = 25.5556/(30 + 28*2.2222) = 0.27711 (one-way: equal);
    # f = sqrt((1/3)/(2/3)) = 0.70711.
    rows = anova_effect_sizes([
        {"source": "Between", "SS": 30.0, "df": 2},
        {"source": "Within", "SS": 60.0, "df": 27},
        {"source": "Total", "SS": 90.0, "df": 29},
    ])
    assert len(rows) == 1
    r = rows[0]
    assert r["eta_sq"] == pytest.approx(1 / 3)
    assert r["partial_eta_sq"] == pytest.approx(1 / 3)
    assert r["omega_sq"] == pytest.approx(25.5556 / 92.2222, abs=1e-4)
    assert r["partial_omega_sq"] == pytest.approx(r["omega_sq"])
    assert r["cohens_f"] == pytest.approx(math.sqrt(0.5))
    f_stat = (30 / 2) / (60 / 27)
    assert r["partial_omega_sq"] == pytest.approx(2 * (f_stat - 1) / (2 * (f_stat - 1) + 30))


def test_one_way_anova_carries_effect_sizes_without_changing_the_rest() -> None:
    rng = np.random.default_rng(4)
    gs = [rng.normal(m, 1, 10) for m in (0, 0.5, 1.5)]
    out = anova1(gs)
    (es,) = out["effectSizes"]
    assert es["eta_sq"] == pytest.approx(out["ssBetween"] / out["ssTotal"])
    ss_b, ss_w = out["ssBetween"], out["ssWithin"]
    assert es["partial_eta_sq"] == pytest.approx(ss_b / (ss_b + ss_w))
    f2 = out["ssBetween"] / out["ssWithin"]
    assert es["cohens_f"] == pytest.approx(math.sqrt(f2))
    assert out["fStat"] == pytest.approx(stats.f_oneway(*gs).statistic)


def test_two_way_tables_carry_effect_sizes() -> None:
    rng = np.random.default_rng(6)
    cells = [[list(rng.normal(a + 2 * b, 1, 4)) for b in range(2)] for a in range(3)]
    out = anova2(cells)
    by = {r["source"]: r for r in out["effect_sizes"]}
    t = {r["source"]: r for r in out["table"]}
    assert set(by) == {"A", "B", "AxB"}
    assert by["A"]["eta_sq"] == pytest.approx(t["A"]["SS"] / t["Total"]["SS"])
    ss_b = t["B"]["SS"]
    assert by["B"]["partial_eta_sq"] == pytest.approx(ss_b / (ss_b + t["Error"]["SS"]))
    # balanced Type III table gives the same effect sizes
    y = [v for row in cells for cell in row for v in cell]
    fa = [a for a in range(3) for b in range(2) for _ in range(4)]
    fb = [b for a in range(3) for b in range(2) for _ in range(4)]
    un = anova2_unbalanced(np.array(y), fa, fb)
    for e in un["effect_sizes"]:
        assert e["omega_sq"] == pytest.approx(by[e["source"]]["omega_sq"])


def test_effect_sizes_undefined_cases_are_none_not_invented() -> None:
    assert anova_effect_sizes([{"source": "A", "SS": 1.0, "df": 1}]) == []
    rows = anova_effect_sizes([
        {"source": "A", "SS": 4.0, "df": 1},
        {"source": "Error", "SS": 0.0, "df": 5},
        {"source": "Total", "SS": 4.0, "df": 6},
    ])
    assert rows[0]["eta_sq"] == 1.0 and rows[0]["cohens_f"] is None
