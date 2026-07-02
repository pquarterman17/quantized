"""Nonparametric + assumption tests (calc.stats_tests).

No MATLAB reference exists (new-capability item, ORIGIN_GAP_PLAN #25/#26),
so the exact-value cases are derived BY HAND from the defining formulas on
tie-free small samples where scipy uses exact methods:

- Mann-Whitney: fully separated samples -> U=0, exact two-sided
  p = 2 / C(n1+n2, n1).
- Wilcoxon: all-positive differences -> W = min(W+, W-) = 0, exact
  two-sided p = 2 / 2^n.
- Kruskal-Wallis: distinct ranks -> H from the rank-sum formula; for
  df=2, p = exp(-H/2) exactly.
- Friedman: identical block ordering -> chi2 from the rank-sum formula;
  df=2 -> p = exp(-chi2/2).
- Sign test: exact binomial tail sums.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.stats_tests import (
    anderson_darling,
    friedman,
    kruskal_wallis,
    ks_normal,
    ks_two_sample,
    levene,
    mann_whitney,
    shapiro_wilk,
    sign_test,
    wilcoxon_signed_rank,
)

# deterministic "normal-ish" sample: standard-normal quantiles at plotting
# positions (i-0.5)/n -- symmetric, no RNG, passes normality tests.
_NORMALISH = np.asarray(
    [
        -1.95996398,
        -1.43953147,
        -1.15034938,
        -0.93458929,
        -0.75541503,
        -0.59776013,
        -0.45376219,
        -0.31863936,
        -0.18911843,
        -0.06270678,
        0.06270678,
        0.18911843,
        0.31863936,
        0.45376219,
        0.59776013,
        0.75541503,
        0.93458929,
        1.15034938,
        1.43953147,
        1.95996398,
    ]
)


def test_mann_whitney_exact_separated() -> None:
    out = mann_whitney(np.array([1.0, 2.0, 3.0]), np.array([4.0, 5.0, 6.0]))
    assert out["U"] == 0.0
    # only 1 of C(6,3)=20 orderings is this extreme per tail
    assert math.isclose(out["p"], 2.0 / 20.0, rel_tol=1e-12)
    assert out["n1"] == 3 and out["n2"] == 3


def test_wilcoxon_exact_all_positive() -> None:
    out = wilcoxon_signed_rank(np.array([1.0, 2.0, 3.0, 4.0, 5.0]), mu=0.0)
    assert out["W"] == 0.0
    assert math.isclose(out["p"], 2.0 / 2.0**5, rel_tol=1e-12)
    assert out["n"] == 5


def test_wilcoxon_paired_matches_shifted_one_sample() -> None:
    x = np.array([2.0, 4.0, 6.0, 8.0, 10.0])
    y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    paired = wilcoxon_signed_rank(x, y)
    one_sample = wilcoxon_signed_rank(x - y, mu=0.0)
    assert paired["W"] == one_sample["W"]
    assert math.isclose(paired["p"], one_sample["p"], rel_tol=1e-12)


def test_kruskal_wallis_hand_value() -> None:
    groups = [np.array([1.0, 2.0, 3.0]), np.array([4.0, 5.0, 6.0]), np.array([7.0, 8.0, 9.0])]
    out = kruskal_wallis(groups)
    # H = 12/(N(N+1)) * sum n_i (Rbar_i - (N+1)/2)^2 = 12/90 * (27+0+27) = 7.2
    assert math.isclose(out["H"], 7.2, rel_tol=1e-12)
    assert out["df"] == 2
    assert math.isclose(out["p"], math.exp(-7.2 / 2.0), rel_tol=1e-10)


def test_friedman_hand_value() -> None:
    # 4 blocks, 3 treatments, identical ordering in every block:
    # rank sums 4, 8, 12 -> chi2 = 12/(4*3*4)*(16+64+144) - 3*4*4 = 8.0
    groups = [np.full(4, 1.0), np.full(4, 2.0), np.full(4, 3.0)]
    out = friedman(groups)
    assert math.isclose(out["chi2"], 8.0, rel_tol=1e-12)
    assert out["df"] == 2
    assert math.isclose(out["p"], math.exp(-8.0 / 2.0), rel_tol=1e-10)


def test_sign_test_exact_binomial() -> None:
    # 8 positive, 2 negative differences -> p = 2 * sum_{k<=2} C(10,k)/2^10
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, -1.0, -2.0])
    out = sign_test(x, mu=0.0)
    assert out["n_pos"] == 8 and out["n_neg"] == 2
    assert math.isclose(out["p"], 2.0 * (1 + 10 + 45) / 1024.0, rel_tol=1e-12)


def test_sign_test_one_sided() -> None:
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, -1.0, -2.0])
    out = sign_test(x, mu=0.0, alternative="greater")
    # P(X >= 8 | n=10, p=1/2) = (45 + 10 + 1)/1024
    assert math.isclose(out["p"], (45 + 10 + 1) / 1024.0, rel_tol=1e-12)


def test_shapiro_accepts_normalish_sample() -> None:
    out = shapiro_wilk(_NORMALISH)
    assert 0.0 < out["W"] <= 1.0
    assert out["p"] > 0.05
    assert out["N"] == 20


def test_anderson_structure_and_decision() -> None:
    out = anderson_darling(_NORMALISH)
    assert out["A2"] > 0.0
    assert len(out["critical_values"]) == len(out["significance_levels_pct"])
    assert out["reject_at_5pct"] is False


def test_levene_equal_and_unequal_variance() -> None:
    a = _NORMALISH
    same = levene([a, a + 5.0])  # pure location shift, equal spread
    assert same["p"] > 0.5
    diff = levene([a, a * 10.0])
    assert diff["p"] < 0.01
    assert diff["method"] == "Brown-Forsythe"


def test_ks_normal_flags_estimated_params() -> None:
    out = ks_normal(_NORMALISH)
    assert out["params_estimated"] is True
    assert 0.0 <= out["D"] <= 1.0
    assert out["p"] > 0.2  # sample built from normal quantiles

    known = ks_normal(_NORMALISH, loc=0.0, scale=1.0)
    assert known["params_estimated"] is False


def test_ks_two_sample_identical_and_disjoint() -> None:
    same = ks_two_sample(_NORMALISH, _NORMALISH)
    assert same["D"] == 0.0 and same["p"] == 1.0
    apart = ks_two_sample(_NORMALISH, _NORMALISH + 100.0)
    assert apart["D"] == 1.0 and apart["p"] < 1e-6


def test_error_paths() -> None:
    with pytest.raises(ValueError, match="at least 2 groups"):
        kruskal_wallis([np.array([1.0, 2.0])])
    with pytest.raises(ValueError, match="3 treatments"):
        friedman([np.array([1.0, 2.0]), np.array([2.0, 3.0])])
    with pytest.raises(ValueError, match="all differences are zero"):
        wilcoxon_signed_rank(np.zeros(5), mu=0.0)
    with pytest.raises(ValueError, match="no nonzero differences"):
        sign_test(np.zeros(4), mu=0.0)
    with pytest.raises(ValueError, match="alternative"):
        mann_whitney(np.array([1.0]), np.array([2.0]), alternative="bigger")
    with pytest.raises(ValueError, match="at least 3 observations"):
        shapiro_wilk(np.array([1.0, 2.0]))
    with pytest.raises(ValueError, match="same length"):
        sign_test(np.array([1.0, 2.0]), np.array([1.0]))
