"""calc.units_data: the DiraCulator units-converter category table.

Every unit string curated in ``UNIT_CATEGORIES`` must be parseable by
``calc.unit_convert`` and must round-trip (value -> unit -> back) to the
original value. The photon-energy category is exempt from the naive
identity round-trip against a shared pivot (each pair is independently
verified in test_calc_unitconvert.py) but every listed unit must still be
individually convertible to/from the category's first unit.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.unit_convert import unit_convert
from quantized.calc.units_data import UNIT_CATEGORIES, UnitCategory


def test_category_ids_are_unique() -> None:
    ids = [cat.id for cat in UNIT_CATEGORIES]
    assert len(ids) == len(set(ids))


def test_every_category_has_at_least_two_units() -> None:
    for cat in UNIT_CATEGORIES:
        assert len(cat.units) >= 2, f"{cat.id} needs >=2 units for a from/to picker"


def test_every_unit_label_is_nonempty() -> None:
    for cat in UNIT_CATEGORIES:
        for u in cat.units:
            assert u.value.strip()
            assert u.label.strip()


# "magnetization" is deliberately excluded from the blanket pivot-vs-first-unit
# round-trip below: emu (moment), emu/cm^3 (volume magnetization), and emu/g
# (mass magnetization) are three physically different quantities that do NOT
# share a dimension -- see test_magnetization_* for its real (partial)
# compatibility structure.
_PIVOT_ROUNDTRIP_CATEGORIES = [c for c in UNIT_CATEGORIES if c.id != "magnetization"]


@pytest.mark.parametrize(
    "cat",
    _PIVOT_ROUNDTRIP_CATEGORIES,
    ids=[c.id for c in _PIVOT_ROUNDTRIP_CATEGORIES],
)
def test_category_units_roundtrip_against_first_unit(cat: UnitCategory) -> None:
    """Every unit in a category must convert to and from the category's first
    unit and recover the original value (within a loose float tolerance —
    some pairs, like Ry<->eV, involve CODATA constants with independent
    rounding, so this is a sanity/reachability check, not a precision one)."""
    pivot = cat.units[0].value
    test_value = 1.0
    for opt in cat.units:
        out, _ = unit_convert(test_value, pivot, opt.value)
        out_val = float(np.asarray(out))
        assert np.isfinite(out_val), f"{cat.id}: {pivot}->{opt.value} produced non-finite"
        back, _ = unit_convert(out_val, opt.value, pivot)
        back_val = float(np.asarray(back))
        assert back_val == pytest.approx(test_value, rel=1e-6, abs=1e-12), (
            f"{cat.id}: {pivot}->{opt.value}->{pivot} did not round-trip "
            f"({test_value} -> {out_val} -> {back_val})"
        )


def test_photon_energy_all_pairs_are_directly_convertible() -> None:
    """The photon-energy category's whole point is that any pair (not just
    eV<->X) converts directly, e.g. nm<->K without pivoting through eV in the
    caller. Assert every ordered pair among its 5 units succeeds."""
    cat = next(c for c in UNIT_CATEGORIES if c.id == "photon_energy")
    units = [u.value for u in cat.units]
    for a in units:
        for b in units:
            if a == b:
                continue
            out, _ = unit_convert(1.0, a, b)
            assert np.isfinite(float(np.asarray(out))), f"{a}->{b} produced non-finite"


def test_photon_energy_category_rejects_nonpositive() -> None:
    cat = next(c for c in UNIT_CATEGORIES if c.id == "photon_energy")
    with pytest.raises(ValueError, match="positive"):
        unit_convert(0.0, cat.units[0].value, cat.units[1].value)


def test_magnetic_field_category_hint_documents_bh_convention() -> None:
    cat = next(c for c in UNIT_CATEGORIES if c.id == "magnetic_field")
    assert cat.hint is not None
    assert "1e4" in cat.hint or "10^4" in cat.hint or "1T" in cat.hint.replace(" ", "")


def test_magnetization_category_documents_the_density_gap() -> None:
    cat = next(c for c in UNIT_CATEGORIES if c.id == "magnetization")
    values = {u.value for u in cat.units}
    assert values == {"emu", "A*m^2", "emu/cm^3", "A/m", "emu/g", "A*m^2/kg"}
    assert cat.hint is not None and "density" in cat.hint


@pytest.mark.parametrize(
    ("from_u", "to_u"),
    [("emu", "A*m^2"), ("emu/cm^3", "A/m"), ("emu/g", "A*m^2/kg")],
)
def test_magnetization_cgs_to_si_pairs_convert(from_u: str, to_u: str) -> None:
    """Each CGS unit DOES convert to its own SI equivalent -- a fixed factor,
    no extra sample data needed."""
    out, _ = unit_convert(1.0, from_u, to_u)
    assert np.isfinite(float(np.asarray(out)))


@pytest.mark.parametrize(
    ("from_u", "to_u"),
    [
        ("emu", "emu/cm^3"),
        ("emu", "emu/g"),
        ("emu/cm^3", "emu/g"),
        ("A*m^2", "A/m"),
        ("A*m^2", "A*m^2/kg"),
    ],
)
def test_magnetization_cross_quantity_pairs_are_rejected(from_u: str, to_u: str) -> None:
    """Moment, volume magnetization, and mass magnetization are physically
    different quantities (they differ by sample volume/mass/density) -- the
    converter must reject cross-conversion rather than silently guessing,
    since it has no second (size) input to do it correctly."""
    with pytest.raises(ValueError, match="incompatible"):
        unit_convert(1.0, from_u, to_u)


def test_all_category_units_parse_without_error() -> None:
    """Belt-and-braces: every single unit string, alone, must be accepted by
    unit_convert (converted to itself) -- catches a typo'd unit string that
    the pairwise roundtrip test might not exercise if it happens to share a
    category with only itself as pivot."""
    for cat in UNIT_CATEGORIES:
        for opt in cat.units:
            out, _ = unit_convert(1.0, opt.value, opt.value)
            assert np.isfinite(float(np.asarray(out)))
