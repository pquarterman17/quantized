"""Tests for ``calc.film_stack`` (THIN_FILM_STACK_PLANNING_PLAN G4).

A Python extension (no MATLAB stack model). Checked against hand-derived
values from the golden pieces it composes (Matthews-Blakeslee, Poisson
coupling, thermal mismatch, Bragg) and against a published case: LSMO coherent
on SrTiO3 has c of about 3.85 A.
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.film_stack import evaluate_stack
from quantized.calc.substrates import critical_thickness
from quantized.calc.xray import bragg_two_theta

client = TestClient(app)
STO = {"a": 3.905, "cte": 11.0}
LSMO = {"name": "LSMO", "a": 3.876, "thickness": 20, "nu": 0.33, "cte": 11.5}


def test_coherent_layer_takes_the_substrate_lattice() -> None:
    lay = evaluate_stack(STO, [LSMO])["layers"][0]
    assert lay["state"] == "coherent"
    assert lay["in_plane_a"] == 3.905
    assert lay["eps_parallel"] == pytest.approx((3.905 - 3.876) / 3.876)  # tensile
    assert lay["eps_perp"] == pytest.approx(-2 * 0.33 / 0.67 * lay["eps_parallel"])
    assert lay["c_strained"] == pytest.approx(3.876 * (1 + lay["eps_perp"]))
    assert lay["c_strained"] == pytest.approx(3.85, abs=0.005)  # published LSMO/STO
    assert lay["h_c_nm"] == pytest.approx(critical_thickness(3.876, 3.905, nu=0.33)["h_c_nm"])


def test_two_theta_follows_bragg_on_the_strained_c() -> None:
    lay = evaluate_stack(STO, [LSMO], max_order=3)["layers"][0]
    expected = [bragg_two_theta(1.5406, lay["c_strained"] / n) for n in (1, 2, 3)]
    assert lay["two_theta_00l"] == pytest.approx(expected)
    far = evaluate_stack(STO, [LSMO], wavelength=4.0, max_order=3)["layers"][0]
    assert far["two_theta_00l"][2] is None  # lambda/2d > 1: unreachable


def test_thick_layer_relaxes_and_sets_the_next_template() -> None:
    bto = {"name": "BTO", "a": 3.9945, "c": 4.0335, "thickness": 100}
    top = {"name": "top", "a": 3.9945, "thickness": 5}
    r = evaluate_stack(STO, [bto, top])
    first, second = r["layers"]
    assert first["state"] == "relaxed" and first["eps_parallel"] == 0.0
    assert first["c_strained"] == 4.0335
    assert second["template_a"] == 3.9945  # grows on the relaxed BTO, not on STO
    assert second["mismatch"] == pytest.approx(0.0)
    assert any("BTO" in w and "relaxed" in w for w in r["warnings"])


def test_coherent_layer_passes_the_substrate_lattice_up() -> None:
    thin = {"name": "thin", "a": 3.95, "thickness": 1}
    r = evaluate_stack(STO, [thin, {"name": "cap", "a": 3.905, "thickness": 1}])
    assert r["layers"][0]["state"] == "coherent"
    assert r["layers"][1]["template_a"] == 3.905
    assert r["layers"][1]["mismatch"] == pytest.approx(0.0)


def test_thermal_strain_uses_the_substrate_cte_and_cool_down() -> None:
    lay = evaluate_stack(STO, [LSMO], growth_temperature=1023.0)["layers"][0]
    assert lay["eps_thermal"] == pytest.approx((11.5 - 11.0) * 1e-6 * (300 - 1023))
    assert lay["eps_parallel_total"] == pytest.approx(lay["eps_parallel"] + lay["eps_thermal"])


def test_matched_layer_has_infinite_critical_thickness() -> None:
    lay = evaluate_stack(STO, [{"a": 3.905, "thickness": 500}])["layers"][0]
    assert lay["state"] == "coherent" and math.isinf(lay["h_c_nm"])
    assert lay["h_c_kind"] == "infinite"


def test_huge_mismatch_relaxes_immediately() -> None:
    r = evaluate_stack(STO, [{"name": "big", "a": 5.0, "thickness": 1}])
    lay = r["layers"][0]
    assert lay["h_c_nm"] is None and lay["state"] == "relaxed"
    assert lay["h_c_kind"] == "none"
    assert "none" in r["warnings"][0]


@pytest.mark.parametrize(
    ("substrate", "layers", "kwargs", "message"),
    [
        (STO, [], {}, "at least one layer"),
        ({"a": -1}, [LSMO], {}, "substrate: a must be positive"),
        (STO, [{"a": 3.9}], {}, "thickness is required"),
        (STO, [{**LSMO, "nu": 0.6}], {}, "nu must be in"),
        (STO, [LSMO], {"max_order": 0}, "max_order"),
        (STO, [LSMO], {"wavelength": 0}, "wavelength"),
    ],
)
def test_bad_inputs(substrate: dict, layers: list, kwargs: dict, message: str) -> None:  # type: ignore[type-arg]
    with pytest.raises(ValueError, match=message):
        evaluate_stack(substrate, layers, **kwargs)


def test_route_serializes_infinite_and_unreachable_values() -> None:
    r = client.post(
        "/api/epitaxy/stack",
        json={
            "substrate": STO,
            "layers": [{"a": 3.905, "thickness": 5}],
            "wavelength": 4.0,
            "max_order": 3,
        },
    )
    assert r.status_code == 200
    lay = r.json()["layers"][0]
    assert lay["h_c_kind"] == "infinite"  # matched; h_c itself is null on the wire
    assert lay["two_theta_00l"][2] is None
    bad = client.post("/api/epitaxy/stack", json={"substrate": STO, "layers": []})
    assert bad.status_code == 422
