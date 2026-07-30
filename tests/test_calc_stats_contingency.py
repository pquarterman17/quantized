"""Categorical-association tests (calc.stats_contingency).

Reference values:

- **Fisher's 1935 "lady tasting tea" experiment** (Fisher, *The Design of
  Experiments*, 1935; reproduced in Agresti, *Categorical Data Analysis*,
  3rd ed., ch. 3): a 2x2 table with row/column margins each (4, 4), n=8.
  ``[[3, 1], [1, 3]]`` -- 3 of 4 correctly identified in each direction.
  Every value below is hand-derived from the defining formulas:

  - Expected counts under independence: row_total*col_total/n = 4*4/8 = 2
    for all four cells (so every cell is < 5 -> ``low_expected`` fires).
  - Uncorrected Pearson chi-square (``correction=False`` — the JMP / SAS
    PROC FREQ headline convention, a deliberate departure from scipy's
    Yates-corrected 2x2 default):
    chi2 = sum((O-E)^2/E) = 4 * (1^2/2) = 2.0, dof=1.
  - Fisher exact hypergeometric distribution over a in {0..4} given margins
    (4,4,4,4), n=8: P(a) = C(4,a)*C(4,4-a)/C(8,4), C(8,4)=70:
    P(0)=1/70, P(1)=16/70, P(2)=36/70, P(3)=16/70, P(4)=1/70 (sums to 1).
    One-sided (greater) p = P(3)+P(4) = 17/70.
    Two-sided p = sum of P(a) <= P(3): P(0)+P(1)+P(3)+P(4) = 34/70.
    Odds ratio = (3*3)/(1*1) = 9.

- A self-constructed, hand-verified 2x3 table (rows 60/40, cols 30/35/35,
  n=100) checks the general R x C path and Cramer's V:
  expected = row_total*col_total/n gives
  [[18, 21, 21], [12, 14, 14]]; chi2 = sum((O-E)^2/E) = 18.650793650...;
  dof=2, so p = exp(-chi2/2) exactly (chi-square df=2 CDF is 1-exp(-x/2));
  Cramer's V = sqrt(chi2/(n*(min(r,c)-1))).
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.stats_contingency import (
    chi_square_gof,
    chi_square_independence,
    fisher_exact_test,
)

_TEA_TABLE = [[3, 1], [1, 3]]


def test_chi_square_independence_tea_tasting_hand_value() -> None:
    out = chi_square_independence(_TEA_TABLE)
    assert out["expected"] == [[2.0, 2.0], [2.0, 2.0]]
    assert math.isclose(out["chi2"], 2.0, rel_tol=1e-12)
    assert out["dof"] == 1
    # p for chi2=2.0, df=1: 2*(1-Phi(sqrt(2))) via erfc identity
    expected_p = math.erfc(math.sqrt(2.0 / 2.0))
    assert math.isclose(out["p_value"], expected_p, rel_tol=1e-9)
    assert out["n"] == 8.0
    assert out["low_expected"] is True
    assert out["low_expected_count"] == 4
    assert out["shape"] == [2, 2]
    # Cramer's V = sqrt(chi2 / (n * (min(r,c)-1))) = sqrt(2/8) = 0.5
    assert math.isclose(out["cramers_v"], 0.5, rel_tol=1e-12)


def test_chi_square_independence_rxc_hand_value() -> None:
    table = [[10, 20, 30], [20, 15, 5]]
    out = chi_square_independence(table)
    assert out["expected"] == [[18.0, 21.0, 21.0], [12.0, 14.0, 14.0]]
    assert math.isclose(out["chi2"], 18.650793650793652, rel_tol=1e-12)
    assert out["dof"] == 2
    assert math.isclose(out["p_value"], math.exp(-out["chi2"] / 2.0), rel_tol=1e-9)
    assert out["low_expected"] is False
    assert out["low_expected_count"] == 0
    assert out["shape"] == [2, 3]
    expected_v = math.sqrt(out["chi2"] / (100.0 * (2 - 1)))
    assert math.isclose(out["cramers_v"], expected_v, rel_tol=1e-12)


def test_fisher_exact_tea_tasting_two_sided() -> None:
    out = fisher_exact_test(_TEA_TABLE, alternative="two-sided")
    assert math.isclose(out["odds_ratio"], 9.0, rel_tol=1e-12)
    assert math.isclose(out["p_value"], 34.0 / 70.0, rel_tol=1e-12)
    assert out["n"] == 8.0


def test_fisher_exact_tea_tasting_one_sided() -> None:
    greater = fisher_exact_test(_TEA_TABLE, alternative="greater")
    assert math.isclose(greater["p_value"], 17.0 / 70.0, rel_tol=1e-12)

    less = fisher_exact_test(_TEA_TABLE, alternative="less")
    # by symmetry of this table, less == 1 - greater's complement structure;
    # exact hand value: P(a<=3) = 1 - P(4) = 1 - 1/70 = 69/70
    assert math.isclose(less["p_value"], 69.0 / 70.0, rel_tol=1e-12)


def test_chi_square_gof_hand_value() -> None:
    # 6 categories, uniform expectation (mean=100/6): matches a hand
    # chi-square sum against scipy's own default (delegation, not reproof
    # of scipy) but N/dof are asserted structurally here.
    observed = [10.0, 20.0, 15.0, 25.0, 18.0, 12.0]
    out = chi_square_gof(observed)
    assert out["dof"] == 5
    assert out["N"] == 6
    mean = float(np.mean(observed))
    hand_chi2 = sum((o - mean) ** 2 / mean for o in observed)
    assert math.isclose(out["chi2"], hand_chi2, rel_tol=1e-9)


def test_chi_square_gof_with_explicit_expected() -> None:
    observed = [18.0, 22.0]
    expected = [20.0, 20.0]
    out = chi_square_gof(observed, expected)
    hand_chi2 = (18 - 20) ** 2 / 20 + (22 - 20) ** 2 / 20
    assert math.isclose(out["chi2"], hand_chi2, rel_tol=1e-12)
    assert out["dof"] == 1


def test_error_paths() -> None:
    with pytest.raises(ValueError, match="at least 2 rows"):
        chi_square_independence([[1, 2, 3]])
    with pytest.raises(ValueError, match="at least 2 columns"):
        chi_square_independence([[1], [2]])
    with pytest.raises(ValueError, match="rectangular"):
        chi_square_independence([[1, 2], [3, 4, 5]])
    with pytest.raises(ValueError, match="non-negative"):
        chi_square_independence([[1, -2], [3, 4]])
    with pytest.raises(ValueError, match="2x2 table"):
        fisher_exact_test([[1, 2, 3], [4, 5, 6]])
    with pytest.raises(ValueError, match="alternative"):
        fisher_exact_test(_TEA_TABLE, alternative="bigger")
    with pytest.raises(ValueError, match="at least 2 categories"):
        chi_square_gof([1.0])
    with pytest.raises(ValueError, match="same length"):
        chi_square_gof([1.0, 2.0, 3.0], [1.0, 2.0])
    with pytest.raises(ValueError, match="finite and positive"):
        chi_square_gof([1.0, 2.0], [0.0, 3.0])
