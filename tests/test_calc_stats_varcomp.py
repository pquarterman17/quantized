"""Nested ANOVA + variance components (calc.stats_varcomp).

Oracle: a small, fully hand-constructed balanced 2-level nested design
(a=3 factor-A levels x b=2 B-subgroups per A x n=3 replicates per cell,
N=18) -- chosen because the network was not reachable from this
environment to pull the exact digit-for-digit Montgomery/Sokal & Rohlf
published data table (see ``calc/stats_varcomp.py``'s module docstring).
The SS/df/MS/F/sigma^2 values below are re-derived from the published
*formulas* (Montgomery, Design and Analysis of Experiments, ch. 14;
Sokal & Rohlf, Biometry, ch. 10), by hand, so every number here is
auditable against that method rather than trusted from a black box.

Data (level i, subgroup j -> 3 replicates), arithmetic progressions with
step 2 so every cell mean/SS is exact in floating point:

    A=0 B=0: [2,4,6]    mean=4     A=0 B=1: [4,6,8]    mean=6
    A=1 B=0: [6,8,10]   mean=8     A=1 B=1: [8,10,12]  mean=10
    A=2 B=0: [10,12,14] mean=12    A=2 B=1: [12,14,16] mean=14

Every cell has the same within-cell deviations (-2,0,+2) from its mean,
so SS_within(cell) = 4+0+4 = 8 for all 6 cells -> SS_Error = 48,
df_Error = N - sum(b_i) = 18-6 = 12, MS_Error = 4.

A-level means (equal cell n so this is just the average of the 2 cell
means, and also the mean of all 6 raw obs in that level): 5, 9, 13.
Grand mean = 9 (N_i equal, so simple average of the 3 A-means).
SS_A = n*b*sum((Abar_i-grand)^2) = 3*2*[16+0+16] = 6*32 = 192, df_A=2,
MS_A = 96.
SS_B(A) = n*sum_ij (cellmean_ij - Abar_i)^2
        = 3*[(4-5)^2+(6-5)^2 + (8-9)^2+(10-9)^2 + (12-13)^2+(14-13)^2]
        = 3*[1+1+1+1+1+1] = 18, df_B(A) = 3*(2-1) = 3, MS_B(A) = 6.

Identity check: SS_A+SS_B(A)+SS_Error = 192+18+48 = 258 = SS_Total
(independently verified below via direct sum((x-9)^2) over all 18 obs:
level0 residuals^2 sum to 118, level1 to 22, level2 to 118 -> 258).

F_A = MS_A/MS_B(A) = 96/6 = 16.0, df=(2,3).
F_B(A) = MS_B(A)/MS_Error = 6/4 = 1.5, df=(3,12).
p-values cross-checked independently against ``scipy.stats.f.sf`` below
(module under test uses its own ``_f_cdf`` incomplete-beta implementation
-- an independent oracle catches a wiring bug either one could share).

Balanced EMS variance components (n=3 reps/cell, b=2 subgroups/A):
    sigma2_error = MS_Error = 4
    sigma2_B(A)  = (MS_B(A) - MS_Error)/n = (6-4)/3 = 2/3
    sigma2_A     = (MS_A - MS_B(A))/(n*b) = (96-6)/6 = 15
    total = 4 + 2/3 + 15 = 19.66666...
    pct_error = 4/19.6667*100 = 20.3390%, pct_B = 3.3898%, pct_A = 76.2712%
n1 (coefficient of sigma_B^2 in E[MS_B(A)]) = n = 3 exactly (balanced).
n2 (coefficient of sigma_A^2 in E[MS_A])    = n*b = 6 exactly (balanced).
"""

from __future__ import annotations

import math

import pytest
from scipy import stats as sps

from quantized.calc.stats_varcomp import (
    nested_anova,
    variability_summary,
    variance_components_nested,
)

_BALANCED = [
    [[2.0, 4.0, 6.0], [4.0, 6.0, 8.0]],
    [[6.0, 8.0, 10.0], [8.0, 10.0, 12.0]],
    [[10.0, 12.0, 14.0], [12.0, 14.0, 16.0]],
]


def test_nested_anova_hand_derived_balanced_table() -> None:
    out = nested_anova(_BALANCED)
    rows = {r["source"]: r for r in out["table"]}

    assert math.isclose(rows["A"]["SS"], 192.0, rel_tol=1e-12)
    assert math.isclose(rows["B(A)"]["SS"], 18.0, rel_tol=1e-12)
    assert math.isclose(rows["Error"]["SS"], 48.0, rel_tol=1e-12)
    assert math.isclose(rows["Total"]["SS"], 258.0, rel_tol=1e-12)
    # exact SS decomposition identity, independent of the formulas used above
    assert math.isclose(
        rows["A"]["SS"] + rows["B(A)"]["SS"] + rows["Error"]["SS"],
        rows["Total"]["SS"],
        rel_tol=1e-12,
    )

    assert (rows["A"]["df"], rows["B(A)"]["df"], rows["Error"]["df"], rows["Total"]["df"]) == (
        2, 3, 12, 17,
    )

    assert math.isclose(rows["A"]["MS"], 96.0, rel_tol=1e-12)
    assert math.isclose(rows["B(A)"]["MS"], 6.0, rel_tol=1e-12)
    assert math.isclose(rows["Error"]["MS"], 4.0, rel_tol=1e-12)

    assert math.isclose(rows["A"]["F"], 16.0, rel_tol=1e-12)
    assert math.isclose(rows["B(A)"]["F"], 1.5, rel_tol=1e-12)

    # independent oracle: scipy's own F-survival function
    p_a_expected = float(sps.f.sf(16.0, 2, 3))
    p_b_expected = float(sps.f.sf(1.5, 3, 12))
    assert math.isclose(rows["A"]["p"], p_a_expected, rel_tol=1e-9)
    assert math.isclose(rows["B(A)"]["p"], p_b_expected, rel_tol=1e-9)

    assert out["grand_mean"] == 9.0
    assert out["a_levels"] == 3
    assert out["b_per_a"] == [2, 2, 2]
    assert out["n_total"] == 18
    assert out["balanced"] is True
    assert out["a_tested_against"] == "B(A)"
    assert out["b_within_a_estimable"] is True
    assert out["error_estimable"] is True


def test_variance_components_balanced_matches_ems_hand_solve() -> None:
    out = variance_components_nested(_BALANCED)
    assert math.isclose(out["sigma2_error"], 4.0, rel_tol=1e-12)
    assert math.isclose(out["sigma2_B_within_A"], 2.0 / 3.0, rel_tol=1e-12)
    assert math.isclose(out["sigma2_A"], 15.0, rel_tol=1e-12)
    assert math.isclose(out["n1_coefficient"], 3.0, rel_tol=1e-12)
    assert math.isclose(out["n2_coefficient"], 6.0, rel_tol=1e-12)

    total = 4.0 + 2.0 / 3.0 + 15.0
    assert math.isclose(out["pct_error"], 4.0 / total * 100.0, rel_tol=1e-9)
    assert math.isclose(out["pct_B_within_A"], (2.0 / 3.0) / total * 100.0, rel_tol=1e-9)
    assert math.isclose(out["pct_A"], 15.0 / total * 100.0, rel_tol=1e-9)
    pct_sum = out["pct_A"] + out["pct_B_within_A"] + out["pct_error"]
    assert math.isclose(pct_sum, 100.0, rel_tol=1e-9)

    assert out["clamped"] == {"A": False, "B_within_A": False, "error": False}
    assert out["balanced"] is True
    assert "exact closed form" in out["method"]


def test_variance_components_clamps_negative_estimate() -> None:
    # Both B-subgroups within each A level are constructed with EXACTLY the
    # same cell mean (2 and 12 respectively) but different within-cell
    # spread -- this forces SS_B(A) = 0 exactly (no between-batch signal)
    # while MS_Error stays positive from the replicate noise, so
    # MS_B(A) - MS_Error < 0 deterministically (no RNG needed).
    #   A=0 B=0: [0,2,4] mean=2, SS=8   A=0 B=1: [-1,2,5] mean=2, SS=18
    #   A=1 B=0: [10,12,14] mean=12, SS=8   A=1 B=1: [9,12,15] mean=12, SS=18
    # SS_B(A) = 3*[(2-2)^2+(2-2)^2+(12-12)^2+(12-12)^2] = 0, df_B(A)=2, MS_B(A)=0
    # SS_Error = 8+18+8+18 = 52, df_Error = 12-4 = 8, MS_Error = 6.5
    # n1 = n = 3 (balanced) -> sigma2_B(A)_raw = (0-6.5)/3 = -2.1666...
    # A-means: 2 and 12, grand=7 (equal N_i) -> SS_A = 3*2*[25+25] = 300,
    # df_A=1, MS_A=300 -> sigma2_A_raw = (300-0)/(3*2) = 50 (no clamp)
    groups = [
        [[0.0, 2.0, 4.0], [-1.0, 2.0, 5.0]],
        [[10.0, 12.0, 14.0], [9.0, 12.0, 15.0]],
    ]
    out = variance_components_nested(groups)
    assert math.isclose(out["sigma2_B_within_A_raw"], -6.5 / 3.0, rel_tol=1e-12)
    assert out["sigma2_B_within_A"] == 0.0
    assert out["clamped"]["B_within_A"] is True
    assert out["clamped"]["A"] is False
    assert out["clamped"]["error"] is False
    assert math.isclose(out["sigma2_A"], 50.0, rel_tol=1e-12)
    assert math.isclose(out["sigma2_error"], 6.5, rel_tol=1e-12)
    # clamped values are always non-negative regardless of which fired
    assert out["sigma2_A"] >= 0.0
    assert out["sigma2_B_within_A"] >= 0.0
    assert out["sigma2_error"] >= 0.0


def test_variability_summary_balanced() -> None:
    out = variability_summary(_BALANCED)
    assert out["grand_mean"] == 9.0
    assert out["grand_n"] == 18
    assert out["a_levels"] == 3
    assert len(out["cells"]) == 6
    means = sorted(c["mean"] for c in out["cells"])
    assert means == [4.0, 6.0, 8.0, 10.0, 12.0, 14.0]
    # every cell is an arithmetic progression with step 2 -> sample sd
    # (ddof=1) of [-2,0,2] about the mean is sqrt(8/2) = 2 for every cell
    for c in out["cells"]:
        assert c["n"] == 3
        assert math.isclose(c["sd"], 2.0, rel_tol=1e-12)
    a_means = {row["a_index"]: row["mean"] for row in out["a_groups"]}
    assert a_means == {0: 5.0, 1: 9.0, 2: 13.0}
    assert all(row["n"] == 6 for row in out["a_groups"])
    assert out["balanced"] is True


def test_nested_anova_unbalanced_identity_holds() -> None:
    # Unequal B-subgroups per A (2 vs 3) and unequal replicates per cell.
    unbalanced = [
        [[1.0, 2.0, 3.0], [4.0, 5.0]],
        [[6.0], [7.0, 8.0, 9.0, 10.0], [11.0, 12.0]],
    ]
    out = nested_anova(unbalanced)
    rows = {r["source"]: r for r in out["table"]}
    assert math.isclose(
        rows["A"]["SS"] + rows["B(A)"]["SS"] + rows["Error"]["SS"],
        rows["Total"]["SS"],
        rel_tol=1e-9,
    )
    assert out["balanced"] is False
    assert out["b_per_a"] == [2, 3]
    assert out["n_per_cell"] == [[3, 2], [1, 4, 2]]
    assert out["n_total"] == 12


def test_nested_anova_single_subgroup_tests_a_against_error() -> None:
    # Every A level has exactly one B-subgroup -> B(A) not estimable;
    # A must fall back to being tested against Error directly.
    groups = [[[1.0, 2.0, 3.0]], [[10.0, 11.0, 12.0]], [[4.0, 5.0, 6.0]]]
    out = nested_anova(groups)
    rows = {r["source"]: r for r in out["table"]}
    assert rows["B(A)"]["df"] == 0
    assert rows["B(A)"]["SS"] == 0.0
    assert out["b_within_a_estimable"] is False
    assert out["a_tested_against"] == "Error"
    assert rows["A"]["F"] is not None
    # F_A must have been computed against Error's df (=6), not B(A)'s (=0)
    ms_a = rows["A"]["MS"]
    ms_e = rows["Error"]["MS"]
    assert math.isclose(rows["A"]["F"], ms_a / ms_e, rel_tol=1e-12)


def test_variance_components_rejects_non_estimable_b() -> None:
    groups = [[[1.0, 2.0]], [[3.0, 4.0]]]
    with pytest.raises(ValueError, match="B-subgroups"):
        variance_components_nested(groups)


def test_variance_components_rejects_no_replication() -> None:
    groups = [[[1.0], [2.0]], [[3.0], [4.0]]]
    with pytest.raises(ValueError, match="replicates"):
        variance_components_nested(groups)


def test_nested_anova_rejects_single_a_level() -> None:
    with pytest.raises(ValueError, match="factor A"):
        nested_anova([[[1.0, 2.0], [3.0, 4.0]]])


def test_prepare_rejects_empty_cell_after_dropping_non_finite() -> None:
    groups = [[[float("nan"), float("inf")], [1.0]], [[2.0, 3.0], [4.0, 5.0]]]
    with pytest.raises(ValueError, match="no finite observations"):
        nested_anova(groups)


def test_prepare_drops_non_finite_and_keeps_rest() -> None:
    groups = [
        [[1.0, 2.0, float("nan"), 3.0], [4.0, 5.0, 6.0]],
        [[7.0, 8.0, 9.0], [10.0, 11.0, float("inf"), 12.0]],
    ]
    out = nested_anova(groups)
    assert out["n_per_cell"] == [[3, 3], [3, 3]]
    assert out["n_total"] == 12
