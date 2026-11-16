"""Column names written as a COMMENT line directly above the data.

numpy ``savetxt(header=...)``, gnuplot data files and many instrument and
analysis exports write the column header with a comment prefix::

    # Qz (1/A)  R
    0.01 0.772985

    # Raman shift (cm-1)<TAB>Intensity (counts)
    100.000<TAB>177.844

Every ``#``/``%`` line is preamble to the delimited readers
(`_data_section._split_lines`), so such a file imported as Col1/Col2 with no
units (UX audit 8, finding 2). This module recovers the names from the LAST
comment line(s) immediately above the first data line, and only when they
fit the table exactly (`comment_header`):

* the line must have STRUCTURE: the data's own ``,``/``;``/tab delimiter, a
  wide gap of two or more spaces, or bracketed units (``H (Oe) M (emu)``).
  A plain single-spaced line is prose as often as names (``# Hysteresis
  loop``, ``# John Smith``, ``# x y``), so it is never promoted on its own;
* it splits into exactly the data's column count, every cell holding a
  letter and none a number, a date/time, a version (``v1.2``) or a value
  with a unit (``300K``); no ``key: value`` / ``key = value`` pair or
  sentence ending in ``.``;
* it does not read as prose: no function word (``by``, ``of`` ...), no
  all-lowercase phrase (``field cooled``), no ``key<TAB>initials`` pair
  (``Operator<TAB>JS``), and not an all-bracketed units row;
* a units row (every cell bracketed or a known unit) under a STRUCTURED
  name row gives those columns their units: ``# H  M`` over ``# Oe emu`` is
  H [Oe], M [emu]. With no such name row a structured row of unit symbols is
  read as names (``# V  A`` over an I-V curve); ``# K Ohm`` is not.

A comment that fails any of this stays a comment and the columns keep their
Col1/Col2 names, as before. The line itself is still kept in
``metadata["comments"]`` -- promotion is additive. Only the first
`HEAD_CHARS` of a file are searched (direct import and the Import Wizard
alike), so a million-row file is never split a second time.

MATLAB parity: ``+parser/importCSV.m`` treats every comment line as preamble
and never names columns from one; this is a deliberate, additive divergence
(PORT_CHECKLIST, generic CSV). Files whose header is not a comment line are
untouched. Pure layer: strings in, strings out.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from quantized.io._delimited_layout import (
    _UNIT_WORDS,
    _datetime_epoch,
    _is_numeric_like,
    _looks_like_units_row,
    split_row,
)
from quantized.io._delimiter_vote import (
    _COMMA_NUMBER_RE,
    COMMENT_CHARS,
    data_section_start,
    is_section_marker,
)

__all__ = ["HEAD_CHARS", "CommentHeader", "comment_header", "comment_lines_above_data"]

#: How much of the file is searched for the comment block above the data.
HEAD_CHARS = 65536

_PREFIX_RE = re.compile(rf"^[{re.escape(COMMENT_CHARS)}]+\s*")
#: A wide gap: tabs, or a run of 2+ spaces ("Qz (1/A)  R").
_WIDE_GAP_RE = re.compile(r"\t+|\s{2,}")
_BRACKETED_RE = re.compile(r"^[(\[{].*[)\]}]$")
_LETTER_RE = re.compile(r"[^\W\d_]")
#: "v1.2", "2.0.1b": a version, not a column name.
_VERSION_RE = re.compile(r"^v?\d+(?:\.\d+)+[a-z]*$", re.I)
#: "300K", "5 nm", "1.5T": a measured value with its unit, not a name.
_VALUE_UNIT_RE = re.compile(r"^[+-]?\d+(?:[.,]\d+)?\s?[^\W\d_]{1,3}$")
#: Words that mark a comment as prose, not column names.
_PROSE_WORDS = frozenset(
    "a an the by of at for from with and or on in to is was are were using via this "
    "that created generated".split()
)
#: "JS", "J.S.", "J. S.": a person's initials -- the value of an "Operator" key.
_INITIALS_RE = re.compile(r"^(?:[A-Z]{2,3}|(?:[A-Z]\.\s?){1,3})$")
#: A header cell longer than this is a phrase, not a column name.
_MAX_CELL = 48
#: Unit symbols a units row is written in (case-sensitive; `_UNIT_WORDS`
#: adds the spelled-out ones).
_UNIT_SYMBOLS = frozenset(
    "K mK C °C degC Oe kOe G T mT emu emu/g emu/cm3 A/m Ohm ohm Ω mOhm kOhm MOhm "
    "V mV uV µV A mA uA µA nA s ms min h Hz kHz MHz deg ° rad % cm-1 1/cm 1/A 1/Å "
    "Å A^-1 nm um µm mm cm m eV meV keV cps counts a.u. arb. W mW J Pa mbar Torr "
    "sccm g mg".split()
)


@dataclass(frozen=True)
class CommentHeader:
    """Names (and optional units) recovered from comment line(s)."""

    names: list[str]
    units: list[str]  # empty when there is no units line
    lines: list[str]  # the comment line(s) used, stripped, in file order

    def names_with_units(self) -> list[str]:
        """``names`` with any units folded back in as ``"Name (unit)"``."""
        if not self.units:
            return list(self.names)
        return [f"{n} ({u})" if u else n for n, u in zip(self.names, self.units, strict=True)]


def _is_comment(stripped: str) -> bool:
    return bool(stripped) and stripped[0] in COMMENT_CHARS


def comment_lines_above_data(lines: Sequence[str]) -> list[str]:
    """The comment lines directly above the first data line, in file order.

    ``lines`` are the file's raw lines. Blank lines between the comments and
    the data are skipped; any other line (a non-comment header, a
    ``[Section]`` heading) ends the block, so only a header that is itself a
    comment is ever considered. Empty when the first non-blank, non-comment
    line has no comment directly above it.
    """
    start = data_section_start(lines)
    first = None
    for i in range(start, len(lines)):
        stripped = lines[i].strip()
        if stripped and not _is_comment(stripped):
            first = i
            break
    if first is None or is_section_marker(lines[first]):
        return []
    block: list[str] = []
    for i in range(first - 1, start - 1, -1):
        stripped = lines[i].strip()
        if not stripped:
            if block:
                break  # a blank line separates this block from older comments
            continue
        if not _is_comment(stripped):
            break
        block.append(stripped)
    block.reverse()
    return block


def _merge_bracketed(tokens: list[str]) -> list[str]:
    """Whitespace tokens with a ``(unit)``/``[unit]`` glued to the name before
    it: ``["Qz", "(1/A)", "R"]`` -> ``["Qz (1/A)", "R"]``."""
    out: list[str] = []
    depth = 0
    for tok in tokens:
        if out and (depth > 0 or tok[0] in "(["):
            out[-1] = f"{out[-1]} {tok}"
        else:
            out.append(tok)
        depth = max(depth + tok.count("(") + tok.count("[") - tok.count(")") - tok.count("]"), 0)
    return out


def _candidates(body: str, delim: str, *, loose: bool) -> list[list[str]]:
    """Ways to cut ``body`` into cells. Only STRUCTURED cuts (the data's own
    delimiter, a wide gap, bracketed units) unless ``loose``: a single-spaced
    line is prose as often as names."""
    cands: list[list[str]] = []
    if delim != " " and delim in body:
        cells = [c.strip() for c in split_row(body, delim)]
        while cells and not cells[-1]:
            cells.pop()  # a trailing delimiter is padding
        cands.append(cells)
    if delim in (" ", "\t"):  # tab and whitespace tables interchange freely
        if _WIDE_GAP_RE.search(body):
            cands.append([c for c in _WIDE_GAP_RE.split(body) if c])
        words = body.split()
        if any(w[0] in "([" for w in words[1:]):
            cands.append(_merge_bracketed(words))
        if loose:
            cands.append(words)
    return cands


def _is_name_cell(cell: str) -> bool:
    return (
        bool(cell)
        and len(cell) <= _MAX_CELL
        and _LETTER_RE.search(cell) is not None
        and not _is_numeric_like(cell)
        and not _COMMA_NUMBER_RE.match(cell)
        and not cell.endswith(":")
        and not _VERSION_RE.match(cell)
        and not _VALUE_UNIT_RE.match(cell)
        and _datetime_epoch(cell) is None
    )


def _is_unit_cell(cell: str) -> bool:
    return bool(_BRACKETED_RE.match(cell) or cell in _UNIT_SYMBOLS or cell.lower() in _UNIT_WORDS)


def _units_like(cells: list[str]) -> bool:
    """Every cell a unit: the importer's units-row shape (`_looks_like_units_row`)
    AND each cell bracketed or a known unit -- the shape test alone also
    takes any short word ("x", "T", "H") for a unit, which would refuse the
    commonest gnuplot/numpy names."""
    return _looks_like_units_row(cells, len(cells)) and all(_is_unit_cell(c) for c in cells)


def _body(line: str) -> str | None:
    """The comment's text, or ``None`` when it reads as free text."""
    body = _PREFIX_RE.sub("", line.strip()).strip()
    # "key = value", "Sample: x", a sentence.
    if not body or "=" in body or body.endswith(".") or re.search(r":\s", body):
        return None
    return body


def _prose(cells: list[str]) -> bool:
    """Cells that read as a remark, however they were cut: a function word
    ("generated by numpy"), an all-lowercase multi-word phrase without a unit
    ("field cooled"), or a ``key<TAB>initials`` pair ("Operator<TAB>JS")."""
    for cell in cells:
        words = cell.split()
        if any(w in _PROSE_WORDS for w in words):  # lowercase: "In", "A" are names
            return True
        if len(words) >= 2 and not _BRACKETED_RE.search(cell) and "(" not in cell:
            if all(w.isalpha() and w.islower() for w in words):
                return True
    return len(cells) == 2 and len(cells[0]) >= 4 and bool(_INITIALS_RE.match(cells[1]))


def _names(line: str, delim: str, n_cols: int) -> list[str] | None:
    """``line``'s cells when it reads as one STRUCTURED row of ``n_cols``
    column names. Unit symbols are names here (``# V  A`` over an I-V
    curve); only an all-bracketed row (``# (Oe)  (emu)``) is not."""
    body = _body(line)
    if body is None:
        return None
    for cells in _candidates(body, delim, loose=False):
        if len(cells) == n_cols and all(_is_name_cell(c) for c in cells):
            if _prose(cells) or all(_BRACKETED_RE.match(c) for c in cells):
                return None
            return cells
    return None


def _units(line: str, delim: str, n_cols: int) -> list[str] | None:
    """A comment units row: ``n_cols`` cells, every one a unit."""
    body = _body(line)
    if body is None:
        return None
    for cells in _candidates(body, delim, loose=True):
        if len(cells) == n_cols and _units_like(cells):
            return [c[1:-1].strip() if _BRACKETED_RE.match(c) else c for c in cells]
    return None


def comment_header(text: str, delim: str, n_cols: int) -> CommentHeader | None:
    """Column names from the comment line(s) directly above the data, or ``None``.

    ``text`` is the file's text (only its first `HEAD_CHARS` are read);
    ``delim`` the resolved delimiter; ``n_cols`` the data's width. Needs at
    least two columns: a lone column's "header" cannot be told apart from a
    one-phrase remark.
    """
    if n_cols < 2:
        return None
    block = comment_lines_above_data(text.removeprefix("\ufeff")[:HEAD_CHARS].splitlines())
    if not block:
        return None
    units = _units(block[-1], delim, n_cols)
    if units is not None and len(block) >= 2:  # a units row under a name row
        names = _names(block[-2], delim, n_cols)
        if names is not None:
            return CommentHeader(names, units, block[-2:])
    # No name row above: a structured row of unit symbols ("# V  A") names
    # the columns itself; a bracketed or single-spaced one ("# K Ohm") does not.
    names = _names(block[-1], delim, n_cols)
    return CommentHeader(names, [], block[-1:]) if names is not None else None
