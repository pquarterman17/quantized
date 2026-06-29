"""Chemical formula parser + molar mass (calc.formula).

Parsing is asserted exactly; molar masses are checked against the element_data
table values themselves (so the test exercises the parser, not the table).
"""

from __future__ import annotations

import pytest

from quantized.calc.element_data import by_symbol
from quantized.calc.formula import formula_mass, parse_formula


def test_simple_water() -> None:
    assert parse_formula("H2O") == {"H": 2.0, "O": 1.0}


def test_multi_element() -> None:
    assert parse_formula("CaCO3") == {"Ca": 1.0, "C": 1.0, "O": 3.0}


def test_trailing_count() -> None:
    assert parse_formula("Al2O3") == {"Al": 2.0, "O": 3.0}


def test_nested_group_with_multiplier() -> None:
    assert parse_formula("Ca(OH)2") == {"Ca": 1.0, "O": 2.0, "H": 2.0}


def test_nested_group_compound() -> None:
    # Mg3(PO4)2 → Mg3 P2 O8
    assert parse_formula("Mg3(PO4)2") == {"Mg": 3.0, "P": 2.0, "O": 8.0}


def test_fractional_count() -> None:
    assert parse_formula("Fe0.95O") == {"Fe": 0.95, "O": 1.0}


def test_mass_matches_table() -> None:
    expected = 2 * by_symbol("H")["mass"] + by_symbol("O")["mass"]
    assert formula_mass("H2O") == pytest.approx(expected)


def test_mass_nacl() -> None:
    expected = by_symbol("Na")["mass"] + by_symbol("Cl")["mass"]
    assert formula_mass("NaCl") == pytest.approx(expected)


def test_mass_group() -> None:
    expected = by_symbol("Ca")["mass"] + 2 * (by_symbol("O")["mass"] + by_symbol("H")["mass"])
    assert formula_mass("Ca(OH)2") == pytest.approx(expected)


def test_empty_raises() -> None:
    with pytest.raises(ValueError, match="empty"):
        parse_formula("   ")


def test_unknown_symbol_raises() -> None:
    with pytest.raises(ValueError, match="not found"):
        formula_mass("Xx2O3")


def test_leading_number_raises() -> None:
    with pytest.raises(ValueError, match="must follow"):
        parse_formula("2H2O")


def test_unbalanced_parens_raise() -> None:
    with pytest.raises(ValueError, match="unbalanced"):
        parse_formula("Ca(OH2")
    with pytest.raises(ValueError, match="unbalanced"):
        parse_formula("CaOH)2")


def test_stray_character_raises() -> None:
    with pytest.raises(ValueError, match="unexpected"):
        parse_formula("Na-Cl")
