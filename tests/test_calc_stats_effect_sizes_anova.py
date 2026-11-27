"""Effect sizes of repeated-measures and Welch ANOVA against statsmodels F tests and by hand."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from statsmodels.stats.anova import AnovaRM
from statsmodels.stats.oneway import anova_oneway

from quantized.calc.stats_anova_ext import repeated_measures_anova
from quantized.calc.stats_effect_sizes import repeated_measures_effect_sizes, welch_omega_sq
from quantized.calc.stats_group_tests import welch_anova

# 8 subjects x 3 conditions
RM = np.array(
    [
        [45, 50, 55],
        [42, 42, 45],
        [36, 41, 43],
        [39, 35, 40],
        [51, 55, 59],
        [44, 49, 56],
        [42, 43, 47],
        [46, 48, 52],
    ],
    dtype=float,
)


def _long(y: np.ndarray) -> pd.DataFrame:
    n, k = y.shape
    return pd.DataFrame(
        {"s": np.repeat(np.arange(n), k), "c": np.tile(np.arange(k), n), "y": y.ravel()}
    )


def test_rm_effect_sizes_match_statsmodels_f_and_hand_sums() -> None:
    out = repeated_measures_anova(RM)["effect_sizes"]
    res = AnovaRM(_long(RM), "y", "s", within=["c"]).fit().anova_table
    f, d1, d2 = (
        float(res["F Value"].iloc[0]),
        float(res["Num DF"].iloc[0]),
        float(res["Den DF"].iloc[0]),
    )
    n_obs = RM.size
    # exact identities of the F test
    assert out["partial_eta_sq"] == pytest.approx(f * d1 / (f * d1 + d2), rel=1e-10)
    assert out["partial_omega_sq"] == pytest.approx(
        d1 * (f - 1) / (d1 * (f - 1) + n_obs), rel=1e-10
    )
    # sums of squares recomputed independently (grand/means decomposition)
    g = RM.mean()
    ss_c = RM.shape[0] * ((RM.mean(axis=0) - g) ** 2).sum()
    ss_s = RM.shape[1] * ((RM.mean(axis=1) - g) ** 2).sum()
    ss_e = ((RM - g) ** 2).sum() - ss_c - ss_s
    assert out["generalized_eta_sq"] == pytest.approx(ss_c / (ss_c + ss_s + ss_e), rel=1e-12)
    assert out["partial_eta_sq"] == pytest.approx(ss_c / (ss_c + ss_e), rel=1e-12)
    assert out["cohens_f"] == pytest.approx(np.sqrt(ss_c / ss_e), rel=1e-12)
    assert repeated_measures_anova(RM)["partial_eta_sq"] == pytest.approx(out["partial_eta_sq"])


def test_rm_effect_sizes_undefined_cases_are_none() -> None:
    out = repeated_measures_effect_sizes(4.0, 1.0, 0.0, 2, 6, 24)
    assert (
        out["partial_omega_sq"] is None and out["partial_eta_sq"] == 1.0 and out["cohens_f"] is None
    )
    assert repeated_measures_effect_sizes(0.0, 0.0, 0.0, 2, 6, 24)["partial_eta_sq"] is None


def test_rm_omega_is_negative_below_chance_and_a_hand_case() -> None:
    # F = 0.5 -> omega < 0 by the formula; 2*(0.5-1)/(2*(0.5-1)+24) = -1/23
    out = repeated_measures_effect_sizes(1.0, 5.0, 4.0, 2, 8, 24)  # MS_c=.5, MS_e=.5 -> F=1
    assert out["partial_omega_sq"] == pytest.approx(0.0, abs=1e-15)
    out = repeated_measures_effect_sizes(1.0, 5.0, 8.0, 2, 8, 24)  # MS_c=.5, MS_e=1 -> F=.5
    assert out["partial_omega_sq"] == pytest.approx(-1 / 23, rel=1e-12)


def _groups() -> list[np.ndarray]:
    rng = np.random.default_rng(7)
    return [rng.normal(10, 1, 12), rng.normal(11, 3, 15), rng.normal(13, 5, 9)]


def test_welch_omega_matches_statsmodels_welch_f() -> None:
    gs = _groups()
    ours = welch_anova(gs)
    sm = anova_oneway(gs, use_var="unequal", welch_correction=True)
    assert ours["F"] == pytest.approx(float(sm.statistic), rel=1e-10)
    assert ours["df2"] == pytest.approx(float(sm.df_denom), rel=1e-10)
    f, d1, n = float(sm.statistic), float(sm.df_num), sum(g.size for g in gs)
    expected = d1 * (f - 1) / (d1 * (f - 1) + n)
    assert ours["omega_sq"] == pytest.approx(max(0.0, expected), rel=1e-10)
    assert welch_omega_sq(f, d1, n) == pytest.approx(expected, rel=1e-12)


def test_welch_omega_close_to_classical_when_variances_are_equal() -> None:
    rng = np.random.default_rng(3)
    gs = [rng.normal(m, 2.0, 40) for m in (0.0, 1.0, 2.0)]
    ours = welch_anova(gs)["omega_sq"]
    big_n = sum(g.size for g in gs)
    grand = np.concatenate(gs).mean()
    ss_b = sum(g.size * (g.mean() - grand) ** 2 for g in gs)
    ss_w = sum(((g - g.mean()) ** 2).sum() for g in gs)
    ms_w = ss_w / (big_n - 3)
    classical = (ss_b - 2 * ms_w) / (ss_b + ss_w + ms_w)
    assert ours == pytest.approx(classical, abs=0.01)


def test_welch_omega_undefined_inputs() -> None:
    assert welch_omega_sq(float("nan"), 2.0, 30.0) is None
    assert welch_omega_sq(3.0, 0.0, 30.0) is None
    assert welch_omega_sq(0.5, 2.0, 30.0) == pytest.approx(-1 / 29)
