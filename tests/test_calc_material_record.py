"""``calc.material_record``: the one material record (OPEN_ITEMS row 28).

Covers validation (cell vs crystal system, centering vs system, space-group
letter, uncited values refused), the migration of the 14 MATLAB substrate rows
into records, and a back-compat regression: every derived substrate value
(table row, Miller indices, surface net, mismatch, critical thickness) equals
the value frozen from the pre-record code
(``tests/fixtures/substrate_derived_baseline.json``, frozen at the commit named
in its ``frozen_from`` key).
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.material_record import (
    Cited,
    ElasticConstants,
    Lattice,
    MaterialRecord,
    MaterialRecordError,
    record_from_phase,
)
from quantized.calc.phase_database import phase_database
from quantized.calc.substrate_orientation import substrate_orientation
from quantized.calc.substrates import (
    SUBSTRATE_SOURCE,
    critical_thickness,
    lattice_mismatch,
    substrate_record,
    substrate_records,
    substrate_table,
)

BASELINE = Path(__file__).parent / "fixtures" / "substrate_derived_baseline.json"
SRC = "test citation"


def _cubic(a: float = 4.0) -> Lattice:
    return Lattice(a, a, a, 90.0, 90.0, 90.0)


# --- validation --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("system", "cell"),
    [
        ("cubic", Lattice(4.0, 4.0, 4.1, 90, 90, 90)),
        ("cubic", Lattice(4.0, 4.0, 4.0, 90, 90, 91)),
        ("tetragonal", Lattice(4.0, 4.1, 5.0, 90, 90, 90)),
        ("orthorhombic", Lattice(4.0, 4.1, 5.0, 90, 95, 90)),
        ("hexagonal", Lattice(3.0, 3.0, 5.0, 90, 90, 90)),
        ("hexagonal", Lattice(3.0, 3.1, 5.0, 90, 90, 120)),
        ("trigonal", Lattice(3.0, 3.0, 3.1, 80, 80, 80)),
        ("monoclinic", Lattice(4.0, 3.0, 5.0, 91, 99, 90)),
    ],
)
def test_inconsistent_cell_is_refused_with_the_rule(system: str, cell: Lattice) -> None:
    with pytest.raises(MaterialRecordError, match=f"is not {system}: {system} needs"):
        MaterialRecord("X", "X", system, cell, lattice_source=SRC)


@pytest.mark.parametrize(
    ("system", "cell"),
    [
        ("cubic", Lattice(4.0, 4.0, 4.0, 90, 90, 90)),
        ("tetragonal", Lattice(4.0, 4.0, 5.0, 90, 90, 90)),
        ("orthorhombic", Lattice(4.0, 4.1, 5.0, 90, 90, 90)),
        ("hexagonal", Lattice(3.0, 3.0, 5.0, 90, 90, 120)),
        ("trigonal", Lattice(3.0, 3.0, 5.0, 90, 90, 120)),
        ("trigonal", Lattice(3.0, 3.0, 3.0, 80, 80, 80)),
        ("monoclinic", Lattice(4.0, 3.0, 5.0, 90, 99, 90)),
        ("triclinic", Lattice(4.0, 3.0, 5.0, 81, 99, 103)),
    ],
)
def test_consistent_cell_is_accepted(system: str, cell: Lattice) -> None:
    assert MaterialRecord("X", "X", system, cell, lattice_source=SRC).lattice == cell


def test_bad_cell_values_and_unknown_system_are_refused() -> None:
    with pytest.raises(MaterialRecordError, match="must be positive"):
        Lattice(0.0, 1.0, 1.0, 90, 90, 90)
    with pytest.raises(MaterialRecordError, match="between 0 and 180"):
        Lattice(1.0, 1.0, 1.0, 180, 90, 90)
    with pytest.raises(MaterialRecordError, match="unknown crystal system"):
        MaterialRecord("X", "X", "cubicish", _cubic(), lattice_source=SRC)


def test_amorphous_has_no_cell_and_crystals_need_one() -> None:
    assert MaterialRecord("glass", "SiO2", "amorphous", None).lattice is None
    with pytest.raises(MaterialRecordError, match="amorphous material has no cell"):
        MaterialRecord("glass", "SiO2", "amorphous", _cubic(), lattice_source=SRC)
    with pytest.raises(MaterialRecordError, match="needs a cell"):
        MaterialRecord("X", "X", "cubic", None)


def test_centering_must_be_a_bravais_lattice_of_the_system() -> None:
    ok = MaterialRecord("X", "X", "cubic", _cubic(), SRC, centering="F", centering_source=SRC)
    assert ok.centering == "F"
    with pytest.raises(MaterialRecordError, match='centering "C" is not a cubic Bravais'):
        MaterialRecord("X", "X", "cubic", _cubic(), SRC, centering="C", centering_source=SRC)


def test_space_group_letter_must_match_the_centering() -> None:
    kw: dict[str, Any] = {"centering": "F", "centering_source": SRC, "space_group_source": SRC}
    MaterialRecord("X", "X", "cubic", _cubic(), SRC, space_group="Fd-3m", **kw)
    with pytest.raises(MaterialRecordError, match="does not start with the centering"):
        MaterialRecord("X", "X", "cubic", _cubic(), SRC, space_group="Pm-3m", **kw)


def test_uncited_values_are_refused_never_stored() -> None:
    with pytest.raises(MaterialRecordError, match="has no source"):
        Cited(2.6, "1e-6/K", "")
    with pytest.raises(MaterialRecordError, match="uncited cell"):
        MaterialRecord("X", "X", "cubic", _cubic())
    with pytest.raises(MaterialRecordError, match="centering 'F' has no source"):
        MaterialRecord("X", "X", "cubic", _cubic(), SRC, centering="F")
    with pytest.raises(MaterialRecordError, match="finite"):
        Cited(float("nan"), "", SRC)
    with pytest.raises(MaterialRecordError, match="finite"):
        Cited(True, "", SRC)


def test_elastic_constants_units_and_poisson_range() -> None:
    el = ElasticConstants(c11=Cited(165.0, "GPa", SRC), poisson_ratio=Cited(0.28, "", SRC))
    rec = MaterialRecord("X", "X", "cubic", _cubic(), SRC, elastic=el)
    assert rec.poisson_ratio is not None and rec.poisson_ratio.value == 0.28
    with pytest.raises(MaterialRecordError, match="unit 'Mbar' not accepted"):
        ElasticConstants(c11=Cited(1.65, "Mbar", SRC))
    with pytest.raises(MaterialRecordError, match="outside"):
        ElasticConstants(poisson_ratio=Cited(0.6, "", SRC))
    with pytest.raises(MaterialRecordError, match="must be positive"):
        ElasticConstants(c44=Cited(-1.0, "GPa", SRC))


def test_record_is_frozen() -> None:
    rec = substrate_record("Si(100)")
    with pytest.raises(dataclasses.FrozenInstanceError):
        rec.name = "other"  # type: ignore[misc]


def test_every_phase_database_entry_is_a_valid_record() -> None:
    """The 52 MATLAB phases all pass the system/cell/centering checks."""
    recs = [record_from_phase(p) for p in phase_database()]
    assert len(recs) == 52
    si = recs[0]
    assert si.centering == "F" and si.lattice is not None and si.lattice.a == 5.4309
    assert "ICSD 51688" in (si.lattice_source or "")
    assert si.cte is None and si.elastic is None


# --- substrate migration -----------------------------------------------------------------


def test_substrate_records_carry_the_matlab_values_and_their_source() -> None:
    recs = substrate_records()
    assert len(recs) == 14
    gaas = recs["GaAs(100)"]
    assert gaas.cte == Cited(5.73, "1e-6/K", SUBSTRATE_SOURCE)
    assert gaas.density == Cited(5.317, "g/cm^3", SUBSTRATE_SOURCE)
    assert gaas.dielectric_constant == Cited(12.9, "", SUBSTRATE_SOURCE)
    assert gaas.centering == "F" and "phaseDatabase" in (gaas.centering_source or "")
    assert recs["SiO2/Si"].lattice is None and recs["SiO2/Si"].system == "amorphous"


def test_population_counts_no_value_is_invented() -> None:
    recs = list(substrate_records().values())
    assert sum(r.lattice is not None for r in recs) == 13
    assert sum(r.cte is not None for r in recs) == 14
    assert sum(r.density is not None for r in recs) == 14
    assert sum(r.centering is not None for r in recs) == 10  # LSAT, YSZ, MgAl2O4, SiO2: none
    assert all(r.space_group is None for r in recs)
    assert all(r.elastic is None and r.poisson_ratio is None for r in recs)


def test_table_rows_expose_the_record_and_keep_the_matlab_keys() -> None:
    row = substrate_table()[0]
    assert row["material"] == substrate_record(row["name"]).to_dict()
    assert row["material"]["cte"] == {"value": 2.6, "unit": "1e-6/K", "source": SUBSTRATE_SOURCE}
    assert row["material"]["elastic"]["poisson_ratio"] is None
    api = TestClient(app).get("/api/substrates").json()["substrates"]
    assert api[0]["material"]["lattice_source"] == SUBSTRATE_SOURCE
    one = TestClient(app).get("/api/substrates/Al2O3(0001)").json()
    assert one["material"]["centering"] == "R"


def _baseline() -> dict[str, Any]:
    return json.loads(BASELINE.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@pytest.mark.parametrize("entry", _baseline()["substrates"], ids=lambda e: e["row"]["name"])
def test_every_substrate_derives_the_same_values_as_before(entry: dict[str, Any]) -> None:
    """Exact equality with the pre-record code: rows, indices, nets, mismatch, h_c."""
    base = _baseline()
    name = entry["row"]["name"]
    row = next(r for r in substrate_table() if r["name"] == name)
    assert {k: v for k, v in row.items() if k != "material"} == entry["row"]
    assert substrate_orientation(name) == entry["orientation"]
    if row["a"] is None:
        assert "mismatch" not in entry
        return
    assert lattice_mismatch(base["film_a"], row["a"]) == entry["mismatch"]
    if "critical_thickness" in entry:
        assert critical_thickness(base["film_a"], row["a"], nu=base["nu"]) == entry[
            "critical_thickness"
        ]
    else:
        with pytest.raises(ValueError) as exc:
            critical_thickness(base["film_a"], row["a"], nu=base["nu"])
        assert str(exc.value) == entry["critical_thickness_error"]
