"""Integration tests for /api/crystallography (TestClient). Thin adapter over
calc.crystallography + calc.formula; the math is reference-tested in
test_crystallography.py / test_formula.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_dspacing_cubic() -> None:
    r = client.post(
        "/api/crystallography/dspacing",
        json={"system": "cubic", "a": 4.0, "h": 2, "k": 0, "l": 0},
    )
    assert r.status_code == 200
    assert r.json()["d"] == pytest.approx(2.0, rel=1e-9)


def test_dspacing_monoclinic_uses_beta() -> None:
    # β = 90 should match the orthorhombic value.
    body = {
        "system": "monoclinic",
        "a": 3.0,
        "b": 4.0,
        "c": 5.0,
        "beta": 90.0,
        "h": 1,
        "k": 1,
        "l": 1,
    }
    r = client.post("/api/crystallography/dspacing", json=body)
    assert r.status_code == 200
    ortho = client.post(
        "/api/crystallography/dspacing",
        json={"system": "orthorhombic", "a": 3.0, "b": 4.0, "c": 5.0, "h": 1, "k": 1, "l": 1},
    ).json()["d"]
    assert r.json()["d"] == pytest.approx(ortho, rel=1e-9)


def test_cell_volume_only() -> None:
    r = client.post("/api/crystallography/cell", json={"a": 4.0})
    assert r.status_code == 200
    body = r.json()
    assert body["volume"] == pytest.approx(64.0, rel=1e-9)
    assert "density" not in body  # no formula → no density


def test_cell_density_from_formula() -> None:
    r = client.post(
        "/api/crystallography/cell",
        json={"a": 5.6402, "formula": "NaCl", "z": 4},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["density"] == pytest.approx(2.16, abs=0.02)
    assert body["molar_mass"] == pytest.approx(58.44, abs=0.1)


def test_cell_bad_formula_is_422() -> None:
    r = client.post("/api/crystallography/cell", json={"a": 4.0, "formula": "Xx2"})
    assert r.status_code == 422


# ── 4-index Miller-Bravais (hkil) hexagonal plane form ──────────────────────
def test_dspacing_hexagonal_accepts_4index_form() -> None:
    body = {"system": "hexagonal", "a": 3.2094, "c": 5.2107, "h": 1, "k": 0, "l": 0, "i": -1}
    r = client.post("/api/crystallography/dspacing", json=body)
    assert r.status_code == 200
    assert r.json()["d"] == pytest.approx(2.77950, abs=1e-4)


def test_dspacing_hexagonal_rejects_inconsistent_i() -> None:
    body = {"system": "hexagonal", "a": 3.2094, "c": 5.2107, "h": 1, "k": 0, "l": 0, "i": 0}
    r = client.post("/api/crystallography/dspacing", json=body)
    assert r.status_code == 422
    assert "i must equal" in r.json()["detail"]


def test_dspacing_4index_rejected_for_non_hexagonal() -> None:
    body = {"system": "cubic", "a": 4.0, "h": 1, "k": 0, "l": 0, "i": -1}
    r = client.post("/api/crystallography/dspacing", json=body)
    assert r.status_code == 422
    assert "hexagonal" in r.json()["detail"]


# ── Interplanar angle ────────────────────────────────────────────────────────
def test_angle_cubic_100_110_is_45deg() -> None:
    body = {"system": "cubic", "a": 4.0, "h1": 1, "k1": 0, "l1": 0, "h2": 1, "k2": 1, "l2": 0}
    r = client.post("/api/crystallography/angle", json=body)
    assert r.status_code == 200
    assert r.json()["angle_deg"] == pytest.approx(45.0, abs=1e-9)


def test_angle_zero_hkl_is_422() -> None:
    body = {"system": "cubic", "a": 4.0, "h1": 0, "k1": 0, "l1": 0, "h2": 1, "k2": 1, "l2": 0}
    r = client.post("/api/crystallography/angle", json=body)
    assert r.status_code == 422


# ── Atomic bond angle ────────────────────────────────────────────────────────
def test_bond_angle_cubic_reference() -> None:
    response = client.post(
        "/api/crystallography/bond-angle",
        json={
            "a": 4.0,
            "b": 4.0,
            "c": 4.0,
            "atom1": [0.25, 0.0, 0.0],
            "vertex": [0.0, 0.0, 0.0],
            "atom3": [0.0, 0.25, 0.0],
        },
    )
    assert response.status_code == 200
    assert response.json()["angle_deg"] == pytest.approx(90.0, abs=1e-12)
    assert response.json()["distance1"] == pytest.approx(1.0, abs=1e-12)


def test_bond_angle_equivalent_neighbour_is_422() -> None:
    response = client.post(
        "/api/crystallography/bond-angle",
        json={
            "a": 4.0,
            "b": 4.0,
            "c": 4.0,
            "atom1": [1.0, 0.0, 0.0],
            "vertex": [0.0, 0.0, 0.0],
            "atom3": [0.0, 0.25, 0.0],
        },
    )
    assert response.status_code == 422
    assert "distinct from the vertex" in response.json()["detail"]


def test_bond_angle_wrong_coordinate_length_is_422() -> None:
    response = client.post(
        "/api/crystallography/bond-angle",
        json={
            "a": 4.0,
            "b": 4.0,
            "c": 4.0,
            "atom1": [0.25, 0.0],
            "vertex": [0.0, 0.0, 0.0],
            "atom3": [0.0, 0.25, 0.0],
        },
    )
    assert response.status_code == 422
