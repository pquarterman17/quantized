"""Integration tests for /api/xray (TestClient): Bragg/Q/energy dispatch and
the neutron wavelength/energy/velocity/temperature endpoint. Formula parity
is covered in test_xray.py; here we prove transport + HTTP error mapping."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_calc_d_from_2theta() -> None:
    resp = client.post(
        "/api/xray/calc",
        json={"mode": "d_from_2theta", "wavelength": 1.5406, "value": 28.44},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["result"] - 3.1356) < 1e-3
    assert out["unit"] == "Å"


def test_calc_q_from_d() -> None:
    resp = client.post(
        "/api/xray/calc",
        json={"mode": "q_from_d", "wavelength": 1.5406, "value": 3.1356},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["result"] - 2.004) < 1e-3
    assert out["unit"] == "1/Å"


def test_calc_energy_from_wavelength() -> None:
    resp = client.post(
        "/api/xray/calc",
        json={"mode": "energy_from_wavelength", "wavelength": 0.0, "value": 1.5406},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["result"] - 8.0478) < 1e-3
    assert out["unit"] == "keV"


def test_calc_inaccessible_reflection_is_422() -> None:
    resp = client.post(
        "/api/xray/calc",
        json={"mode": "2theta_from_d", "wavelength": 1.5406, "value": 0.5},
    )
    assert resp.status_code == 422
    assert "inaccessible" in resp.json()["detail"]


def test_calc_unknown_mode_is_422() -> None:
    resp = client.post(
        "/api/xray/calc",
        json={"mode": "nonsense", "wavelength": 1.5406, "value": 1.0},
    )
    assert resp.status_code == 422
    assert "unknown mode" in resp.json()["detail"]


def test_neutron_from_wavelength() -> None:
    resp = client.post("/api/xray/neutron", json={"quantity": "wavelength", "value": 1.8})
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["energy_mev"] - 25.25) < 0.01
    assert abs(out["velocity_m_s"] - 2197) < 2


def test_neutron_unknown_quantity_is_422() -> None:
    resp = client.post("/api/xray/neutron", json={"quantity": "nonsense", "value": 1.0})
    assert resp.status_code == 422
    assert "unknown quantity" in resp.json()["detail"]


def test_neutron_nonpositive_value_is_422() -> None:
    resp = client.post("/api/xray/neutron", json={"quantity": "energy", "value": -1.0})
    assert resp.status_code == 422
