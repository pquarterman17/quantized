"""UNIT evidence for error-column pairing (``io/error_unit_evidence.py``):
spelling normalisation and the match / mismatch / unknown comparison that
``io/error_binding_confidence.py`` grades pairings with."""

from __future__ import annotations

import pytest

from quantized.io.error_unit_evidence import compare_units, normalize_unit

# Each group is ONE unit spelled trivially differently -- all must normalise
# to the same canonical string and therefore compare as "match".
_SAME_UNIT_SPELLINGS = [
    ["K", " K ", "(K)", "[K]", "{K}", "((K))", "K"],  # KELVIN SIGN
    ["µV", "μV", "uV", "(µV)"],  # MICRO SIGN / GREEK MU / ASCII u
    ["Ω", "Ω", "ohm", "Ohm", "ohms", "OHM"],  # OHM SIGN / OMEGA / words
    ["mOhm", "mΩ", "mΩ", "mohms"],
    ["Ohm*cm", "Ω·cm", "ohm cm", "ohm-cm", "Ω⋅cm", "Ohm cm"],
    ["cm^-3", "cm⁻³", "cm-3", "cm−3", "cm ^ -3"],
    ["emu/g", "emu / g", "[emu/g]"],
    ["deg", "°", "degrees", "Degree"],
    ["°C", "degC", "℃", "deg C"],
    ["Å", "Å", "Angstrom", "angstroms", "Ang"],
    ["A m^2", "A·m²", "A*m^2"],
    ["%", "percent", "(%)"],
]


@pytest.mark.parametrize("spellings", _SAME_UNIT_SPELLINGS, ids=lambda g: g[0])
def test_trivial_spelling_differences_normalise_to_one_unit(spellings: list[str]) -> None:
    canonical = {normalize_unit(s) for s in spellings}
    assert len(canonical) == 1 and None not in canonical, canonical
    for a in spellings:
        for b in spellings:
            assert compare_units(a, b) == "match", (a, b)


@pytest.mark.parametrize(
    "unit",
    [None, "", "   ", "-", "--", "?", "n/a", "NA", "none", "1", "a.u.", "(a.u.)",
     "arb. units", "[arb.u.]", "Arbitrary Units", "unitless", "dimensionless", "()"],
)
def test_blank_unitless_and_arbitrary_units_are_unknown(unit: str | None) -> None:
    assert normalize_unit(unit) is None
    assert compare_units(unit, "K") == "unknown"
    assert compare_units("K", unit) == "unknown"
    # Two blanks never "agree": an empty string equalling another empty
    # string is not evidence of anything.
    assert compare_units(unit, unit) == "unknown"


@pytest.mark.parametrize(
    ("error_unit", "value_unit"),
    [
        ("K", "Oe"),  # the headline case: an "error" in K beside a value in Oe
        ("mT", "T"),  # same dimension, different scale -- bars would be 1000x off
        ("%", "ohm"),  # a RELATIVE error is not an absolute error bar
        ("emu", "emu/g"),
        ("s", "ms"),
        ("cm-3", "cm-2"),
        ("counts", "cps"),
    ],
)
def test_different_known_units_are_a_mismatch(error_unit: str, value_unit: str) -> None:
    assert compare_units(error_unit, value_unit) == "mismatch"
    assert compare_units(value_unit, error_unit) == "mismatch"


@pytest.mark.parametrize(("a", "b"), [("emu", "EMU"), ("Oe", "OE"), ("mK", "MK"), ("mS", "MS")])
def test_a_case_only_difference_is_neutral_not_a_match_or_a_mismatch(a: str, b: str) -> None:
    """``emu``/``EMU`` is usually one unit typed twice, but ``mK``/``MK`` is
    not -- letter case can neither confirm nor refute a pairing."""
    assert normalize_unit(a) != normalize_unit(b)
    assert compare_units(a, b) == "unknown"


def test_a_bracket_that_wraps_only_part_of_the_unit_is_kept() -> None:
    assert normalize_unit("(m/s)^2") == "(m/s)2"
    assert normalize_unit("(a)(b)") == "(a)(b)"
    assert compare_units("(m/s)^2", "m/s") == "mismatch"


def test_an_exponent_hyphen_is_kept_while_a_product_hyphen_is_dropped() -> None:
    assert normalize_unit("K-1") == "K-1"
    assert normalize_unit("N-m") == "Nm"
    assert compare_units("K-1", "K") == "mismatch"
