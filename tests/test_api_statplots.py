"""Integration tests for /api/statplots (TestClient). Math is golden in
test_calc_statplots; here we prove transport + serialization + validation."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_box_roundtrip_and_fliers() -> None:
    resp = client.post(
        "/api/statplots/box",
        json={"groups": [[1, 2, 3, 4, 5, 6, 7, 8, 9, 100], [2, 3, 4, 5]],
              "labels": ["A", "B"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_groups"] == 2
    assert body["boxes"][0]["fliers"] == [100.0]
    assert body["boxes"][0]["label"] == "A"


def test_violin_roundtrip() -> None:
    resp = client.post(
        "/api/statplots/violin",
        json={"data": [1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0], "n_points": 64},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["x"]) == 64 and len(body["density"]) == 64
    assert body["bandwidth"] > 0


def test_violin_constant_data_422() -> None:
    resp = client.post("/api/statplots/violin", json={"data": [3.0, 3.0, 3.0]})
    assert resp.status_code == 422


def test_qq_roundtrip() -> None:
    data = [(-2.0), -1.0, -0.5, 0.0, 0.3, 0.7, 1.1, 2.0, 1.5, -1.2]
    resp = client.post("/api/statplots/qq", json={"data": data})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["theoretical_quantiles"]) == len(data)
    assert 0.0 <= body["r_squared"] <= 1.0


def test_histogram_roundtrip_with_fit() -> None:
    data = [float(x) for x in range(50)]
    resp = client.post(
        "/api/statplots/histogram",
        json={"data": data, "bins": "sturges", "fit": "norm"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_bins"] >= 1
    assert sum(body["counts"]) == 50
    assert body["fit"]["dist"] == "norm" and len(body["fit"]["pdf"]) == 256
