"""CIF symmetry expansion: synthetic CIF texts, International Tables operators.

Operator lists are symmetry facts (generated here from the point-group
matrices, not read from any file); lattice parameters are placeholders.
"""

from __future__ import annotations

import itertools
from pathlib import Path
from typing import Any

import pytest

from quantized.calc.cif_symmetry import (
    SymmetryError,
    expand_to_cell,
    parse_operator,
)
from quantized.io.cif import import_cif


def oh_ops(centering: tuple[tuple[str, str, str], ...] = (("", "", ""),)) -> list[str]:
    """All 48 signed permutation operators (point group m-3m) x centering."""
    ops = []
    for perm in itertools.permutations("xyz"):
        for signs in itertools.product("+-", repeat=3):
            base = [("-" if s == "-" else "") + p for s, p in zip(signs, perm, strict=True)]
            for shift in centering:
                ops.append(",".join(b + t for b, t in zip(base, shift, strict=True)))
    return ops


F_CENTERING = (("", "", ""), ("", "+1/2", "+1/2"), ("+1/2", "", "+1/2"), ("+1/2", "+1/2", ""))


def cif_text(ops: list[str], sites: list[str], cell: str = "4 4 4 90 90 90") -> str:
    a, b, c, al, be, ga = cell.split()
    head = (
        "data_synthetic\n"
        f"_cell_length_a {a}\n_cell_length_b {b}\n_cell_length_c {c}\n"
        f"_cell_angle_alpha {al}\n_cell_angle_beta {be}\n_cell_angle_gamma {ga}\n"
        "loop_\n_space_group_symop_operation_xyz\n"
    )
    body = "".join(f"'{o}'\n" for o in ops)
    atoms = (
        "loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n"
        "_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\n"
    )
    return head + body + atoms + "\n".join(sites) + "\n"


def load(tmp_path: Path, text: str) -> dict[str, Any]:
    p = tmp_path / "s.cif"
    p.write_text(text, encoding="utf-8")
    return import_cif(p)


def count(cell: Any, symbol: str) -> int:
    return sum(1 for s in cell.sites if s.symbol == symbol)


def has(cell: Any, symbol: str, x: float, y: float, z: float) -> bool:
    for s in cell.sites:
        if s.symbol != symbol:
            continue
        if all(min(abs(u - v), 1 - abs(u - v)) < 1e-9 for u, v in ((s.x, x), (s.y, y), (s.z, z))):
            return True
    return False


def test_rock_salt_fm3m(tmp_path: Path) -> None:
    ops = oh_ops(F_CENTERING)
    assert len(ops) == 192
    parsed = load(tmp_path, cif_text(ops, ["Na1 Na 0 0 0 1", "Cl1 Cl 0.5 0.5 0.5 1"]))
    cell = expand_to_cell(parsed)
    assert (count(cell, "Na"), count(cell, "Cl")) == (4, 4)
    assert cell.n_operators == 192
    for p in ((0, 0, 0), (0, .5, .5), (.5, 0, .5), (.5, .5, 0)):
        assert has(cell, "Na", *p)
    for p in ((.5, .5, .5), (.5, 0, 0), (0, .5, 0), (0, 0, .5)):
        assert has(cell, "Cl", *p)


def test_perovskite_pm3m(tmp_path: Path) -> None:
    sites = ["Sr1 Sr 0 0 0 1", "Ti1 Ti 0.5 0.5 0.5 1", "O1 O 0.5 0.5 0 1"]
    cell = expand_to_cell(load(tmp_path, cif_text(oh_ops(), sites)))
    assert (count(cell, "Sr"), count(cell, "Ti"), count(cell, "O")) == (1, 1, 3)
    assert len(cell.sites) == 5
    assert has(cell, "O", .5, .5, 0) and has(cell, "O", .5, 0, .5) and has(cell, "O", 0, .5, .5)


RUTILE_OPS = [
    "x,y,z", "-x,-y,z", "-y+1/2,x+1/2,z+1/2", "y+1/2,-x+1/2,z+1/2",
    "-x+1/2,y+1/2,-z+1/2", "x+1/2,-y+1/2,-z+1/2", "y,x,-z", "-y,-x,-z",
    "-x,-y,-z", "x,y,-z", "y+1/2,-x+1/2,-z+1/2", "-y+1/2,x+1/2,-z+1/2",
    "x+1/2,-y+1/2,z+1/2", "-x+1/2,y+1/2,z+1/2", "-y,-x,z", "y,x,z",
]


def test_rutile_p42mnm(tmp_path: Path) -> None:
    u = 0.3053  # placeholder O parameter
    text = cif_text(RUTILE_OPS, ["Ti1 Ti 0 0 0 1", f"O1 O {u} {u} 0 1"], "4.6 4.6 3.0 90 90 90")
    cell = expand_to_cell(load(tmp_path, text))
    assert (count(cell, "Ti"), count(cell, "O")) == (2, 4)
    assert has(cell, "Ti", 0, 0, 0) and has(cell, "Ti", .5, .5, .5)
    for p in ((u, u, 0), (1 - u, 1 - u, 0), (.5 + u, .5 - u, .5), (.5 - u, .5 + u, .5)):
        assert has(cell, "O", *p)


C2M = ["x,y,z", "-x,y,-z", "-x,-y,-z", "x,-y,z"]
C_CENT = ["x,y,z", "-x,y,-z", "-x,-y,-z", "x,-y,z",
          "x+1/2,y+1/2,z", "-x+1/2,y+1/2,-z", "-x+1/2,-y+1/2,-z", "x+1/2,-y+1/2,z"]


def test_centered_low_symmetry(tmp_path: Path) -> None:
    sites = ["A1 A 0 0 0 1", "B1 B 0.1 0.2 0.3 0.5"]
    cell = expand_to_cell(load(tmp_path, cif_text(C_CENT, sites)))
    assert count(cell, "A") == 2 and has(cell, "A", .5, .5, 0)
    assert count(cell, "B") == 8
    assert all(s.occupancy == 0.5 for s in cell.sites if s.symbol == "B")
    assert {s.label for s in cell.sites if s.symbol == "B"} == {"B1"}
    assert has(cell, "B", .6, .7, .3) and has(cell, "B", .9, .2, .7)
    # same ops without the centering listed: the centering is NOT invented
    plain = expand_to_cell(load(tmp_path, cif_text(C2M, ["A1 A 0 0 0 1"])))
    assert count(plain, "A") == 1


def test_screw_axis_and_wrap(tmp_path: Path) -> None:
    ops = ["x,y,z", "-x,y+1/2,-z+1/2"]
    cell = expand_to_cell(load(tmp_path, cif_text(ops, ["A1 A 0.9 0.25 0.8 1"])))
    assert has(cell, "A", 0.1, 0.75, 0.7)


def test_near_duplicate_merge_and_distinct_sites_kept(tmp_path: Path) -> None:
    ops = ["x,y,z", "x+1/3,y+2/3,z"]
    text = cif_text(ops, ["A1 A 0.3333 0 0 1", "A2 A 0.6667 0.6667 0 1", "B1 B 0.3333 0 0 0.5"])
    cell = expand_to_cell(load(tmp_path, text), tol=1e-3)
    assert count(cell, "A") == 4  # A1 x2, A2 x2: distinct labels never merge
    assert count(cell, "B") == 2
    one = expand_to_cell(load(tmp_path, cif_text(["x,y,z", "x,y,z+0.0004"], ["A1 A 0 0 0 1"])))
    assert len(one.sites) == 1  # within tol: merged


@pytest.mark.parametrize(
    "bad",
    ["x,y", "x,y,z,w", "2x,y,z", "x/2,y,z", "x,y,z+1/0", "x y z", "u,y,z", "x++y,y,z", "x,y,", ""],
)
def test_unparseable_operator_refused(bad: str) -> None:
    with pytest.raises(SymmetryError):
        parse_operator(bad)


def test_fail_closed_inputs(tmp_path: Path) -> None:
    with pytest.raises(SymmetryError, match="not assuming P1"):
        expand_to_cell({"loops": [], "tags": {}, "atomSites": [{}]})
    parsed = load(tmp_path, cif_text(["x,y,z", "x,y"], ["A1 A 0 0 0 1"]))
    with pytest.raises(SymmetryError, match="x,y"):
        expand_to_cell(parsed)
    nan_site = load(tmp_path, cif_text(["x,y,z"], ["A1 A ? 0 0 1"]))
    with pytest.raises(SymmetryError, match="non-finite"):
        expand_to_cell(nan_site)
    with pytest.raises(SymmetryError, match="tol"):
        expand_to_cell(load(tmp_path, cif_text(["x,y,z"], ["A1 A 0 0 0 1"])), tol=0.5)


def test_parse_forms() -> None:
    rot, t = parse_operator("'-X + 1/2, Y-x, +z+0.25'")
    assert rot == ((-1, 0, 0), (-1, 1, 0), (0, 0, 1))
    assert [float(v) for v in t] == [0.5, 0.0, 0.25]
    assert [float(v) for v in parse_operator("x,y,z+2/3")[1]] == [0, 0, pytest.approx(2 / 3)]
