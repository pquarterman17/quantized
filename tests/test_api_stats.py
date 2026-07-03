"""Integration tests for /api/stats (TestClient). Math is golden in
test_calc_stats; here we prove the transport + dict-of-arrays serialization."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_descriptive_basic() -> None:
    resp = client.post("/api/stats/descriptive", json={"x": [1, 2, 3, 4, 5]})
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["mean"] - 3.0) < 1e-12
    assert out["N"] == 5


def test_regression_recovers_line() -> None:
    x = list(np.linspace(0, 10, 40))
    y = [3.0 * v - 2.0 for v in x]
    resp = client.post("/api/stats/regression", json={"x": x, "y": y, "order": 1})
    assert resp.status_code == 200
    out = resp.json()
    # coeffs are low -> high power: [intercept, slope].
    assert abs(out["coeffs"][0] - (-2.0)) < 1e-6
    assert abs(out["coeffs"][1] - 3.0) < 1e-6
    assert out["R2"] > 0.9999


def test_ttest_one_sample_has_inference_fields() -> None:
    resp = client.post("/api/stats/ttest", json={"x": [1.1, 2.0, 1.9, 2.2, 1.8], "mu": 0.0})
    assert resp.status_code == 200
    out = resp.json()
    assert "tStat" in out and "pValue" in out
    assert len(out["ci"]) == 2


def test_anova_three_groups() -> None:
    resp = client.post(
        "/api/stats/anova",
        json={"groups": [[1, 2, 3], [2, 3, 4], [5, 6, 7]]},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert "fStat" in out
    assert "pValue" in out


def test_pca_returns_components() -> None:
    rng = np.random.default_rng(0)
    data = rng.standard_normal((30, 3)) @ np.array([[2, 0, 0], [0, 1, 0], [0, 0, 0.5]])
    resp = client.post("/api/stats/pca", json={"data": data.tolist()})
    assert resp.status_code == 200
    out = resp.json()
    assert "coeff" in out and "explained" in out
    assert len(out["explained"]) >= 1


def test_descriptive_empty_is_graceful_with_null_stats() -> None:
    # Empty input is valid: N=0 and the NaN stats serialize to null (not 500).
    resp = client.post("/api/stats/descriptive", json={"x": []})
    assert resp.status_code == 200
    out = resp.json()
    assert out["N"] == 0
    assert out["mean"] is None  # NaN -> null at the wire boundary


def test_mann_whitney_roundtrip() -> None:
    resp = client.post(
        "/api/stats/mann-whitney", json={"x": [1, 2, 3], "y": [4, 5, 6]}
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["U"] == 0.0
    assert abs(out["p"] - 0.1) < 1e-12


def test_kruskal_roundtrip() -> None:
    resp = client.post(
        "/api/stats/kruskal",
        json={"groups": [[1, 2, 3], [4, 5, 6], [7, 8, 9]]},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["H"] - 7.2) < 1e-12
    assert out["df"] == 2


def test_shapiro_roundtrip_and_422() -> None:
    ok = client.post("/api/stats/shapiro", json={"x": [0.1, -0.4, 0.9, -1.2, 0.3]})
    assert ok.status_code == 200
    assert 0.0 < ok.json()["W"] <= 1.0

    bad = client.post("/api/stats/shapiro", json={"x": [1.0, 2.0]})
    assert bad.status_code == 422


def test_sign_test_roundtrip() -> None:
    resp = client.post(
        "/api/stats/sign-test",
        json={"x": [1, 2, 3, 4, 5, 6, 7, 8, -1, -2], "mu": 0.0},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["n_pos"] == 8
    assert abs(out["p"] - 2.0 * 56 / 1024.0) < 1e-12


def test_regression_multi_roundtrip() -> None:
    x1 = list(np.linspace(0, 10, 30))
    x2 = [v * v for v in x1]
    y = [1.0 + 2.0 * a - 0.5 * b for a, b in zip(x1, x2, strict=True)]
    resp = client.post(
        "/api/stats/regression-multi", json={"predictors": [x1, x2], "y": y}
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["coeffs"][0] - 1.0) < 1e-6
    assert abs(out["coeffs"][1] - 2.0) < 1e-6
    assert abs(out["coeffs"][2] - (-0.5)) < 1e-6


def test_correlation_roundtrip_and_422() -> None:
    ok = client.post(
        "/api/stats/correlation",
        json={"columns": [[1, 2, 3, 4], [2, 4, 6, 8], [4, 3, 2, 1]]},
    )
    assert ok.status_code == 200
    out = ok.json()
    assert abs(out["r"][0][1] - 1.0) < 1e-12
    assert abs(out["r"][0][2] - (-1.0)) < 1e-12

    bad = client.post("/api/stats/correlation", json={"columns": [[1, 2, 3]]})
    assert bad.status_code == 422


def test_fit_distribution_roundtrip() -> None:
    x = [float(v) for v in np.exp(np.linspace(-1, 1, 25))]
    resp = client.post("/api/stats/fit-distribution", json={"x": x})
    assert resp.status_code == 200
    out = resp.json()
    assert out["best"] in {"lognormal", "gamma", "weibull", "normal", "exponential"}
    assert len(out["fits"]) >= 2


def test_power_roundtrip_both_modes() -> None:
    p = client.post("/api/stats/power", json={"effect_size": 0.5, "n": 64})
    assert p.status_code == 200
    assert abs(p.json()["power"] - 0.8015) < 0.002
    n = client.post("/api/stats/power", json={"effect_size": 0.5, "power": 0.8})
    assert n.status_code == 200
    assert n.json()["n"] == 64


def test_stepwise_roundtrip() -> None:
    t = list(np.linspace(0, 5, 50))
    x0 = t
    x1 = [np.cos(3.0 * v) for v in t]
    y = [2.0 * a for a in t]
    resp = client.post(
        "/api/stats/stepwise", json={"predictors": [x0, x1], "y": y}
    )
    assert resp.status_code == 200
    assert resp.json()["selected"] == [0]


def test_anova2_roundtrip() -> None:
    cells = [
        [[130, 155, 74, 180], [34, 40, 80, 75]],
        [[150, 188, 159, 126], [136, 122, 106, 115]],
    ]
    resp = client.post("/api/stats/anova2", json={"cells": cells})
    assert resp.status_code == 200
    sources = [r["source"] for r in resp.json()["table"]]
    assert sources == ["A", "B", "AxB", "Error", "Total"]


def test_anova2_unbalanced_roundtrip() -> None:
    vals = [12.1, 13.4, 11.8, 15.0, 14.2, 9.6, 18.4, 17.1, 21.0, 22.3, 20.1, 13.3]
    fa = ["lo"] * 6 + ["hi"] * 6
    fb = ["x", "x", "x", "y", "y", "z", "x", "x", "y", "y", "y", "z"]
    resp = client.post(
        "/api/stats/anova2-unbalanced",
        json={"values": vals, "factor_a": fa, "factor_b": fb, "ss_type": 3},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["balanced"] is False
    assert [r["source"] for r in body["table"]] == ["A", "B", "AxB", "Error", "Total"]
    # empty-cell design -> 422
    bad = client.post(
        "/api/stats/anova2-unbalanced",
        json={"values": [1, 2, 3, 4], "factor_a": ["a", "a", "b", "b"],
              "factor_b": ["x", "y", "x", "x"]},
    )
    assert bad.status_code == 422


def test_anova_rm_roundtrip() -> None:
    data = [[10.0, 12.0, 15.0], [8.0, 11.0, 14.0], [9.0, 10.0, 13.0], [11.0, 13.0, 17.0]]
    resp = client.post("/api/stats/anova-rm", json={"data": data})
    assert resp.status_code == 200
    body = resp.json()
    assert [r["source"] for r in body["table"]] == ["Subjects", "Conditions", "Error", "Total"]
    assert "greenhouse_geisser" in body["sphericity"]


def test_tukey_and_recommend_roundtrip() -> None:
    g = [[1.0, 2.0, 1.5, 2.2, 1.8], [5.0, 6.0, 5.5, 6.2, 5.8], [1.1, 2.1, 1.6, 2.3, 1.9]]
    t = client.post("/api/stats/tukey", json={"groups": g})
    assert t.status_code == 200
    assert len(t.json()["pairs"]) == 3
    r = client.post("/api/stats/recommend", json={"groups": g})
    assert r.status_code == 200
    assert "recommendation" in r.json() and r.json()["reasons"]
