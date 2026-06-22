"""Integration tests for /api/reference (TestClient): constants, elements,
unit convert. Data parity is golden in test_calc_*; here we prove transport."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_constants_has_speed_of_light() -> None:
    resp = client.get("/api/reference/constants")
    assert resp.status_code == 200
    c = resp.json()["constants"]
    assert c["c"] > 2.9e8  # speed of light, m/s


def test_elements_full_table() -> None:
    resp = client.get("/api/reference/elements")
    assert resp.status_code == 200
    els = resp.json()["elements"]
    assert len(els) == 118
    assert els[0]["symbol"] == "H"


def test_element_by_symbol() -> None:
    resp = client.get("/api/reference/elements/Fe")
    assert resp.status_code == 200
    assert resp.json()["symbol"] == "Fe"
    assert resp.json()["Z"] == 26


def test_unknown_element_is_404() -> None:
    resp = client.get("/api/reference/elements/Zz")
    assert resp.status_code == 404


def test_convert_oe_to_tesla() -> None:
    resp = client.post(
        "/api/reference/convert", json={"value": 1.0, "from": "Oe", "to": "T"}
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["result"] - 1e-4) < 1e-12


def test_convert_incompatible_dims_is_422() -> None:
    resp = client.post(
        "/api/reference/convert", json={"value": 1.0, "from": "Oe", "to": "kg"}
    )
    assert resp.status_code == 422
