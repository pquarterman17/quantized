"""GAP_AUDIT_9 G6: Welch ANOVA, post hoc, variance, TOST, tolerance, proportions.

Oracles: statsmodels (BSD), scipy, published values (NIST/SEMATECH e-Handbook,
Fisher's lady tasting tea). pingouin (GPL) is neither used nor a dependency.
"""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import pytest
from scipy import stats as sps

from quantized.calc.stats_equivalence import (
    _howe_k2,
    tolerance_interval,
    tost_one_sample,
    tost_two_sample,
)
from quantized.calc.stats_group_tests import posthoc_pairwise, variance_test, welch_anova
from quantized.calc.stats_proportion import binomial_test, fisher_2x2, two_proportions

sm = pytest.importorskip("statsmodels")

GEAR = Path(__file__).parent / "fixtures" / "nist_gear_diameter.csv"


def _gear() -> list[np.ndarray]:
    rows = [r for r in csv.reader(ln for ln in GEAR.open() if not ln.startswith("#"))][1:]
    arr = np.array(rows, dtype=float)
    return [arr[arr[:, 1] == b, 0] for b in range(1, 11)]


def _groups(seed: int = 3) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    return [
        rng.normal(10.0, 1.0, 12),
        rng.normal(11.0, 3.0, 9),
        rng.normal(10.5, 0.5, 15),
        rng.normal(13.0, 2.0, 7),
    ]


# ---- Welch ANOVA -----------------------------------------------------------


def test_welch_anova_matches_statsmodels() -> None:
    from statsmodels.stats.oneway import anova_oneway

    g = _groups()
    ref = anova_oneway(g, use_var="unequal", welch_correction=True)
    out = welch_anova(g)
    assert out["F"] == pytest.approx(ref.statistic, rel=1e-10)
    assert out["p"] == pytest.approx(ref.pvalue, rel=1e-8)
    assert (out["df1"], out["df2"]) == (
        pytest.approx(ref.df[0]),
        pytest.approx(ref.df[1], rel=1e-10),
    )
    assert out["N"] == 43 and out["significant"] == (out["p"] < 0.05)


def test_welch_anova_gear_batches() -> None:
    from statsmodels.stats.oneway import anova_oneway

    g = _gear()
    out = welch_anova(g)
    ref = anova_oneway(g, use_var="unequal")
    assert out["F"] == pytest.approx(ref.statistic, rel=1e-10)
    assert out["classical_F"] == pytest.approx(sps.f_oneway(*g).statistic)


def test_welch_anova_refuses_zero_variance_and_single_group() -> None:
    with pytest.raises(ValueError, match="zero variance"):
        welch_anova([np.array([1.0, 1.0, 1.0]), np.array([1.0, 2.0, 3.0])])
    with pytest.raises(ValueError, match="at least 2 groups"):
        welch_anova([np.array([1.0, 2.0])])
    with pytest.raises(ValueError, match="at least 2"):
        welch_anova([np.array([1.0]), np.array([1.0, 2.0])])


# ---- post hoc --------------------------------------------------------------


def test_tukey_matches_statsmodels() -> None:
    from statsmodels.stats.multicomp import pairwise_tukeyhsd

    g = _groups()
    y = np.concatenate(g)
    lab = np.repeat(np.arange(4), [x.size for x in g])
    ref = pairwise_tukeyhsd(y, lab, alpha=0.05)
    out = posthoc_pairwise(g, method="tukey")["pairs"]
    np.testing.assert_allclose([r["p"] for r in out], ref.pvalues, rtol=1e-6, atol=1e-10)
    np.testing.assert_allclose([-r["diff"] for r in out], ref.meandiffs, atol=1e-12)


def test_games_howell_matches_independent_welch_studentized_range() -> None:
    g = _groups()
    out = posthoc_pairwise(g, method="games-howell")["pairs"]
    for r in out:
        t = sps.ttest_ind(g[r["i"]], g[r["j"]], equal_var=False)
        df = t.df  # type: ignore[attr-defined]
        p = sps.studentized_range.sf(abs(t.statistic) * np.sqrt(2.0), 4, df)
        assert r["p"] == pytest.approx(p, rel=1e-9)
        assert r["df"] == pytest.approx(df, rel=1e-10)
        assert r["ciLow"] < r["diff"] < r["ciHigh"]
        assert r["significant"] == (r["p"] < 0.05)
        # the CI and p must agree: a CI excluding 0 <=> p < alpha
        assert (r["ciLow"] > 0 or r["ciHigh"] < 0) == r["significant"]


def test_scheffe_and_lsd_match_ols_contrasts() -> None:
    import pandas as pd
    import statsmodels.formula.api as smf

    g = _groups()
    df = pd.DataFrame({"y": np.concatenate(g), "g": np.repeat(list("abcd"), [x.size for x in g])})
    model = smf.ols("y ~ 0 + C(g)", df).fit()
    k = 4
    for method in ("lsd", "scheffe"):
        out = posthoc_pairwise(g, method=method)["pairs"]
        for r in out:
            c = np.zeros(k)
            c[r["i"]], c[r["j"]] = 1.0, -1.0
            tt = model.t_test(c)
            if method == "lsd":
                assert r["p"] == pytest.approx(float(tt.pvalue), rel=1e-9)
                ci = tt.conf_int(alpha=0.05)[0]
            else:
                f = float(tt.tvalue[0][0]) ** 2 / (k - 1)
                assert r["p"] == pytest.approx(float(sps.f.sf(f, k - 1, model.df_resid)), rel=1e-9)
                crit = np.sqrt((k - 1) * sps.f.isf(0.05, k - 1, model.df_resid))
                ci = (r["diff"] - crit * r["se"], r["diff"] + crit * r["se"])
            assert r["ciLow"] == pytest.approx(ci[0], rel=1e-8)
            assert r["ciHigh"] == pytest.approx(ci[1], rel=1e-8)


def test_posthoc_conservatism_order() -> None:
    """LSD (no correction) <= Tukey <= Scheffe in p for every pair (textbook ordering)."""
    g = _groups()
    lsd, tuk, sch = (posthoc_pairwise(g, method=m)["pairs"] for m in ("lsd", "tukey", "scheffe"))
    for a, b, c in zip(lsd, tuk, sch, strict=True):
        assert a["p"] <= b["p"] + 1e-12 and b["p"] <= c["p"] + 1e-12
    assert posthoc_pairwise(g, method="lsd")["adjusted"] is False


def test_posthoc_rejects_bad_method_and_alpha() -> None:
    with pytest.raises(ValueError, match="method"):
        posthoc_pairwise(_groups(), method="bonferroni")
    with pytest.raises(ValueError, match="alpha"):
        posthoc_pairwise(_groups(), alpha=1.5)


# ---- variance tests --------------------------------------------------------


def test_bartlett_nist_gear_example() -> None:
    """NIST/SEMATECH 1.3.5.7: GEAR.DAT, T = 20.78580, k-1 = 9, 5% critical value 16.919."""
    out = variance_test(_gear(), method="bartlett")
    assert out["statistic"] == pytest.approx(
        20.78580, abs=1e-4
    )  # NIST prints 5 decimals; measured diff 7e-5
    assert out["df1"] == 9.0
    assert sps.chi2.isf(0.05, 9) == pytest.approx(16.919, abs=5e-4)
    assert out["significant"] is True
    assert out["p"] == pytest.approx(0.01363586, abs=1e-7)


def test_levene_and_brown_forsythe_match_scipy() -> None:
    g = _gear()
    lev = variance_test(g, method="levene")
    bf = variance_test(g, method="brown-forsythe")
    assert lev["statistic"] == pytest.approx(sps.levene(*g, center="mean").statistic, rel=1e-12)
    assert bf["statistic"] == pytest.approx(sps.levene(*g, center="median").statistic, rel=1e-12)
    assert (lev["df1"], lev["df2"]) == (9.0, 90.0)
    assert bf["method"] == "Brown-Forsythe" and lev["method"] == "Levene"


def test_f_test_two_variances() -> None:
    rng = np.random.default_rng(11)
    a, b = rng.normal(0, 2.0, 21), rng.normal(0, 1.0, 16)
    out = variance_test([a, b], method="f-test")
    f = np.var(a, ddof=1) / np.var(b, ddof=1)
    assert out["statistic"] == pytest.approx(f)
    assert (out["df1"], out["df2"]) == (20.0, 15.0)
    assert out["p"] == pytest.approx(2 * min(sps.f.cdf(f, 20, 15), sps.f.sf(f, 20, 15)))
    # the ratio CI is the (1 - alpha) interval for sigma1^2/sigma2^2 and contains the point estimate
    assert out["ratio_ci_low"] < f < out["ratio_ci_high"]
    assert out["ratio_ci_low"] == pytest.approx(f / sps.f.isf(0.025, 20, 15))
    swapped = variance_test([b, a], method="f-test")
    assert swapped["p"] == pytest.approx(out["p"], rel=1e-12)
    # consistency with the CI: p < alpha <=> the CI excludes 1
    assert out["significant"] == (not out["ratio_ci_low"] <= 1.0 <= out["ratio_ci_high"])


def test_f_test_requires_two_groups() -> None:
    with pytest.raises(ValueError, match="exactly two"):
        variance_test(_groups(), method="f-test")


# ---- TOST ------------------------------------------------------------------


@pytest.mark.parametrize("design,usevar", [("welch", "unequal"), ("pooled", "pooled")])
def test_tost_two_sample_matches_statsmodels(design: str, usevar: str) -> None:
    from statsmodels.stats.weightstats import ttost_ind

    rng = np.random.default_rng(2)
    x, y = rng.normal(5.0, 1.0, 30), rng.normal(5.2, 1.5, 25)
    out = tost_two_sample(x, y, design=design, margin=1.0)
    p, (t1, p1, d1), (t2, p2, d2) = ttost_ind(x, y, -1.0, 1.0, usevar=usevar)
    assert out["p"] == pytest.approx(p, rel=1e-10)
    assert out["t_lower"] == pytest.approx(t1, rel=1e-10) and out["p_lower"] == pytest.approx(
        p1, rel=1e-10
    )
    assert out["t_upper"] == pytest.approx(t2, rel=1e-10) and out["p_upper"] == pytest.approx(
        p2, rel=1e-10
    )
    assert out["df"] == pytest.approx(d1, rel=1e-10)
    assert out["equivalent"] == (p < 0.05)


def test_tost_paired_and_one_sample_match_statsmodels() -> None:
    from statsmodels.stats.weightstats import ttost_paired

    rng = np.random.default_rng(4)
    x = rng.normal(1.0, 1.0, 20)
    y = x + rng.normal(0.1, 0.4, 20)
    out = tost_two_sample(x, y, design="paired", low=-0.5, high=0.5)
    ref = ttost_paired(x, y, -0.5, 0.5)
    assert out["p"] == pytest.approx(ref[0], rel=1e-10)
    one = tost_one_sample(x, mu0=1.0, margin=0.6)
    ref1 = ttost_paired(x, np.full(x.size, 1.0), -0.6, 0.6)
    assert one["p"] == pytest.approx(ref1[0], rel=1e-10)
    assert one["effect_size"] == pytest.approx((np.mean(x) - 1.0) / np.std(x, ddof=1))


def test_tost_ci_agrees_with_decision_and_flips_with_margin() -> None:
    rng = np.random.default_rng(8)
    x = rng.normal(0.05, 1.0, 60)
    tight = tost_one_sample(x, margin=0.05)
    wide = tost_one_sample(x, margin=1.0)
    assert tight["equivalent"] is False and wide["equivalent"] is True
    for o in (tight, wide):
        inside = o["low"] <= o["ci_low"] and o["ci_high"] <= o["high"]
        assert inside == o["equivalent"]
        assert o["ci_level"] == pytest.approx(0.90)


def test_tost_refuses_missing_or_bad_margin() -> None:
    x = np.arange(10.0)
    with pytest.raises(ValueError, match="margin is required"):
        tost_one_sample(x)
    with pytest.raises(ValueError, match="positive"):
        tost_one_sample(x, margin=-1.0)
    with pytest.raises(ValueError, match="below the upper"):
        tost_one_sample(x, low=1.0, high=0.0)
    with pytest.raises(ValueError, match="not both"):
        tost_one_sample(x, margin=1.0, low=-1.0, high=1.0)
    with pytest.raises(ValueError, match="alpha"):
        tost_one_sample(x, margin=1.0, alpha=0.6)
    with pytest.raises(ValueError, match="equal-length"):
        tost_two_sample(x, x[:5], design="paired", margin=1.0)
    with pytest.raises(ValueError, match="standard error is zero"):
        tost_one_sample(np.ones(5), margin=1.0)


# ---- tolerance intervals ---------------------------------------------------


def test_tolerance_factors_nist_7_2_6_3() -> None:
    """NIST/SEMATECH 7.2.6.3, N = 43, p = 0.90, confidence 0.99: Howe k2 = 2.217,
    noncentral-t one-sided k1 = 1.8740."""
    assert _howe_k2(43, 0.90, 0.99) == pytest.approx(2.217, abs=5e-4)
    x = np.random.default_rng(0).normal(size=43)
    one = tolerance_interval(x, coverage=0.90, confidence=0.99, sides="upper")
    assert one["k"] == pytest.approx(1.8740, abs=5e-4)
    assert one["upper"] == pytest.approx(one["mean"] + one["k"] * one["sd"])
    assert one["lower"] is None
    low = tolerance_interval(x, coverage=0.90, confidence=0.99, sides="lower")
    assert (
        low["lower"] == pytest.approx(low["mean"] - low["k"] * low["sd"]) and low["upper"] is None
    )


def test_exact_two_sided_factor_is_close_to_howe_and_hits_confidence_by_simulation() -> None:
    x = np.random.default_rng(0).normal(size=10)
    ti = tolerance_interval(x, coverage=0.95, confidence=0.95)
    assert ti["k"] == pytest.approx(ti["k_howe"], rel=0.01)
    rng = np.random.default_rng(5)
    s = rng.normal(size=(400_000, 10))
    m, sd = s.mean(axis=1), s.std(axis=1, ddof=1)
    cov = sps.norm.cdf(m + ti["k"] * sd) - sps.norm.cdf(m - ti["k"] * sd)
    assert float(np.mean(cov >= 0.95)) == pytest.approx(0.95, abs=0.003)


def test_one_sided_factor_hits_confidence_by_simulation() -> None:
    x = np.random.default_rng(0).normal(size=12)
    k = tolerance_interval(x, coverage=0.9, confidence=0.95, sides="upper")["k"]
    s = np.random.default_rng(6).normal(size=(400_000, 12))
    cov = sps.norm.cdf(s.mean(axis=1) + k * s.std(axis=1, ddof=1))
    assert float(np.mean(cov >= 0.9)) == pytest.approx(0.95, abs=0.003)


def test_tolerance_interval_refusals() -> None:
    with pytest.raises(ValueError, match="sides"):
        tolerance_interval(np.arange(10.0), sides="both")
    with pytest.raises(ValueError, match="between 0 and 1"):
        tolerance_interval(np.arange(10.0), coverage=1.0)
    with pytest.raises(ValueError, match="at least 3"):
        tolerance_interval(np.array([1.0, 2.0]))
    with pytest.raises(ValueError, match="zero variance"):
        tolerance_interval(np.ones(8))


# ---- proportions -----------------------------------------------------------


def test_binomial_exact_matches_scipy_and_clopper_pearson() -> None:
    out = binomial_test(7, 20, p0=0.5)
    ref = sps.binomtest(7, 20, 0.5)
    assert out["p"] == pytest.approx(ref.pvalue, rel=1e-12)
    ci = ref.proportion_ci(method="exact")
    assert (out["ci_low"], out["ci_high"]) == (pytest.approx(ci.low), pytest.approx(ci.high))
    # hand value: 2 * P(X <= 7 | n=20, p=.5) = 2 * 0.131588 = 0.263176
    assert out["p"] == pytest.approx(0.2631759644, abs=1e-9)
    assert out["effect_size"] == pytest.approx(
        2 * np.arcsin(np.sqrt(0.35)) - 2 * np.arcsin(np.sqrt(0.5))
    )
    assert binomial_test(7, 20, alternative="less")["p"] == pytest.approx(0.131587982, abs=1e-8)


def test_binomial_normal_matches_statsmodels() -> None:
    from statsmodels.stats.proportion import proportion_confint, proportions_ztest

    out = binomial_test(62, 100, p0=0.5, method="normal")
    z, p = proportions_ztest(62, 100, 0.5, prop_var=0.5)
    assert out["statistic"] == pytest.approx(z, rel=1e-12) and out["p"] == pytest.approx(
        p, rel=1e-12
    )
    lo, hi = proportion_confint(62, 100, alpha=0.05, method="wilson")
    assert (out["ci_low"], out["ci_high"]) == (
        pytest.approx(lo, rel=1e-10),
        pytest.approx(hi, rel=1e-10),
    )
    with pytest.raises(ValueError, match="at least 5"):
        binomial_test(1, 10, p0=0.1, method="normal")


def test_two_proportions_matches_statsmodels() -> None:
    from statsmodels.stats.proportion import confint_proportions_2indep, proportions_ztest

    out = two_proportions(30, 100, 45, 100)
    z, p = proportions_ztest([30, 45], [100, 100])
    assert out["statistic"] == pytest.approx(z, rel=1e-12) and out["p"] == pytest.approx(
        p, rel=1e-12
    )
    ci = confint_proportions_2indep(30, 100, 45, 100, method="newcomb", compare="diff")
    assert out["ci_low"] == pytest.approx(ci[0], abs=1e-9) and out["ci_high"] == pytest.approx(
        ci[1], abs=1e-9
    )
    assert out["risk_ratio"] == pytest.approx(0.3 / 0.45) and out["odds_ratio"] == pytest.approx(
        (30 * 55) / (45 * 70)
    )


def test_two_proportions_refusals() -> None:
    with pytest.raises(ValueError, match="below 5"):
        two_proportions(1, 10, 3, 10)
    with pytest.raises(ValueError, match="cannot exceed"):
        two_proportions(11, 10, 3, 10)
    with pytest.raises(ValueError, match="whole number"):
        two_proportions(2.5, 10, 3, 10)
    with pytest.raises(ValueError, match="every observation"):
        two_proportions(10, 10, 10, 10)


def test_fisher_lady_tasting_tea() -> None:
    """Fisher (1935) / Agresti: [[3,1],[1,3]]: sample OR 9, two-sided p = 34/70 = 0.4857,
    one-sided (greater) p = 17/70 = 0.2429, conditional-MLE OR = 6.408309."""
    out = fisher_2x2(3, 4, 1, 4)
    assert out["p"] == pytest.approx(34 / 70, abs=1e-12)
    assert out["sample_odds_ratio"] == pytest.approx(9.0)
    assert out["odds_ratio"] == pytest.approx(
        6.408309, abs=5e-5
    )  # R value; scipy root-finder differs by 1e-5
    assert fisher_2x2(3, 4, 1, 4, alternative="greater")["p"] == pytest.approx(17 / 70, abs=1e-12)
    assert out["ci_low"] < out["odds_ratio"] < out["ci_high"]


def test_fisher_zero_cell_and_refusal() -> None:
    out = fisher_2x2(5, 5, 0, 5)
    assert out["sample_odds_ratio"] is None and out["p"] < 0.05
    with pytest.raises(ValueError, match="all zero"):
        fisher_2x2(0, 5, 0, 5)
