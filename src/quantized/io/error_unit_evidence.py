"""UNIT evidence for error-column pairing (plans/LIBRARY_WORKBOOK_UX_PLAN.md,
"Required column-role inference": header, unit, parser-metadata, and
adjacency evidence contribute to a confidence result).

The label rules (``error_inference.py``) decide WHICH value column an error
column most plausibly describes. This module answers one narrower question
about that proposed pair: do the two columns' units agree?

- ``"match"``: both units are known and are the same unit after
  normalising trivial spelling differences -- corroborating evidence.
- ``"mismatch"``: both units are known and differ -- CONTRADICTING evidence.
  An error bar is drawn in its target's axis units with no conversion (a
  binding is a reference, never a rewrite), so an error column in ``K``
  beside a value in ``Oe`` -- or even ``mT`` beside ``T``, or a relative
  ``%`` beside an absolute ``ohm`` -- would plot a confidently wrong bar.
  Callers FAIL CLOSED on this: the pair is never bound.
- ``"unknown"``: either side is blank/unitless/arbitrary, or the two
  spellings differ ONLY in letter case. Neutral -- neither raises nor lowers
  confidence. A blank unit trivially equalling another blank unit is not
  agreement (the same rule ``io/ncnr.py``'s ``_resolves_to_x_axis`` uses).

Case-only differences are neutral rather than a match or a mismatch on
purpose: ``emu``/``EMU`` is almost always one unit typed two ways, but
``mK``/``MK`` and ``mS``/``MS`` are genuinely different units, so letter
case can neither confirm nor refute -- it stays out of the decision.

Normalisation is SPELLING only, never dimensional analysis: ``mT`` and
``T`` are both field units but do not match, for the reason above.

CROSS-LANGUAGE PAIR: ``frontend/src/lib/errorUnitEvidence.ts`` is the
TypeScript twin. Both read ``tests/fixtures/error_labels/
unit_evidence_corpus.json`` (``tests/test_error_unit_evidence_parity_fixture.py``
and ``errorUnitEvidence.test.ts``). Change a rule here and it must change
there too, with a fixture case that pins it.

Pure ``io`` layer -- no fastapi/pydantic imports.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Literal

__all__ = ["UnitEvidence", "compare_units", "normalize_unit"]

UnitEvidence = Literal["match", "mismatch", "unknown"]

# Spellings that say "no physical unit" or "unit not stated". Compared in
# lowercase with every whitespace character removed, after NFKC and
# enclosing-bracket stripping, so "(arb. units)" and "a.u." both land here.
_UNITLESS = frozenset({
    "", "-", "--", "---", "?", "na", "n/a", "none", "nan", "null",
    "1", "unitless", "dimensionless",
    "a.u.", "a.u", "au", "arb", "arb.", "arb.u.", "arb.u", "arb.unit", "arb.units",
    "arbunits", "arbitrary", "arbitraryunits",
})

_ENCLOSERS = {"(": ")", "[": "]", "{": "}"}

# Whole alphabetic words with a symbol spelling. Applied per alphabetic run
# BEFORE whitespace/multiplication marks are removed, so "Ohm cm" maps both
# words ("Ω cm") instead of seeing one merged run "Ohmcm".
_WORDS = {
    "ohm": "Ω", "ohms": "Ω",
    "deg": "°", "degree": "°", "degrees": "°",
    "degc": "°C", "degf": "°F",
    "ang": "Å", "angstrom": "Å", "angstroms": "Å",
    "percent": "%",
}
_ALPHA_RUN_RE = re.compile(r"[A-Za-z]+")
# A prefixed ohm ("mOhm", "kOhm", "uOhm"): keep the prefix, symbolise the rest.
_PREFIXED_OHM_RE = re.compile(r"^([A-Za-z])(?:ohm|ohms)$", re.IGNORECASE)

# Characters with a trivial alternative spelling. NFKC (applied first) has
# already folded the compatibility forms: MICRO SIGN -> GREEK SMALL MU, OHM
# SIGN -> GREEK CAPITAL OMEGA, KELVIN SIGN -> K, ANGSTROM SIGN -> A-RING,
# DEGREE CELSIUS -> "°C", superscript digits/minus -> digits/U+2212.
_CHAR_MAP = str.maketrans({
    "−": "-",  # MINUS SIGN (what NFKC makes of a superscript minus)
    "–": "-",  # EN DASH
    "μ": "u",  # GREEK SMALL MU -> the ASCII micro spelling ("uV")
    "^": None,  # "cm^-3" == "cm-3" == "cm⁻³"
    "*": None,  # multiplication marks: "Ohm*cm" == "Ω·cm" == "ohm cm"
    "·": None,  # MIDDLE DOT
    "⋅": None,  # DOT OPERATOR
    "∙": None,  # BULLET OPERATOR
})
# A hyphen NOT followed by a digit is a multiplication mark ("ohm-cm", "N-m");
# one followed by a digit is an exponent sign ("cm-3") and is kept.
_HYPHEN_PRODUCT_RE = re.compile(r"-(?!\d)")
_WHITESPACE_RE = re.compile(r"\s+")


def _strip_enclosing(s: str) -> str:
    """Drop bracket pairs that wrap the WHOLE string: ``"(K)"``/``"[K]"`` ->
    ``"K"``. A bracket that only wraps part (``"(m/s)^2"``) is kept."""
    while len(s) >= 2 and _ENCLOSERS.get(s[0]) == s[-1]:
        inner = s[1:-1]
        depth = 0
        wraps_whole = True
        for ch in inner:
            if ch == s[0]:
                depth += 1
            elif ch == s[-1]:
                depth -= 1
                if depth < 0:
                    wraps_whole = False
                    break
        if not wraps_whole or depth != 0:
            break
        s = inner.strip()
    return s


def _symbolise_word(match: re.Match[str]) -> str:
    word = match.group(0)
    symbol = _WORDS.get(word.lower())
    if symbol is not None:
        return symbol
    prefixed = _PREFIXED_OHM_RE.match(word)
    if prefixed is not None:
        return prefixed.group(1) + "Ω"
    return word


def normalize_unit(unit: str | None) -> str | None:
    """Canonical spelling of ``unit`` for comparison, or ``None`` when it is
    blank, unitless, or arbitrary (``a.u.``, ``arb. units``, ``-``, ``n/a``).

    Trivial differences removed: surrounding whitespace, a bracket pair
    around the whole unit, Unicode compatibility forms (NFKC), micro
    ``µ``/``μ``/``u``, ``Ω``/``ohm``, ``°``/``deg``, ``Å``/``angstrom``,
    ``%``/``percent``, exponent marks (``cm^-3``/``cm⁻³``/``cm-3``), and
    multiplication marks/spaces (``Ohm*cm``/``Ω·cm``/``ohm cm``/``ohm-cm``).
    Letter case is PRESERVED -- see the module docstring.
    """
    if unit is None:
        return None
    s = _strip_enclosing(unicodedata.normalize("NFKC", unit).strip())
    if _WHITESPACE_RE.sub("", s).lower() in _UNITLESS:
        return None
    s = _ALPHA_RUN_RE.sub(_symbolise_word, s)
    s = _WHITESPACE_RE.sub("", s.translate(_CHAR_MAP))
    s = _HYPHEN_PRODUCT_RE.sub("", s)
    return s or None


def compare_units(error_unit: str | None, value_unit: str | None) -> UnitEvidence:
    """Unit evidence for pairing an error column (``error_unit``) with the
    value column or x axis it would describe (``value_unit``). See the
    module docstring for what each outcome means and why a case-only
    difference is ``"unknown"``."""
    a = normalize_unit(error_unit)
    b = normalize_unit(value_unit)
    if a is None or b is None:
        return "unknown"
    if a == b:
        return "match"
    if a.casefold() == b.casefold():
        return "unknown"
    return "mismatch"
