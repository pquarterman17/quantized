"""Integration tests for /api/substrates (TestClient) -- the
critical-thickness route added alongside the Matthews-Blakeslee calculator
card. Thin adapter over calc.substrates; the math is reference-tested in
test_substrates.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_critical_thickness_matlab_doc_example() -> None:
    r = client.post("/api/substrates/critical-thickness", json={"a_film": 5.869, "a_sub": 5.653})
    assert r.status_code == 200
    assert r.json()["h_c"] == pytest.approx(103.79110337910842, rel=1e-9)
    assert r.json()["matched"] is False


def test_critical_thickness_custom_nu() -> None:
    r = client.post(
        "/api/substrates/critical-thickness",
        json={"a_film": 3.876, "a_sub": 3.905, "nu": 0.25},
    )
    assert r.status_code == 200
    assert r.json()["h_c"] > 0


def test_critical_thickness_lattice_matched_serializes_infinity() -> None:
    r = client.post("/api/substrates/critical-thickness", json={"a_film": 3.905, "a_sub": 3.905})
    assert r.status_code == 200
    assert r.json()["h_c"] is None
    assert r.json()["matched"] is True


def test_critical_thickness_rejects_nonpositive_lattice_parameter() -> None:
    r = client.post("/api/substrates/critical-thickness", json={"a_film": 0, "a_sub": 3.9})
    assert r.status_code == 422
