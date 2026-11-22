"""Survival analysis against a published textbook example, plus refusals.

Data: the Freireich et al. (1963) leukaemia remission trial, 21 patients on
6-mercaptopurine (6-MP) and 21 on placebo, as tabulated in Kleinbaum & Klein,
*Survival Analysis: A Self-Learning Text* (3rd ed., ch. 1-3) and Collett,
*Modelling Survival Data in Medical Research* (the "gehan" data in R's
MASS/survival). Published values reproduced here:

* 6-MP Kaplan-Meier: S(6)=0.857, S(7)=0.807, S(10)=0.753, S(13)=0.690,
  S(16)=0.627, S(22)=0.538, S(23)=0.448; median survival 23 weeks.
* Log-rank 6-MP vs placebo: chi-square = 16.79 on 1 df (p < 0.0001);
  9 observed events in 6-MP.
* Cox PH (Efron ties), placebo vs 6-MP: coef 1.572, SE 0.412, z = 3.81,
  p = 0.00014, HR = 4.82 (R ``coxph(Surv(time, status) ~ treat)``).
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

pytest.importorskip("lifelines", minversion="0.27")

from quantized.app import app  # noqa: E402
from quantized.calc.stats_survival import (  # noqa: E402
    cox_proportional_hazards,
    kaplan_meier,
    logrank_groups,
)

T6 = np.array([6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35], float)
E6 = np.array([1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0], float)
TP = np.array([1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23], float)
EP = np.ones(21)

client = TestClient(app)


def test_km_textbook_curve_median_and_at_risk() -> None:
    r = kaplan_meier(T6, E6)
    by_t = dict(zip(r["times"].tolist(), r["survival"].tolist(), strict=True))
    for t, s in {6: 0.857, 7: 0.807, 10: 0.753, 13: 0.690, 16: 0.627, 22: 0.538, 23: 0.448}.items():
        assert by_t[t] == pytest.approx(s, abs=5e-4)
    assert r["medianSurvival"] == 23.0
    # at-risk table: 21 at the start, 17 at t=7 after 3 events + 1 censored at 6
    assert r["atRisk"][0] == 21.0 and r["atRisk"][2] == 17.0
    # the median's CI is reported (lower bound 13 in R survfit; upper never reached)
    assert r["medianCiLow"] == 13.0
    assert np.isinf(r["medianCiHigh"])


def test_logrank_groups_textbook_chi_square() -> None:
    r = logrank_groups([T6, TP], [E6, EP])
    assert r["statistic"] == pytest.approx(16.79, abs=0.01)
    assert r["pValue"] < 1e-4
    assert r["dof"] == 1.0
    assert r["observed"] == [9.0, 21.0]
    assert r["N"] == [21, 21]


def test_logrank_groups_three_groups_has_two_dof() -> None:
    r = logrank_groups([T6, TP, TP + 3.0], [E6, EP, EP])
    assert r["dof"] == 2.0
    assert 0.0 <= r["pValue"] <= 1.0


def test_cox_textbook_placebo_vs_6mp() -> None:
    treat = np.r_[np.zeros(21), np.ones(21)]
    r = cox_proportional_hazards(np.r_[T6, TP], np.r_[E6, EP], [treat])
    assert r["coeffs"][0] == pytest.approx(1.572, abs=5e-4)
    assert r["se"][0] == pytest.approx(0.412, abs=5e-4)
    assert r["zStats"][0] == pytest.approx(3.81, abs=0.01)
    assert r["pValues"][0] == pytest.approx(0.00014, abs=5e-5)
    assert float(np.exp(r["coeffs"][0])) == pytest.approx(4.82, abs=0.01)


def test_refusals() -> None:
    zeros = np.zeros(5)
    with pytest.raises(ValueError, match="every row is censored"):
        kaplan_meier(np.arange(1.0, 6.0), zeros)
    with pytest.raises(ValueError, match="every row is censored"):
        logrank_groups([np.arange(1.0, 4.0), np.arange(1.0, 4.0)], [np.zeros(3), np.zeros(3)])
    with pytest.raises(ValueError, match="every row is censored"):
        cox_proportional_hazards(np.arange(1.0, 6.0), zeros, [np.arange(5.0)])
    with pytest.raises(ValueError, match="at least 2 groups"):
        logrank_groups([T6], [E6])
    with pytest.raises(ValueError, match="non-negative"):
        logrank_groups([T6, -TP], [E6, EP])
    with pytest.raises(ValueError, match="binary"):
        logrank_groups([T6, TP], [E6, EP * 2])
    with pytest.raises(ValueError, match="at least 2 complete rows"):
        logrank_groups([T6, np.array([1.0, np.nan])], [E6, np.array([1.0, 1.0])])


def test_cox_refuses_complete_separation_instead_of_returning_garbage() -> None:
    # The predictor is the time itself: every event ranks in strict order, the
    # likelihood has no finite maximum, and lifelines only *warns*.
    t = np.arange(1.0, 9.0)
    e = np.array([1, 1, 1, 1, 0, 1, 1, 1.0])
    with pytest.raises(ValueError, match="did not converge"):
        cox_proportional_hazards(t, e, [t.copy()])


def test_routes_logrank_groups_and_refusals() -> None:
    ok = client.post(
        "/api/stats/logrank-groups",
        json={"times": [T6.tolist(), TP.tolist()], "events": [E6.tolist(), EP.tolist()]},
    )
    assert ok.status_code == 200
    assert ok.json()["statistic"] == pytest.approx(16.79, abs=0.01)
    bad = client.post(
        "/api/stats/logrank-groups", json={"times": [T6.tolist()], "events": [E6.tolist()]}
    )
    assert bad.status_code == 422
    cens = client.post(
        "/api/stats/kaplan-meier", json={"time": [1.0, 2.0, 3.0], "event": [0.0, 0.0, 0.0]}
    )
    assert cens.status_code == 422
    km = client.post("/api/stats/kaplan-meier", json={"time": T6.tolist(), "event": E6.tolist()})
    assert km.json()["medianCiHigh"] is None  # infinity serialises as null
