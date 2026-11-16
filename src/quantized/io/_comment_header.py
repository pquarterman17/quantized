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
fit the table exactly: the same column count as the data, every cell
non-empty and non-numeric, and nothing that reads as free text (a
``key: value`` / ``key = value`` pair, a sentence ending in ``.``, a long
phrase). A free-text comment that does not fit stays a comment and the
columns keep their Col1/Col2 names, as before. The line itself is still kept
in ``metadata["comments"]`` -- promotion is additive.

A second comment line of bracketed units (``# (Oe)  (emu)``) under a name
line is read as the units row.

MATLAB parity: ``+parser/importCSV.m`` treats every comment line as preamble
and never names columns from one; this is a deliberate, additive divergence
(PORT_CHECKLIST, generic CSV). Files whose header is not a comment line are
untouched. Pure layer: strings in, strings out.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from quantized.io._delimited_layout import _is_numeric_like, split_row
from quantized.io._delimiter_vote import (
    _COMMA_NUMBER_RE,
    COMMENT_CHARS,
    data_section_start,
    is_section_marker,
)

__all__ = ["CommentHeader", "comment_header", "comment_lines_above_data"]

_PREFIX_RE = re.compile(rf"^[{re.escape(COMMENT_CHARS)}]+\s*")
#: Wider separators first: tabs, or a run of 2+ spaces ("Qz (1/A)  R").
_WIDE_GAP_RE = re.compile(r"\t+|\s{2,}")
_BRACKETED_RE = re.compile(r"^[(\[{].*[)\]}]$")
#: Words that mark a single-space-separated comment as prose, not names.
_PROSE_WORDS = frozenset(
    {
        "by",
        "of",
        "the",
        "at",
        "for",
        "from",
        "with",
        "and",
        "on",
        "to",
        "is",
        "was",
        "are",
        "were",
        "using",
        "via",
        "this",
        "that",
        "file",
        "data",
        "created",
        "generated",
    }
)
#: A header cell longer than this is a phrase, not a column name.
_MAX_CELL = 48


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


def _candidates(body: str, delim: str) -> list[list[str]]:
    """Ways to cut ``body`` into cells, the delimiter's own split first."""
    cands: list[list[str]] = []
    if delim != " ":
        cells = [c.strip() for c in split_row(body, delim)]
        while cells and not cells[-1]:
            cells.pop()  # a trailing delimiter is padding
        cands.append(cells)
    if delim in (" ", "\t"):  # tab and whitespace tables interchange freely
        cands.append([c for c in _WIDE_GAP_RE.split(body) if c])
        words = body.split()
        # Cut at single spaces, a line of prose splits into "names" too
        # ("# generated by numpy" over three columns); a function word gives it away.
        if not any(w.lower() in _PROSE_WORDS for w in words):
            cands.append(_merge_bracketed(words))
            cands.append(words)
    return cands


def _is_name_cell(cell: str) -> bool:
    return (
        bool(cell)
        and len(cell) <= _MAX_CELL
        and not _is_numeric_like(cell)
        and not _COMMA_NUMBER_RE.match(cell)
        and not cell.endswith(":")
    )


def _cells(line: str, delim: str, n_cols: int) -> list[str] | None:
    """``line``'s cells when it reads as one header row of ``n_cols`` names."""
    body = _PREFIX_RE.sub("", line.strip()).strip()
    # Free text, not a header: "key = value", "Sample: x", a sentence.
    if not body or "=" in body or body.endswith(".") or re.search(r":\s", body):
        return None
    for cells in _candidates(body, delim):
        if len(cells) == n_cols and all(_is_name_cell(c) for c in cells):
            return cells
    return None


def _units(line: str, delim: str, n_cols: int) -> list[str] | None:
    """A comment units row: ``n_cols`` cells, every one bracketed."""
    cells = _cells(line, delim, n_cols)
    if cells is None or not all(_BRACKETED_RE.match(c) for c in cells):
        return None
    return [c[1:-1].strip() for c in cells]


def comment_header(lines: Sequence[str], delim: str, n_cols: int) -> CommentHeader | None:
    """Column names from the comment line(s) directly above the data, or ``None``.

    ``lines`` are the file's raw lines; ``delim`` the resolved delimiter;
    ``n_cols`` the data's width. Needs at least two columns: a lone column's
    "header" cannot be told apart from a one-phrase remark.
    """
    if n_cols < 2:
        return None
    block = comment_lines_above_data(lines)
    if not block:
        return None
    if len(block) >= 2:
        units = _units(block[-1], delim, n_cols)
        names = _cells(block[-2], delim, n_cols) if units is not None else None
        if units is not None and names is not None:
            if not all(_BRACKETED_RE.match(n) for n in names):
                return CommentHeader(names, units, block[-2:])
    names = _cells(block[-1], delim, n_cols)
    if names is None or all(_BRACKETED_RE.match(n) for n in names):
        return None
    return CommentHeader(names, [], block[-1:])
