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


def test_plane_spacings_fcc_si_first_reflection_and_null_two_theta() -> None:
    r = client.post(
        "/api/crystallography/plane-spacings",
        json={"a": 5.431, "centering": "F", "max_hkl": 3, "wavelength": 1.5406},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["hkl"][0] == [1, 1, 1]
    assert body["d"][0] == pytest.approx(3.1356, abs=1e-4)
    assert body["n_reflections"] == len(body["hkl"])
    # A long wavelength makes every reflection unreachable: 2θ is null, not NaN.
    far = client.post(
        "/api/crystallography/plane-spacings",
        json={"a": 3.0, "max_hkl": 1, "wavelength": 9.0},
    ).json()
    assert all(t is None for t in far["two_theta"])


def test_plane_spacings_validates_max_hkl_and_centering() -> None:
    too_big = client.post("/api/crystallography/plane-spacings", json={"a": 4.0, "max_hkl": 11})
    assert too_big.status_code == 422
    bad = client.post("/api/crystallography/plane-spacings", json={"a": 4.0, "centering": "X"})
    assert bad.status_code == 422


def test_atomic_density_route() -> None:
    r = client.post("/api/crystallography/atomic-density", json={"a": 2.87, "z": 2})
    assert r.status_code == 200
    assert r.json()["density"] == pytest.approx(2 / (2.87**3 * 1e-24), rel=1e-12)
    bad = client.post("/api/crystallography/atomic-density", json={"a": 2.87, "z": 0})
    assert bad.status_code == 422


def test_tetragonal_distortion_route() -> None:
    r = client.post(
        "/api/crystallography/tetragonal-distortion",
        json={"a_relaxed": 3.905, "c_measured": 3.92, "c_relaxed": 3.905},
    )
    assert r.status_code == 200
    assert r.json()["distortion_pct"] == pytest.approx((3.92 - 3.905) / 3.905 * 100, rel=1e-12)
    bad = client.post(
        "/api/crystallography/tetragonal-distortion", json={"a_relaxed": 0, "c_measured": 3.9}
    )
    assert bad.status_code == 422


def test_poisson_strain_route() -> None:
    r = client.post("/api/crystallography/poisson-strain", json={"eps_parallel": 0.01, "nu": 0.3})
    assert r.status_code == 200
    assert r.json()["eps_perp"] == pytest.approx(-0.6 / 0.7 * 0.01, rel=1e-12)
    singular = client.post(
        "/api/crystallography/poisson-strain", json={"eps_parallel": 0.01, "nu": 1}
    )
    assert singular.status_code == 422
