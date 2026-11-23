"""``calc.epitaxial_oop``: out-of-plane strain next to the in-plane mismatch.

Hand derivation (LSMO a = 3.876 Å on SrTiO3 a = 3.905 Å, both from the repo):
f = (3.876 - 3.905)/3.905; ε∥ = -f/(1+f) = (3.905 - 3.876)/3.876 (tensile);
ε⊥ = -2ν/(1-ν)·ε∥ (ν = 0.3 → factor -0.857142...).
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.epitaxial_oop import oriented_out_of_plane
from quantized.calc.epitaxial_strain import strain_from_poisson, tetragonal_distortion
from quantized.calc.surface_net import net_mismatch, surface_net

client = TestClient(app)
A_F, A_S = 3.876, 3.905
EPS_PAR = (A_S - A_F) / A_F


def _mm(film: dict, sub: dict) -> dict:  # type: ignore[type-arg]
    return net_mismatch(surface_net(**film), surface_net(**sub))


def test_cube_on_cube_matches_the_hand_derivation_and_the_building_blocks() -> None:
    m = _mm({"a": A_F, "hkl": (0, 0, 1)}, {"a": A_S, "hkl": (0, 0, 1)})
    r = oriented_out_of_plane(m, {"a": A_F}, 0.3)
    assert r["eps_parallel"] == pytest.approx(EPS_PAR, rel=1e-12)
    assert r["eps_parallel"] > 0  # film smaller than substrate: in-plane tension
    assert r["eps_perp"] == pytest.approx(-2 * 0.3 / 0.7 * EPS_PAR, rel=1e-12)
    assert r["eps_perp"] == pytest.approx(strain_from_poisson(EPS_PAR, 0.3)["eps_perp"], rel=1e-12)
    assert r["eps_perp"] < 0  # tension in plane: c contracts
    # c/a from tetragonal_distortion: c = a(1+ε⊥), in-plane a(1+ε∥).
    c_pred = A_F * (1 + r["eps_perp"])
    assert r["c_predicted"] == pytest.approx(c_pred, rel=1e-12)
    t = tetragonal_distortion(A_F * (1 + EPS_PAR), c_pred, c_relaxed=A_F)
    assert r["c_over_a"] == pytest.approx(t["c_over_a"], rel=1e-12)
    assert r["distortion_pct"] == pytest.approx(100 * r["eps_perp"], rel=1e-9)
    assert r["eps_perp_reason"] is None and r["c_over_a_reason"] is None


def test_zero_mismatch_gives_zero_strain_and_unit_c_over_a() -> None:
    m = _mm({"a": 3.905, "hkl": (0, 0, 1)}, {"a": 3.905, "hkl": (0, 0, 1)})
    r = oriented_out_of_plane(m, {"a": 3.905}, 0.3)
    assert (r["eps_parallel"], r["eps_perp"], r["c_over_a"]) == (0.0, 0.0, 1.0)


def test_compressive_film_elongates_c() -> None:
    m = _mm({"a": 3.905, "hkl": (0, 0, 1)}, {"a": 3.789, "hkl": (0, 0, 1)})
    r = oriented_out_of_plane(m, {"a": 3.905}, 0.25)
    assert r["eps_parallel"] < 0 < r["eps_perp"]
    assert r["c_over_a"] > 1.0


def test_missing_nu_fails_closed_with_a_reason() -> None:
    m = _mm({"a": A_F, "hkl": (0, 0, 1)}, {"a": A_S, "hkl": (0, 0, 1)})
    r = oriented_out_of_plane(m, {"a": A_F}, None)
    assert r["eps_parallel"] == pytest.approx(EPS_PAR)  # in-plane strain needs no nu
    assert r["eps_perp"] is None and r["c_over_a"] is None
    assert "Poisson ratio" in r["eps_perp_reason"] and "Poisson ratio" in r["c_over_a_reason"]


@pytest.mark.parametrize("nu", [-0.1, 0.5, 1.0, math.nan, math.inf])
def test_bad_nu_is_refused(nu: float) -> None:
    m = _mm({"a": A_F, "hkl": (0, 0, 1)}, {"a": A_S, "hkl": (0, 0, 1)})
    with pytest.raises(ValueError, match="Poisson"):
        oriented_out_of_plane(m, {"a": A_F}, nu)


def test_non_equibiaxial_strain_is_not_given_a_single_out_of_plane_strain() -> None:
    # Rectangular net (u != v mismatches): Si(110) 3.840 x 5.431 on a square 3.905 net.
    film = {"a": 5.4309, "hkl": (1, 1, 0), "centering": "F"}
    sub = {"a": 3.905, "hkl": (0, 0, 1)}
    r = oriented_out_of_plane(_mm(film, sub), film, 0.3)
    assert r["eps_perp"] is None and r["eps_parallel"] is None
    assert "not equibiaxial" in r["eps_perp_reason"]


def test_c_over_a_is_withheld_when_no_cell_axis_is_the_plane_normal() -> None:
    # Si(111) net on a hexagonal net of the same side: equibiaxial, but (111) is not a cell axis.
    film = {"a": 5.4309, "hkl": (1, 1, 1), "centering": "F"}
    sub = {"a": 5.4309 / math.sqrt(2) * 1.01, "gamma": 120.0, "hkl": (0, 0, 1)}
    m = _mm(film, sub)
    r = oriented_out_of_plane(m, film, 0.3)
    assert r["eps_perp"] is not None
    assert r["c_over_a"] is None and "no such axis" in r["c_over_a_reason"]


def test_hexagonal_film_on_0001_uses_c_as_the_normal_axis() -> None:
    gan = {"a": 3.189, "c": 5.1864, "gamma": 120.0, "hkl": (0, 0, 0, 1)}
    sub = {"a": 3.189 * 1.01, "gamma": 120.0, "hkl": (0, 0, 0, 1)}
    r = oriented_out_of_plane(_mm(gan, sub), gan, 0.2)
    assert r["c_predicted"] == pytest.approx(5.1864 * (1 + r["eps_perp"]), rel=1e-12)
    assert r["c_over_a"] == pytest.approx(r["c_predicted"] / (3.189 * 1.01), rel=1e-9)


def test_route_returns_out_of_plane_and_validates_nu() -> None:
    body = {
        "film": {"a": A_F, "hkl": [0, 0, 1]},
        "substrate": {"a": A_S, "hkl": [0, 0, 1]},
    }
    r = client.post("/api/epitaxy/net-mismatch", json={**body, "film_nu": 0.3})
    assert r.status_code == 200
    oop = r.json()["out_of_plane"]
    assert oop["eps_perp"] == pytest.approx(-2 * 0.3 / 0.7 * EPS_PAR, rel=1e-12)
    none = client.post("/api/epitaxy/net-mismatch", json=body).json()["out_of_plane"]
    assert none["eps_perp"] is None and none["eps_perp_reason"]
    for bad in (-0.1, 0.5, 1.0):
        assert (
            client.post("/api/epitaxy/net-mismatch", json={**body, "film_nu": bad}).status_code
            == 422
        )


def test_net_angle_mismatch_alone_withholds_the_out_of_plane_strain() -> None:
    # Equal strains along both axes but the nets differ in angle (square vs 120 deg):
    # the equibiaxial test must also look at delta_gamma, not just the strains.
    m = {"f_u": -0.01, "f_v": -0.01, "delta_gamma": 30.0, "film": {"hkl": [0, 0, 1]}}
    r = oriented_out_of_plane(m, {"a": 3.9}, 0.3)
    assert r["eps_parallel"] is None and r["eps_perp"] is None and r["c_over_a"] is None
    assert "not equibiaxial" in r["eps_perp_reason"]


def test_cubic_film_on_a_100_plane_gets_c_over_a_from_the_plane_normal() -> None:
    film = {"a": A_F, "hkl": (1, 0, 0)}
    r = oriented_out_of_plane(_mm(film, {"a": A_S, "hkl": (1, 0, 0)}), film, 0.3)
    assert r["c_predicted"] == pytest.approx(A_F * (1 + r["eps_perp"]), rel=1e-12)
    assert r["distortion_pct"] == pytest.approx(100 * r["eps_perp"], rel=1e-9)


def test_nu_zero_gives_no_out_of_plane_strain() -> None:
    m = _mm({"a": A_F, "hkl": (0, 0, 1)}, {"a": A_S, "hkl": (0, 0, 1)})
    r = oriented_out_of_plane(m, {"a": A_F}, 0.0)
    assert r["eps_perp"] == 0.0 and r["c_over_a"] == pytest.approx(1 / (1 + EPS_PAR))
