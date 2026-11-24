"""Moment / magnetization unit families, shared by the derived-quantity and
series-comparison modules so they cannot disagree about what a unit is.

Built on :mod:`magnetometry_normalization` (``BASIS_OUTPUT_UNITS`` and
``OUTPUT_PER_EMU``); nothing here is a new physical factor.
"""

from __future__ import annotations

from .magnetometry_normalization import BASIS_OUTPUT_UNITS, OUTPUT_PER_EMU

__all__ = ["FAMILY_NAME", "canonical_unit", "unit_family"]

_ALIASES = {"emu/cm3": "emu/cm³", "emu/cm2": "emu/cm²", "A m^2": "A·m²", "Am2": "A·m²"}
_FAMILY = {unit: basis for basis, units in BASIS_OUTPUT_UNITS.items() for unit in units}

FAMILY_NAME = {
    "none": "total moment", "mass": "per mass", "volume": "per volume", "area": "per area",
}


def canonical_unit(unit: str) -> str:
    """The unit with common ASCII spellings mapped to the table's spelling."""
    u = unit.strip()
    return _ALIASES.get(u, u)


def unit_family(unit: str) -> str | None:
    """"none" | "mass" | "volume" | "area" for a known unit, else ``None``."""
    u = canonical_unit(unit)
    return _FAMILY[u] if u in OUTPUT_PER_EMU else None
