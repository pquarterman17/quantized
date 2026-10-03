"""How a unit string is SPELLED in an axis title or legend.

Files and parsers write exponents in ASCII ("cm^-1", "cm-1", "emu/cm3",
"Ang^-1"), and the axis title used to print them verbatim on the canvas and
in the SVG/PDF export alike. `display_unit` turns the unambiguous spellings
into the typographic form (cm⁻¹, emu/cm³, Å⁻¹) with Unicode superscripts,
which every renderer draws the same way: no mathtext, no font switch.

Display only: the DataStruct keeps the unit its file wrote (golden parity,
unit conversion and the recipe/peak-table unit checks all read the raw
string). The screen leg is ``frontend/src/lib/unitDisplay.ts``; both read the
cases in ``tests/fixtures/wire/unit_display.json``.

Rules, applied in order and only when the unit has no ``$`` (a mathtext unit
is already typeset):

1. ``Ang`` / ``Angstrom(s)`` as a whole word -> ``Å``.
   A bare ``A`` is left alone: it is the ampere as often as the Ångström,
   so only a parser that knows its file's convention may map it.
2. ``^n`` / ``^{n}`` with a signed integer ``n`` -> superscript digits.
3. A letter run directly followed by ONE signed digit and then a non-word
   character or the end ("cm-1", "cm3", "A2") -> superscript. The run must
   not follow a digit, so scientific notation ("1e-6") is untouched, and a
   multi-digit tail ("Pt100") or a following letter ("mmH2O") is not an
   exponent.

Pure: stdlib only, safe to import from ``io/`` and ``calc/``.
"""

from __future__ import annotations

import re

__all__ = ["display_unit", "with_unit"]

_SUPERSCRIPT = str.maketrans("0123456789+-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻")

# Each pattern mirrors unitDisplay.ts character for character; re.ASCII gives
# \b \w \d their JavaScript (ASCII) meaning and IGNORECASE matches its /i.
_ANGSTROM = re.compile(r"\bang(?:stroms?)?\b", re.ASCII | re.IGNORECASE)
_CARET = re.compile(r"\^\{?([+-]?\d+)\}?(?![\d.])", re.ASCII)
_BARE = re.compile(r"(?<![\w.])([a-zµÅ]+)(-?[1-9])(?![\w.^])", re.ASCII | re.IGNORECASE)


def display_unit(unit: str) -> str:
    """The axis-title spelling of ``unit`` (see the module rules)."""
    if "$" in unit:
        return unit
    out = _ANGSTROM.sub("Å", unit)
    out = _CARET.sub(lambda m: m.group(1).translate(_SUPERSCRIPT), out)
    return _BARE.sub(lambda m: m.group(1) + m.group(2).translate(_SUPERSCRIPT), out)


def with_unit(label: str, unit: str) -> str:
    """``"label (unit)"`` with the unit in its display spelling, else ``label``."""
    return f"{label} ({display_unit(unit)})" if unit else label
