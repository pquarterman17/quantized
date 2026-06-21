"""CIF parser: golden parity vs MATLAB +calc/importCIF."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from quantized.io.cif import import_cif

FIXTURE = Path(__file__).parent / "fixtures" / "SrTiO3.cif"


@pytest.mark.golden
def test_cif_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_cif.json")
    result = import_cif(FIXTURE)
    got = {
        "blockName": result["blockName"],
        "spaceGroup": result["spaceGroup"],
        "formula": result["formula"],
        "cellParams": result["cellParams"],
        "atomSites": result["atomSites"],
    }
    compare_calc(got, g["output"])


def test_cif_cell_params_strip_uncertainty() -> None:
    r = import_cif(FIXTURE)
    assert r["cellParams"]["a"] == pytest.approx(3.905)  # '3.905(2)' -> 3.905
    assert r["cellParams"]["alpha"] == pytest.approx(90.0)
    assert r["blockName"] == "SrTiO3"
    assert r["spaceGroup"] == "Pm-3m"
    assert r["formula"] == "Sr Ti O3"


def test_cif_atom_sites() -> None:
    r = import_cif(FIXTURE)
    sites = r["atomSites"]
    assert len(sites) == 3
    assert [s["symbol"] for s in sites] == ["Sr", "Ti", "O"]
    ti = sites[1]
    assert ti["label"] == "Ti1"
    assert ti["x"] == pytest.approx(0.5)
    assert ti["occupancy"] == pytest.approx(1.0)


def test_cif_loops_structure() -> None:
    r = import_cif(FIXTURE)
    assert len(r["loops"]) == 1
    loop = r["loops"][0]
    assert "_atom_site_label" in loop["tags"]
    assert len(loop["data"]) == 3  # three atom rows
    assert len(loop["data"][0]) == len(loop["tags"])  # rectangular


def test_cif_comment_and_quotes_handled() -> None:
    # The leading '# ...' comment line and quoted formula/space-group are parsed.
    r = import_cif(FIXTURE)
    assert r["tags"]["_chemical_formula_sum"] == "Sr Ti O3"
    assert "_cell_length_a" in r["tags"]
