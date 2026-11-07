"""Structure tests for ``calc.phase_database`` (port of
``calc.crystal.phaseDatabase``) and ``GET /api/reference/phases``.

Golden parity with MATLAB is ``test_calc_phase_database_golden.py`` (skips
until its fixture is frozen). These tests check the table is complete and
self-consistent and spot-check entries against the MATLAB source.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.crystallography import cell_volume
from quantized.calc.element_data import by_symbol
from quantized.calc.phase_database import CATEGORIES, get_phase, list_phases, phase_database

client = TestClient(app)


def test_table_size_and_categories() -> None:
    db = phase_database()
    assert len(db) == 52
    assert sum(1 for p in db if p["basis"]) == 40
    assert {p["category"] for p in db} == set(CATEGORIES)
    assert len({p["name"] for p in db}) == 52  # names are unique keys


def test_every_cell_is_physical_and_every_basis_atom_is_an_element() -> None:
    for p in phase_database():
        assert cell_volume(p["a"], p["b"], p["c"], p["alpha"], p["beta"], p["gamma"]) > 0
        assert p["centering"] in {"P", "F", "I", "A", "B", "C", "R"}
        for symbol, *xyz in p["basis"]:
            by_symbol(symbol)  # raises for an unknown symbol
            assert all(-1e-12 <= v < 1 for v in xyz), (p["name"], xyz)


@pytest.mark.parametrize(
    ("name", "a", "c", "centering", "n_basis"),
    [
        ("Silicon", 5.4309, 5.4309, "F", 8),  # diamond: fcc + (¼,¼,¼) shift
        ("SrTiO3", 3.9050, 3.9050, "P", 5),
        ("GaN (wurtzite)", 3.1890, 5.1864, "P", 4),
        ("TiO2 rutile", 4.5941, 2.9589, "P", 6),
        ("CaF2 (fluorite)", 5.4626, 5.4626, "F", 12),
        ("LaB6 (standard)", 4.1569, 4.1569, "P", 7),
        ("Sapphire (Al2O3)", 4.7589, 12.9910, "R", 0),
    ],
)
def test_spot_checks_against_the_matlab_source(
    name: str, a: float, c: float, centering: str, n_basis: int
) -> None:
    p = get_phase(name)
    assert (p["a"], p["c"], p["centering"], len(p["basis"])) == (a, c, centering, n_basis)


def test_wurtzite_u_parameter_and_rutile_oxygen_positions() -> None:
    gan = get_phase("GaN (wurtzite)")["basis"]
    assert gan[2] == ["N", pytest.approx(1 / 3), pytest.approx(2 / 3), 0.376]
    assert gan[3][3] == pytest.approx(0.876)
    rut = get_phase("TiO2 rutile")["basis"]
    assert rut[3][1:] == [pytest.approx(1 - 0.3051), pytest.approx(1 - 0.3051), 0.0]


def test_lookup_is_case_insensitive_and_copies() -> None:
    p = get_phase("srtio3")
    p["a"] = 0.0
    assert get_phase("SrTiO3")["a"] == 3.905
    with pytest.raises(ValueError, match="unknown phase"):
        get_phase("Unobtainium")


def test_category_filter() -> None:
    assert len(list_phases("perovskite")) == 6
    with pytest.raises(ValueError, match="unknown phase category"):
        list_phases("ceramic")


def test_route() -> None:
    r = client.get("/api/reference/phases")
    assert r.status_code == 200
    assert len(r.json()["phases"]) == 52
    metals = client.get("/api/reference/phases", params={"category": "metal"}).json()["phases"]
    assert len(metals) == 15 and all(p["category"] == "metal" for p in metals)
    assert client.get("/api/reference/phases", params={"category": "x"}).status_code == 422
