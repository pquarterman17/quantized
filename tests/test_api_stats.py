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
