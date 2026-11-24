"""chi = M/H and moment per formula unit (calc + route). Analytic expectations."""

from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.calc.constants import constants
from quantized.calc.magnetic_derived_quantities import moment_per_formula_unit, susceptibility


def test_volume_cgs_and_si_agree_by_4pi() -> None:
    # 1 emu/cm3 at 1000 Oe: chi_cgs = 1e-3; SI: M = 1e3 A/m, H = 1e6/(4 pi) A/m.
    cgs = susceptibility([1000.0], [1.0], response_unit="emu/cm³", field_unit="Oe", output="volume")
    si = susceptibility(
        [1000.0], [1.0], response_unit="emu/cm³", field_unit="Oe", output="volume", system="si"
    )
    assert cgs["susceptibility"][0] == pytest.approx(1e-3)
    assert si["susceptibility"][0] == pytest.approx(4 * math.pi * 1e-3)
    assert si["susceptibility"][0] == pytest.approx(1e3 / (1e6 / (4 * math.pi)))
    assert cgs["unit"] == "emu/(cm³·Oe)" and si["unit"] == "1"


def test_units_are_interchangeable() -> None:
    a = susceptibility([1.0], [1.0], response_unit="emu/cm³", field_unit="T", output="volume")
    b = susceptibility([1e4], [1e3], response_unit="A/m", field_unit="Oe", output="volume")
    assert a["susceptibility"][0] == pytest.approx(b["susceptibility"][0], rel=1e-12)
    assert a["susceptibility"][0] == pytest.approx(1e-4)


def test_total_moment_to_molar_and_mass() -> None:
    # 2e-3 emu, 10 mg, M = 100 g/mol, 1000 Oe -> 0.2 emu/g -> 2e-4 emu/(g Oe) -> 0.02 cm3/mol
    kw = dict(response_unit="emu", field_unit="Oe", sample_mass_g=0.01, molar_mass_g_mol=100.0)
    mass = susceptibility([1000.0], [2e-3], output="mass", **kw)  # type: ignore[arg-type]
    molar = susceptibility([1000.0], [2e-3], output="molar", **kw)  # type: ignore[arg-type]
    assert mass["susceptibility"][0] == pytest.approx(2e-4)
    assert molar["susceptibility"][0] == pytest.approx(2e-2)
    si = susceptibility([1000.0], [2e-3], output="molar", system="si", **kw)  # type: ignore[arg-type]
    assert si["susceptibility"][0] == pytest.approx(2e-2 * 4 * math.pi * 1e-6)


def test_uncertainty_propagation_and_gaps() -> None:
    r = susceptibility(
        [1000.0, 0.0], [1.0, 1.0], response_unit="emu/cm³", field_unit="Oe", output="volume",
        response_errors=[[0.1, 0.1]], field_errors=[[10.0, 10.0]],
    )
    chi = 1e-3
    expect = math.hypot(0.1 / 1000.0, chi * 10.0 / 1000.0)
    assert r["errors"][0][0] == pytest.approx(expect)
    assert math.isnan(r["susceptibility"][1]) and math.isnan(r["errors"][0][1])
    assert r["n_invalid_field"] == 1
    only_field = susceptibility(
        [1000.0], [1.0], response_unit="emu/cm³", field_unit="Oe", output="volume",
        field_errors=[[10.0]],
    )
    assert only_field["errors"][0][0] == pytest.approx(chi * 10.0 / 1000.0)


@pytest.mark.parametrize(
    ("kw", "needle"),
    [
        (dict(response_unit="emu/cm³", output="mass"), "density"),
        (dict(response_unit="emu/g", output="volume"), "density"),
        (dict(response_unit="emu", output="mass"), "sample mass"),
        (dict(response_unit="emu", output="volume"), "sample volume"),
        (dict(response_unit="emu/g", output="molar"), "molar mass"),
        (dict(response_unit="emu/cm²", output="volume"), "per-area"),
        (dict(response_unit="", output="volume"), "unknown response unit"),
        (dict(response_unit="furlong", output="volume"), "unknown response unit"),
        (dict(response_unit="emu/g", output="mass", field_unit="parsec"), "Unknown source field"),
        (dict(response_unit="emu/g", output="weird"), "output must be"),
    ],
)
def test_susceptibility_refusals(kw: dict[str, str], needle: str) -> None:
    args: dict[str, object] = {"field_unit": "Oe"}
    args.update(kw)
    with pytest.raises(ValueError, match=needle):
        susceptibility([1.0], [1.0], **args)  # type: ignore[arg-type]


def test_moment_per_formula_unit_matches_constants_and_iron() -> None:
    c = constants()
    r = moment_per_formula_unit([217.6], response_unit="emu/g", molar_mass_g_mol=55.845)
    assert r["moment"][0] == pytest.approx(217.6 * 55.845 / (c["NA"] * c["muB"] * 1e3))
    assert r["moment"][0] == pytest.approx(2.176, abs=0.01)  # bcc Fe ~2.2 muB / atom
    total = moment_per_formula_unit(
        [217.6 * 0.01], response_unit="emu", molar_mass_g_mol=55.845,
        sample_mass_g=0.01, response_errors=[[0.5]],
    )
    assert total["moment"][0] == pytest.approx(r["moment"][0])
    per_emu = 55.845 / (c["NA"] * c["muB"] * 1e3)
    assert total["errors"][0][0] == pytest.approx(0.5 / 0.01 * per_emu)
    si = moment_per_formula_unit([217.6], response_unit="A·m²/kg", molar_mass_g_mol=55.845)
    assert si["moment"][0] == pytest.approx(r["moment"][0])


@pytest.mark.parametrize(
    ("kw", "needle"),
    [
        (dict(response_unit="emu/cm³", molar_mass_g_mol=10.0), "per-mass"),
        (dict(response_unit="emu/g", molar_mass_g_mol=None), "molar mass"),
        (dict(response_unit="emu/g", molar_mass_g_mol=-1.0), "molar mass"),
        (dict(response_unit="emu", molar_mass_g_mol=10.0), "sample mass"),
        (dict(response_unit="", molar_mass_g_mol=10.0), "unknown response unit"),
    ],
)
def test_moment_refusals(kw: dict[str, object], needle: str) -> None:
    with pytest.raises(ValueError, match=needle):
        moment_per_formula_unit([1.0], **kw)  # type: ignore[arg-type]


def test_routes(client: TestClient) -> None:
    r = client.post(
        "/api/magnetic/susceptibility",
        json={"field": [1000.0], "response": [1.0], "response_unit": "emu/cm³",
              "field_unit": "Oe", "output": "volume", "response_errors": [[0.1]]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["susceptibility"][0] == pytest.approx(1e-3) and len(body["errors"]) == 1
    assert client.post(
        "/api/magnetic/susceptibility",
        json={"field": [1.0], "response": [1.0], "response_unit": "emu/cm³",
              "field_unit": "Oe", "output": "mass"},
    ).status_code in (400, 422)
    m = client.post(
        "/api/magnetic/moment-per-formula-unit",
        json={"response": [217.6], "response_unit": "emu/g", "molar_mass_g_mol": 55.845},
    )
    assert m.status_code == 200 and np.isclose(m.json()["moment"][0], 2.176, atol=0.01)
    assert client.post(
        "/api/magnetic/moment-per-formula-unit",
        json={"response": [1.0], "response_unit": "emu/g"},
    ).status_code in (400, 422)
