"""Integration tests for /api/substrates (TestClient) -- the
critical-thickness route added alongside the Matthews-Blakeslee calculator
card. Thin adapter over calc.substrates; the math is reference-tested in
test_substrates.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_critical_thickness_1pct_reference() -> None:
    r = client.post("/api/substrates/critical-thickness", json={"mismatch": 0.01})
    assert r.status_code == 200
    assert r.json()["h_c"] == pytest.approx(26.611533074174734, rel=1e-6)


def test_critical_thickness_custom_b_nu() -> None:
    r = client.post(
        "/api/substrates/critical-thickness", json={"mismatch": 0.01, "b": 3.9, "nu": 0.25}
    )
    assert r.status_code == 200
    assert r.json()["h_c"] > 0


def test_critical_thickness_rejects_zero_mismatch() -> None:
    r = client.post("/api/substrates/critical-thickness", json={"mismatch": 0.0})
    assert r.status_code == 422


def test_critical_thickness_too_large_mismatch_is_422() -> None:
    r = client.post("/api/substrates/critical-thickness", json={"mismatch": 0.3})
    assert r.status_code == 422
