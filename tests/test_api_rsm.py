"""Integration tests for the /api/rsm route (TestClient)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from quantized.app import app
from quantized.io.xrdml import import_xrdml

client = TestClient(app)
FIXTURES = Path(__file__).parent / "fixtures"


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


def test_analyze_finds_the_fixture_peak() -> None:
    ds = import_xrdml(FIXTURES / "xrdml_rsm_synthetic.xrdml")
    resp = client.post(
        "/api/rsm/analyze",
        json={"dataset": ds.to_dict(), "n_peaks": 1, "smooth_sigma": 0.6, "fit_window": 6},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_peaks_found"] == 1
    assert body["used_q_space"] is True
    omega_c, tth_c = body["peaks"][0]["centre_angle"]
    assert 30.0 <= omega_c <= 31.0
    assert 60.0 <= tth_c <= 62.0


def test_analyze_rejects_non_rsm_dataset() -> None:
    plain = {
        "time": [0.0, 1.0],
        "values": [[1.0], [2.0]],
        "labels": ["m"],
        "units": ["emu"],
        "metadata": {},
    }
    resp = client.post("/api/rsm/analyze", json={"dataset": plain})
    assert resp.status_code == 422
