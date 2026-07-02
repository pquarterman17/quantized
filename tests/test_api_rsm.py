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


def _rsm_dataset() -> dict:
    """The committed synthetic RSM fixture, parsed then serialized for the wire."""
    from pathlib import Path

    from quantized.io.xrdml import import_xrdml
    from quantized.routes._payload import datastruct_payload

    fx = Path(__file__).parent / "fixtures" / "xrdml_rsm_synthetic.xrdml"
    return datastruct_payload(import_xrdml(fx))


def test_linecut_roundtrip() -> None:
    ds = _rsm_dataset()
    omega0 = ds["values"][0][1]
    resp = client.post(
        "/api/rsm/linecut",
        json={"dataset": ds, "direction": "h", "value": omega0, "space": "angular"},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity"]
    assert "H-cut" in out["metadata"]["cut_label"]
    assert len(out["time"]) == ds["metadata"]["map_shape"][1]


def test_cut_segment_roundtrip_and_422() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/cut-segment",
        json={"dataset": ds, "p0": [60.2, 30.1], "p1": [61.8, 30.9], "n": 40},
    )
    assert resp.status_code == 200
    assert resp.json()["metadata"]["x_column_name"] == "Distance"

    bad = client.post(
        "/api/rsm/cut-segment",
        json={"dataset": ds, "p0": [60.0, 30.0], "p1": [60.0, 30.0]},
    )
    assert bad.status_code == 422


def test_projection_roundtrip() -> None:
    ds = _rsm_dataset()
    resp = client.post("/api/rsm/projection", json={"dataset": ds, "axis": "frames"})
    assert resp.status_code == 200
    out = resp.json()
    assert len(out["time"]) == ds["metadata"]["map_shape"][0]
