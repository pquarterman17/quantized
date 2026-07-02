"""Two-way ANOVA + post-hoc (calc.stats_anova2) and the test chooser.

Oracle for anova2: the classic Montgomery battery-life 3x3(n=4) example
(Design and Analysis of Experiments, ch. 5) with its published ANOVA table:
SS_material=10683.72, SS_temp=39118.72, SS_int=9613.78, SS_E=18230.75,
F=7.91/28.97/3.56, p=0.0020/<1e-4/0.0186.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.stats_anova2 import anova2, dunnett_test, tukey_hsd
from quantized.calc.stats_tests import recommend_test

# Montgomery battery-life data: materials (A) x temperatures (B), n=4
_BATTERY = [
    [[130, 155, 74, 180], [34, 40, 80, 75], [20, 70, 82, 58]],
    [[150, 188, 159, 126], [136, 122, 106, 115], [25, 70, 58, 45]],
    [[138, 110, 168, 160], [174, 120, 150, 139], [96, 104, 82, 60]],
]

_NORMALISH = np.asarray(
    [-1.95996398, -1.43953147, -1.15034938, -0.93458929, -0.75541503,
     -0.59776013, -0.45376219, -0.31863936, -0.18911843, -0.06270678,
     0.06270678, 0.18911843, 0.31863936, 0.45376219, 0.59776013,
     0.75541503, 0.93458929, 1.15034938, 1.43953147, 1.95996398]
)


def test_anova2_matches_montgomery_table() -> None:
    out = anova2(_BATTERY)
    rows = {r["source"]: r for r in out["table"]}
    assert math.isclose(rows["A"]["SS"], 10683.72, abs_tol=0.05)
    assert math.isclose(rows["B"]["SS"], 39118.72, abs_tol=0.05)
    assert math.isclose(rows["AxB"]["SS"], 9613.78, abs_tol=0.05)
    assert math.isclose(rows["Error"]["SS"], 18230.75, abs_tol=0.05)
    dfs = (rows["A"]["df"], rows["B"]["df"], rows["AxB"]["df"], rows["Error"]["df"])
    assert dfs == (2, 2, 4, 27)
    assert math.isclose(rows["A"]["F"], 7.91, abs_tol=0.01)
    assert math.isclose(rows["B"]["F"], 28.97, abs_tol=0.01)
    assert math.isclose(rows["AxB"]["F"], 3.56, abs_tol=0.01)
    assert math.isclose(rows["A"]["p"], 0.0020, abs_tol=0.0002)
    assert rows["B"]["p"] < 1e-4
    assert math.isclose(rows["AxB"]["p"], 0.0186, abs_tol=0.0005)


def test_anova2_n1_drops_interaction() -> None:
    cells = [[[1.0], [2.0]], [[3.0], [5.0]]]
    out = anova2(cells)
    sources = [r["source"] for r in out["table"]]
    assert "AxB" not in sources
    assert out["interaction_estimable"] is False


def test_anova2_rejects_unbalanced() -> None:
    bad = [[[1.0, 2.0], [3.0]], [[4.0, 5.0], [6.0, 7.0]]]
    with pytest.raises(ValueError, match="balanced"):
        anova2(bad)


def test_tukey_separated_and_identical_groups() -> None:
    a, b, c = _NORMALISH, _NORMALISH + 10.0, _NORMALISH + 0.001
    out = tukey_hsd([a, b, c])
    by_pair = {(p["i"], p["j"]): p for p in out["pairs"]}
    assert by_pair[(0, 1)]["p"] < 1e-6 and by_pair[(0, 1)]["significant"]
    assert by_pair[(0, 2)]["p"] > 0.9 and not by_pair[(0, 2)]["significant"]
    assert len(out["pairs"]) == 3
    # CI must bracket the observed difference
    p01 = by_pair[(0, 1)]
    assert p01["ciLow"] <= p01["diff"] <= p01["ciHigh"]


def test_dunnett_vs_control() -> None:
    ctrl = _NORMALISH
    out = dunnett_test([ctrl, _NORMALISH + 5.0, _NORMALISH + 0.001], control=0)
    rows = {r["group"]: r for r in out["comparisons"]}
    assert rows[1]["p"] < 1e-6 and rows[1]["significant"]
    assert rows[2]["p"] > 0.9 and not rows[2]["significant"]


def test_recommend_parametric_path() -> None:
    out = recommend_test([_NORMALISH, _NORMALISH + 0.3, _NORMALISH - 0.2])
    assert out["recommendation"].startswith("one-way ANOVA")
    assert out["parametric"] is True
    assert out["endpoint"] == "/api/stats/anova"


def test_recommend_nonparametric_on_skewed_groups() -> None:
    skew = np.exp(1.5 * _NORMALISH)  # strongly right-skewed
    out = recommend_test([skew, skew * 2.0, skew * 0.5])
    assert out["recommendation"].startswith("Kruskal")
    assert out["parametric"] is False
    assert any("non-normal" in r for r in out["reasons"])


def test_recommend_two_sample_and_paired() -> None:
    two = recommend_test([_NORMALISH, _NORMALISH + 1.0])
    assert "t-test" in two["recommendation"]
    paired = recommend_test([_NORMALISH, _NORMALISH * 1.1], paired=True)
    assert paired["n_groups"] == 2 and paired["paired"] is True
    with pytest.raises(ValueError, match="exactly 2"):
        recommend_test([_NORMALISH], paired=True)


def test_adjust_pvalues_textbook_case() -> None:
    from quantized.calc.stats_anova2 import adjust_pvalues

    p = [0.01, 0.04, 0.03, 0.005]
    # Bonferroni: p * 4, clipped
    np.testing.assert_allclose(
        adjust_pvalues(p, method="bonferroni")["adjusted"], [0.04, 0.16, 0.12, 0.02]
    )
    # Holm (sorted 0.005,0.01,0.03,0.04 * 4,3,2,1 with step-down monotonicity):
    # 0.02, 0.03, 0.06, 0.06 -> mapped back to input order
    np.testing.assert_allclose(
        adjust_pvalues(p, method="holm")["adjusted"], [0.03, 0.06, 0.06, 0.02]
    )
    # Benjamini-Hochberg: sorted *4/1,4/2,4/3,4/4 = .02,.02,.04,.04 step-up
    np.testing.assert_allclose(
        adjust_pvalues(p, method="bh")["adjusted"], [0.02, 0.04, 0.04, 0.02]
    )


def test_adjust_pvalues_errors() -> None:
    from quantized.calc.stats_anova2 import adjust_pvalues

    with pytest.raises(ValueError, match="method"):
        adjust_pvalues([0.05], method="fdr2")
    with pytest.raises(ValueError, match="within"):
        adjust_pvalues([1.5])
    with pytest.raises(ValueError, match="at least one"):
        adjust_pvalues([])
