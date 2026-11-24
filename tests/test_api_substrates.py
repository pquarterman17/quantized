"""Integration tests for /api/substrates (TestClient) -- the
critical-thickness route added alongside the Matthews-Blakeslee calculator
card. Thin adapter over calc.substrates; the math is reference-tested in
test_substrates.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_critical_thickness_matlab_doc_example(client: TestClient) -> None:
    r = client.post("/api/substrates/critical-thickness", json={"a_film": 5.869, "a_sub": 5.653})
    assert r.status_code == 200
    assert r.json()["h_c"] == pytest.approx(103.79110337910842, rel=1e-9)
    assert r.json()["matched"] is False


def test_critical_thickness_custom_nu(client: TestClient) -> None:
    r = client.post(
        "/api/substrates/critical-thickness",
        json={"a_film": 3.876, "a_sub": 3.905, "nu": 0.25},
    )
    assert r.status_code == 200
    assert r.json()["h_c"] > 0


def test_critical_thickness_lattice_matched_serializes_infinity(client: TestClient) -> None:
    r = client.post("/api/substrates/critical-thickness", json={"a_film": 3.905, "a_sub": 3.905})
    assert r.status_code == 200
    assert r.json()["h_c"] is None
    assert r.json()["matched"] is True


def test_critical_thickness_rejects_nonpositive_lattice_parameter(client: TestClient) -> None:
    r = client.post("/api/substrates/critical-thickness", json={"a_film": 0, "a_sub": 3.9})
    assert r.status_code == 422


def test_critical_thickness_unsolvable_mismatch_is_422_not_a_fabricated_number(
    client: TestClient,
) -> None:
    """A mismatch with no Matthews-Blakeslee root must surface as a 422.

    Before the guard this returned 200 with h_c = b (one Burgers vector) -- a
    plausible-looking value that does not satisfy the fixed-point equation.
    """
    r = client.post("/api/substrates/critical-thickness", json={"a_film": 5.0, "a_sub": 3.905})
    assert r.status_code == 422
    assert "no critical thickness exists" in r.json()["detail"]


def test_ct_model_mb_equals_parity_card_at_60_60(client: TestClient) -> None:
    body = {"a_film": 5.869, "a_sub": 5.653}
    parity = client.post("/api/substrates/critical-thickness", json=body).json()
    r = client.post(
        "/api/substrates/critical-thickness-model",
        json={**body, "model": "matthews_blakeslee", "nu": 0.3},
    )
    assert r.status_code == 200
    assert r.json()["h_c"] == pytest.approx(parity["h_c"], rel=1e-9)
    assert "118 (1974)" in r.json()["label"]


def test_ct_model_people_bean_and_custom_b(client: TestClient) -> None:
    r = client.post(
        "/api/substrates/critical-thickness-model",
        json={"model": "people_bean", "a_film": 3.9, "a_sub": 3.9 / 1.01, "nu": 0.3, "b": 2.7},
    )
    assert r.status_code == 200
    assert r.json()["b"] == 2.7
    assert r.json()["h_c"] > 2.7
    assert "47, 322 (1985)" in r.json()["label"]


def test_ct_model_no_root_is_422_and_matched_is_null(client: TestClient) -> None:
    bad = client.post(
        "/api/substrates/critical-thickness-model",
        json={"model": "people_bean", "a_film": 3.9, "a_sub": 3.0, "nu": 0.3},
    )
    assert bad.status_code == 422
    m = client.post(
        "/api/substrates/critical-thickness-model",
        json={"model": "people_bean", "a_film": 3.9, "a_sub": 3.9, "nu": 0.3},
    )
    assert m.json()["matched"] is True and m.json()["h_c"] is None
    assert (
        client.post(
            "/api/substrates/critical-thickness-model",
            json={"model": "bogus", "a_film": 3.9, "a_sub": 3.9, "nu": 0.3},
        ).status_code
        == 422
    )
