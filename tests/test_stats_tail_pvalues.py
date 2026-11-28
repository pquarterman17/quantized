"""Far-tail p-values must come from survival functions, not ``1 - cdf``.

Acceptance pass 15 (C1): Fit Y by X showed 1.62037e-12 where Statistical tests
and scipy give 1.620405e-12; a 4-group edit showed 4.39759e-13 against
4.39700e-13. ``1 - cdf`` loses digits once p is near the float epsilon.
"""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import stats as sps

from quantized.app import app
from quantized.calc.stats import anova1, lin_regress, t_test

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "stats_tail_sv.csv"


def _groups(rename_first: bool = False) -> list[list[float]]:
    by: dict[str, list[float]] = {}
    with FIXTURE.open(newline="") as fh:
        for i, row in enumerate(csv.DictReader(fh)):
            key = "ctlX" if rename_first and i == 0 else row["grp"]
            by.setdefault(key, []).append(float(row["val2"]))
    return list(by.values())


@pytest.mark.parametrize("edited", [False, True])
def test_fit_y_by_x_and_tests_tools_match_scipy_far_tail(edited: bool) -> None:
    groups = _groups(edited)
    want = float(sps.f_oneway(*groups).pvalue)
    assert want < 1e-11
    fit = client.post("/api/stats/anova", json={"groups": groups}).json()
    assert fit["pValue"] == pytest.approx(want, rel=1e-9)
    if not edited:  # a 1-observation group is refused by the post hoc tools
        tests = client.post("/api/stats/posthoc", json={"groups": groups, "method": "tukey"})
        assert tests.json()["omnibus_p"] == pytest.approx(want, rel=1e-9)


def test_one_way_p_value_unrounded_from_calc() -> None:
    groups = [np.asarray(g) for g in _groups()]
    out = anova1(groups)
    assert out["pValue"] == pytest.approx(float(sps.f_oneway(*groups).pvalue), rel=1e-9)


def test_regression_and_ttest_tails_match_scipy() -> None:
    rng = np.random.default_rng(3)
    x = np.linspace(0, 10, 60)
    y = 2.0 * x + rng.normal(0, 0.05, x.size)
    reg = lin_regress(x, y, order=1)
    lin = sps.linregress(x, y)
    assert float(reg["pValues"][1]) == pytest.approx(float(lin.pvalue), rel=1e-6)
    assert float(reg["fPvalue"]) == pytest.approx(float(lin.pvalue), rel=1e-6)
    a, b = rng.normal(0, 1, 40), rng.normal(5, 1, 40)
    for tail, alt in (("both", "two-sided"), ("right", "greater"), ("left", "less")):
        got = t_test(b, a, tail=tail)["pValue"]
        want = float(sps.ttest_ind(b, a, equal_var=False, alternative=alt).pvalue)
        assert got == pytest.approx(want, rel=1e-8)
