"""Integration tests for the headless-calculator /api/calc route (TestClient)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_catalog_lists_operations() -> None:
    resp = client.get("/api/calc/catalog")
    assert resp.status_code == 200
    ops = resp.json()["calculators"]
    names = {o["name"] for o in ops}
    assert "crystal.d_spacing" in names
    assert "superconductor.london_depth" in names
    assert all({"name", "domain", "summary"} <= set(o) for o in ops)


def test_catalog_filters_by_domain() -> None:
    resp = client.get("/api/calc/catalog", params={"domain": "xray"})
    assert resp.status_code == 200
    ops = resp.json()["calculators"]
    assert ops and all(o["domain"] == "xray" for o in ops)


def test_describe_returns_params() -> None:
    resp = client.get("/api/calc/describe/crystal.d_spacing")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "crystal.d_spacing"
    assert {"system", "a", "h", "k", "l"} <= {p["name"] for p in body["params"]}


def test_describe_unknown_is_404() -> None:
    resp = client.get("/api/calc/describe/does.not.exist")
    assert resp.status_code == 404
    assert "unknown calculator" in resp.json()["detail"]


def test_call_returns_result() -> None:
    resp = client.post(
        "/api/calc/call",
        json={
            "name": "crystal.d_spacing",
            "params": {
                "system": "cubic",
                "a": 5.4309,
                "b": 5.4309,
                "c": 5.4309,
                "h": 1,
                "k": 1,
                "l": 1,
            },
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "crystal.d_spacing"
    assert body["result"]["d"] == pytest.approx(3.1355, abs=1e-3)


def test_call_serializes_numpy_result() -> None:
    # units.convert returns (numpy value, info dict) — must survive to_jsonable.
    resp = client.post(
        "/api/calc/call",
        json={"name": "units.convert", "params": {"value": 1, "from_str": "eV", "to_str": "nm"}},
    )
    assert resp.status_code == 200
    result = resp.json()["result"]
    # tuple → list; the numpy value unwraps to a plain float ≈ 1239.84 nm
    assert result[0] == pytest.approx(1239.84, abs=0.1)


def test_call_unknown_is_404() -> None:
    resp = client.post("/api/calc/call", json={"name": "nope.nope", "params": {}})
    assert resp.status_code == 404


def test_call_bad_params_is_422() -> None:
    resp = client.post(
        "/api/calc/call", json={"name": "crystal.cell_volume", "params": {"bogus": 1}}
    )
    assert resp.status_code == 422
    assert "invalid parameters" in resp.json()["detail"]


def test_call_domain_error_is_422() -> None:
    resp = client.post(
        "/api/calc/call",
        json={
            "name": "crystal.d_spacing",
            "params": {"system": "cubic", "a": 4.0, "b": 4.0, "c": 4.0, "h": 0, "k": 0, "l": 0},
        },
    )
    assert resp.status_code == 422
