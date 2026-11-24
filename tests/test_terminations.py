"""Layer / termination / polarity analysis on synthetic cells (symmetry facts)."""

from __future__ import annotations

import math
from pathlib import Path

import pytest

from _cif_synth import F_CENTERING, cif_text, oh_ops
from quantized.calc.cif_symmetry import expand_to_cell
from quantized.calc.terminations import StackAnalysis, analyze_stack, cif_charges
from quantized.io.cif import import_cif

A = 4.0  # placeholder lattice parameter
CELL = {"a": A, "b": A, "c": A, "alpha": 90.0, "beta": 90.0, "gamma": 90.0}
STO = ["Sr1 Sr 0 0 0 1", "Ti1 Ti 0.5 0.5 0.5 1", "O1 O 0.5 0.5 0 1"]
Q = {"Sr": 2.0, "Ti": 4.0, "O": -2.0}


def sto(tmp_path: Path, extra: str = "") -> tuple[dict, object]:  # type: ignore[type-arg]
    text = cif_text(oh_ops(), STO)
    if extra:
        text = text.replace("loop_\n_atom_site_label", extra + "loop_\n_atom_site_label", 1)
    p = tmp_path / "s.cif"
    p.write_text(text, encoding="utf-8")
    parsed = import_cif(p)
    return parsed, expand_to_cell(parsed)


def test_sto_001_terminations(tmp_path: Path) -> None:
    _, cell = sto(tmp_path)
    r = analyze_stack(cell, CELL, (0, 0, 1), Q)  # type: ignore[arg-type]
    assert r.d_hkl == pytest.approx(A)
    assert [ly.formula for ly in r.layers] == ["SrO", "TiO2"]
    assert [t.formula for t in r.terminations] == ["SrO", "TiO2"]
    assert r.layers[0].composition["Sr"] == pytest.approx(1 / A**2)
    assert r.layers[1].composition["O"] == pytest.approx(2 / A**2)
    assert r.layers[1].position == pytest.approx(A / 2)
    assert all(ly.gap_to_next == pytest.approx(A / 2) for ly in r.layers)
    assert r.polar is False and "type 1" in r.polarity
    assert [ly.charge for ly in r.layers] == [pytest.approx(0.0, abs=1e-9)] * 2


def test_no_charges_never_invented(tmp_path: Path) -> None:
    _, cell = sto(tmp_path)
    r = analyze_stack(cell, CELL, (0, 0, 1))  # type: ignore[arg-type]
    assert r.polarity == "unknown: no charges given" and r.polar is None
    assert all(t.polar is None and t.dipole is None for t in r.terminations)
    assert all(ly.charge is None for ly in r.layers)
    r2 = analyze_stack(cell, CELL, (0, 0, 1), {"Sr": 2.0})  # type: ignore[arg-type]
    assert r2.polarity.startswith("unknown: no charge given for Ti")
    bad = analyze_stack(cell, CELL, (0, 0, 1), {"Sr": 2.0, "Ti": 4.0, "O": -1.0})  # type: ignore[arg-type]
    assert "neutral" in bad.polarity and bad.polar is None


def test_sto_111_polar(tmp_path: Path) -> None:
    _, cell = sto(tmp_path)
    r = analyze_stack(cell, CELL, (1, 1, 1), Q)  # type: ignore[arg-type]
    assert r.d_hkl == pytest.approx(A / math.sqrt(3))
    assert [ly.formula for ly in r.layers] == ["SrO3", "Ti"]
    assert r.layers[0].charge == pytest.approx(-4 / (math.sqrt(3) * A**2))
    assert r.layers[1].charge == pytest.approx(4 / (math.sqrt(3) * A**2))
    assert r.layers[1].position == pytest.approx(r.d_hkl / 2)
    assert r.polar is True and "type 3" in r.polarity
    assert all(t.polar for t in r.terminations)


def test_sto_110_and_hkl_reduction(tmp_path: Path) -> None:
    _, cell = sto(tmp_path)
    r = analyze_stack(cell, CELL, (2, 2, 0), Q)  # type: ignore[arg-type]
    assert r.hkl == (1, 1, 0) and r.given_hkl == (2, 2, 0)
    assert sorted(ly.formula for ly in r.layers) == ["O", "SrTiO"]
    assert r.polar is True


def test_charges_from_cif(tmp_path: Path) -> None:
    extra = (
        "loop_\n_atom_type_symbol\n_atom_type_oxidation_number\n"
        "Sr 2\nTi 4\nO -2\n"
    )
    parsed, cell = sto(tmp_path, extra)
    assert cif_charges(parsed) == Q
    assert analyze_stack(cell, CELL, (0, 0, 1), cif_charges(parsed)).polar is False  # type: ignore[arg-type]
    plain, _ = sto(tmp_path)
    assert cif_charges(plain) == {}


def test_symbol_suffix_charges(tmp_path: Path) -> None:
    sites = ["Sr1 Sr2+ 0 0 0 1", "Ti1 Ti4+ 0.5 0.5 0.5 1", "O1 O2- 0.5 0.5 0 1"]
    p = tmp_path / "s.cif"
    p.write_text(cif_text(oh_ops(), sites), encoding="utf-8")
    parsed = import_cif(p)
    ch = cif_charges(parsed)
    assert ch == {"Sr2+": 2.0, "Ti4+": 4.0, "O2-": -2.0}
    r = analyze_stack(expand_to_cell(parsed), CELL, (1, 1, 1), ch)
    assert r.polar is True


def test_rock_salt_111_alternating_polar(tmp_path: Path) -> None:
    sites = ["Na1 Na 0 0 0 1", "Cl1 Cl 0.5 0.5 0.5 1"]
    p = tmp_path / "s.cif"
    p.write_text(cif_text(oh_ops(F_CENTERING), sites), encoding="utf-8")
    cell = expand_to_cell(import_cif(p))
    r = analyze_stack(cell, CELL, (1, 1, 1), {"Na": 1.0, "Cl": -1.0})
    assert sorted(ly.formula for ly in r.layers) == ["Cl", "Na"]
    assert r.polar is True
    r001 = analyze_stack(cell, CELL, (0, 0, 1), {"Na": 1.0, "Cl": -1.0})
    assert r001.polar is False and [ly.formula for ly in r001.layers] == ["NaCl", "NaCl"]


def test_type2_fluorite_111(tmp_path: Path) -> None:
    # F-centered, Ca at 0, F at (1/4,1/4,1/4)+(3/4,3/4,3/4): O-Ca-O trilayers
    ops = oh_ops(F_CENTERING)
    sites = ["Ca1 Ca 0 0 0 1", "F1 F 0.25 0.25 0.25 1"]
    p = tmp_path / "s.cif"
    p.write_text(cif_text(ops, sites), encoding="utf-8")
    cell = expand_to_cell(import_cif(p))
    assert len(cell.sites) == 12
    r = analyze_stack(cell, CELL, (1, 1, 1), {"Ca": 2.0, "F": -1.0})
    assert [ly.formula for ly in r.layers] == ["Ca", "F", "F"]
    assert r.polar is False and "type 2" in r.polarity
    assert sum(1 for t in r.terminations if not t.polar) == 1


def test_invalid_input(tmp_path: Path) -> None:
    _, cell = sto(tmp_path)
    with pytest.raises(ValueError, match="hkl"):
        analyze_stack(cell, CELL, (0, 0, 0))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="layer_tol"):
        analyze_stack(cell, CELL, (0, 0, 1), layer_tol=0.0)  # type: ignore[arg-type]


def test_wraparound_layer_merge(tmp_path: Path) -> None:
    # atoms straddling the cell boundary along z form ONE layer
    p = tmp_path / "s.cif"
    sites = ["A1 A 0 0 0.995 1", "B1 B 0.5 0.5 0.005 1"]
    p.write_text(cif_text(["x,y,z"], sites), encoding="utf-8")
    cell = expand_to_cell(import_cif(p))
    r: StackAnalysis = analyze_stack(cell, CELL, (0, 0, 1))
    assert len(r.layers) == 1 and r.layers[0].formula == "AB"
