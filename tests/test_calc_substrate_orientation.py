"""``calc.substrate_orientation``: Miller indices parsed from the table labels."""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.substrate_orientation import parse_orientation, substrate_orientation
from quantized.calc.substrates import list_substrates, substrate_table
from quantized.calc.surface_net import surface_net

client = TestClient(app)


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("(100)", [1, 0, 0]),
        ("(111)", [1, 1, 1]),
        ("(0001)", [0, 0, 0, 1]),
        ("(11-20)", [1, 1, -2, 0]),
        ("(1 -1 0)", [1, -1, 0]),
        ("(10, 0, 1)", [10, 0, 1]),
        ("[110]", [1, 1, 0]),
    ],
)
def test_parse_orientation(label: str, expected: list[int]) -> None:
    assert parse_orientation(label) == expected


@pytest.mark.parametrize(
    "label",
    ["", "amorphous", "(10)", "(12345)", "(1 1 1 1)", "(000)", "(1a0)", "100", "(1-)", "(11-2 1)"],
)
def test_unparseable_labels_fail_closed(label: str) -> None:
    with pytest.raises(ValueError):
        parse_orientation(label)


def test_every_table_label_parses_except_the_amorphous_row() -> None:
    for row in substrate_table():
        if row["latticeType"] == "amorphous":
            assert substrate_orientation(row["name"])["hkl"] is None
        else:
            assert parse_orientation(row["orientation"])


def test_si_nets_come_from_the_indices_and_the_phase_centering() -> None:
    s100, s111 = substrate_orientation("Si(100)"), substrate_orientation("Si(111)")
    assert s100["centering"] == "F" and s111["hkl"] == [1, 1, 1]
    a = 5.431
    assert s100["net"]["u"] == pytest.approx(a / math.sqrt(2))
    assert s100["net"]["gamma"] == pytest.approx(90.0)
    assert s111["net"]["gamma"] == pytest.approx(120.0)  # differs from (100): indices matter


def test_sapphire_hkil_and_net() -> None:
    c = substrate_orientation("Al2O3(0001)")
    assert c["hkil"] == [0, 0, 0, 1] and c["net"]["gamma"] == pytest.approx(120.0)
    assert c["net"]["u"] == pytest.approx(4.758)
    a = substrate_orientation("Al2O3(11-20)")
    assert a["hkl"] == [1, 1, 0] and a["hkil"] == [1, 1, -2, 0]
    ref = surface_net(4.758, (1, 1, -2, 0), c=12.991, gamma=120.0, centering="R")
    assert a["net"]["area"] == pytest.approx(ref["area"])


def test_cubic_rows_have_no_hkil() -> None:
    assert substrate_orientation("SrTiO3(100)")["hkil"] is None


def test_no_centering_means_no_net_and_a_reason() -> None:
    r = substrate_orientation("LSAT(100)")
    assert r["hkl"] == [1, 0, 0] and r["net"] is None and r["centering"] is None
    assert "centering" in r["net_note"]
    amorphous = substrate_orientation("SiO2/Si")
    assert amorphous["hkl"] is None and "Amorphous" in amorphous["net_note"]


def test_a_polymorph_with_a_different_lattice_parameter_is_not_borrowed() -> None:
    # Phase "TiO2 rutile"/"anatase" share a formula; none is a substrate row, but the
    # a-agreement guard is what decides, so every table row that gets a net agrees within 1 %.
    from quantized.calc.phase_database import phase_database

    for name in list_substrates():
        r = substrate_orientation(name)
        if r["centering"] is not None:
            row = next(x for x in substrate_table() if x["name"] == name)
            ph = next(p for p in phase_database() if p["formula"] == row["formula"])
            assert abs(ph["a"] - row["a"]) <= 0.01 * row["a"]


def test_route() -> None:
    r = client.get("/api/substrates/al2o3(11-20)/orientation")
    assert r.status_code == 200 and r.json()["hkil"] == [1, 1, -2, 0]
    assert client.get("/api/substrates/nonesuch/orientation").status_code == 404
