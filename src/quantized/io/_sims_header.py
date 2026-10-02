"""SIMS header reading: row scoring, the x-axis name/unit, a names + units pair.

Split out of :mod:`quantized.io.sims` (module ceiling). Pure: strings in,
strings/floats out.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from quantized.io import _delimited_layout as layout
from quantized.time_units import TIME_UNIT_CANON

_BARE_UNIT_RE = re.compile(r"^\(([^)]+)\)$")
_PAREN_RE = re.compile(r"(.+?)\s*\(([^)]+)\)\s*$")
_BRACK_RE = re.compile(r"(.+?)\s*\[([^\]]+)\]\s*$")


def _numeric_score(row: Sequence[str]) -> float:
    """Fraction of ``row``'s cells that are numeric -- SIMS-specific twin of
    ``_delimited_layout._numeric_score``, not a byte-for-byte duplicate:

    * shares the D5 fix (``_is_numeric_like``, so a "nan" cell counts as
      numeric rather than silently mis-scoring the row it's in -- the same
      class of bug, now fixed here too);
    * but deliberately does NOT also try ``_datetime_epoch`` the way the
      shared version does. A SIMS vendor preamble routinely carries a bare
      date line (``"03/18/2026"``, see ``tests/fixtures/sims_barrier.csv``)
      several rows above the real header; scoring that single-cell row as
      100% "numeric" via datetime detection would make `_detect_layout`
      mistake the preamble for the data region. Delimited lab-instrument
      exports legitimately have date/time X columns and want that credit;
      a depth-profile preamble never should.
    """
    if not row:
        return 0.0
    return sum(1 for t in row if layout._is_numeric_like(t.strip())) / len(row)


# Whole words only: a bare substring test read the "um" in a vendor banner's
# "Num of Cycles" line as micrometres, labelling an nm profile 1000x off.
_UM_RE = re.compile(r"(?<![a-z])(?:um|µm|μm|microns?|micromet(?:er|re)s?)(?![a-z])")
_NM_RE = re.compile(r"(?<![a-z])(?:nm|nanomet(?:er|re)s?)(?![a-z])")


def _length_unit_in(text: str) -> str | None:
    low = text.lower()
    if _UM_RE.search(low):
        return "um"
    if _NM_RE.search(low):
        return "nm"
    if "angstrom" in low or "Å" in text:
        return "A"
    return None


def _detect_depth_unit(col_headers: Sequence[str], header_meta: Sequence[str]) -> str:
    """The column headers' own unit wins over a word in the vendor banner."""
    for text in (" ".join(col_headers), " ".join(header_meta)):
        unit = _length_unit_in(text)
        if unit is not None:
            return unit
    return "nm"


_UNIT_WORDS = {"counts", "cps", "c/s", "arb", "a.u.", "au", "nm", "um", "s", "sec", "min"}


def _is_unit_cell(cell: str) -> bool:
    c = cell.strip()
    return bool(_BARE_UNIT_RE.match(c)) or "/" in c or "%" in c or c.lower() in _UNIT_WORDS


def _two_row_header(tokens: Sequence[Sequence[str]], header_row: int) -> list[str] | None:
    """Merge a names row and the units row under it into ``"name (unit)"`` cells.

    Raw-count exports put species on one row and ``counts/sec`` (or ``(nm)``)
    on the next; the units row alone then stood in for the names. ``None`` when
    the header row is not a units-only row under a multi-cell names row.
    """
    if header_row < 1:
        return None
    units, names = list(tokens[header_row]), list(tokens[header_row - 1])
    filled = [u for u in units if u.strip()]
    if not filled or not all(_is_unit_cell(u) for u in filled):
        return None
    if sum(1 for n in names if n.strip()) < max(2, len(filled)) or _numeric_score(names) >= 0.5:
        return None
    names = (names + [""] * len(units))[: len(units)]
    out: list[str] = []
    for name, unit in zip(names, units, strict=True):
        bare = _BARE_UNIT_RE.match(unit.strip())
        u = bare.group(1).strip() if bare else unit.strip()
        n = name.strip()
        out.append(f"{n} ({u})" if n and u else n or unit.strip())
    return out


#: A cycle-count x axis ("Cycle", "Cycles", "Cycle #"): never a depth.
_CYCLE_NAME_RE = re.compile(r"^\s*cycles?(?:\s*(?:no\.?|number|#))?\s*$", re.IGNORECASE)


def _is_cycle_axis(x_header: str) -> bool:
    m = _PAREN_RE.match(x_header.strip()) or _BRACK_RE.match(x_header.strip())
    return bool(_CYCLE_NAME_RE.match(m.group(1) if m else x_header))


#: The header NAME (with any unit stripped) must be time-like -- "time",
#: bare "t", or "sputter time" (any amount of whitespace), case-insensitive.
#: Without this, any first header ending in a recognized time unit's
#: parenthesized/bracketed spelling -- "Cycle (s)", "Scan(s)" -- was read as
#: a raw sputter-TIME axis just because "(s)" parses as seconds; a depth
#: profile whose header happens to end in "(s)" for an unrelated reason (a
#: cycle count, a scan number) must NOT be mislabelled "Time".
_TIME_NAME_RE = re.compile(r"^\s*(?:t|time|sputter\s+time)\s*$", re.IGNORECASE)


def _detect_time_axis(x_header: str) -> str | None:
    """The x axis's time unit when its header names sputter TIME, else None.

    Not in MATLAB's ``importSIMS`` (which only reads depth-axis profiles and
    labels any x "Depth" in nm): a quantized extension so a raw time-axis
    export reaches depth calibration labelled as what it is. ``"Time (s)"`` /
    ``"Sputter time [min]"`` / ``"t (s)"`` give their unit; a bare ``"Time"``
    gives ``""`` (unit unknown -- calibration then asks for it rather than
    guessing seconds). The header NAME itself must be time-like -- a unit
    alone is not enough, so ``"Cycle (s)"`` or ``"Scan(s)"`` are never
    mistaken for a time axis just because seconds happens to parse.
    """
    h = x_header.strip()
    unit = ""
    m = _PAREN_RE.match(h) or _BRACK_RE.match(h)
    if m:
        h, unit = m.group(1).strip(), m.group(2).strip()
    if not _TIME_NAME_RE.match(h):
        return None
    if not unit:
        return ""
    return TIME_UNIT_CANON.get(unit.lower())
