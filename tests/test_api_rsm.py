"""Integration tests for the /api/rsm route (TestClient)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_strain_basic() -> None:
    resp = client.post(
        "/api/rsm/strain",
        json={"q_sub": [0.50, 4.00], "q_film": [0.40, 3.80]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["eps_parallel"] == 0.50 / 0.40 - 1
    assert body["relaxation"] is None  # no bulk -> NaN -> null


def test_strain_with_bulk_relaxation() -> None:
    resp = client.post(
        "/api/rsm/strain",
        json={"q_sub": [0.50, 4.00], "q_film": [0.40, 3.80], "bulk": [0.40, 3.70]},
    )
    assert resp.status_code == 200
    assert resp.json()["relaxation"] == 1.0  # film Qx == bulk Qx -> fully relaxed


def test_strain_symmetric_nan_serializes_as_null() -> None:
    resp = client.post(
        "/api/rsm/strain",
        json={"q_sub": [0.0, 4.00], "q_film": [0.0, 3.80]},
    )
    assert resp.status_code == 200
    assert resp.json()["eps_parallel"] is None  # symmetric -> NaN -> null


def test_strain_zero_qz_is_422() -> None:
    resp = client.post(
        "/api/rsm/strain",
        json={"q_sub": [0.50, 0.0], "q_film": [0.40, 3.80]},
    )
    assert resp.status_code == 422
