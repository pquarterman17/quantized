"""Delimiter detection for the delimited-text readers.

Split out of :mod:`quantized.io._delimited_layout` (which sat at 499 of its
500 lines) when the vote gained its empty-cell handling: the vote, its two
tie-break rules and the sample it votes on are one concern, and every
delimited reader (``delimited``, ``import_parse``, ``sims``, ``qd``,
``lakeshore``) reaches it through ``_delimited_layout._detect_delimiter``,
which re-exports it unchanged.

Pure layer: strings in -> a delimiter character out.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

#: Lines starting with one of these are preamble comments, never data. The
#: one definition :mod:`quantized.io.delimited` and the vote sample share.
COMMENT_CHARS = "#%"

# Shared across every delimited-text reader (delimited.py, sims.py, qd.py,
# lakeshore.py): a `,`/tab/`;`/space plurality vote over the first 10 lines.
_DELIM_CANDIDATES = (",", "\t", ";", " ")

#: A number written with a comma: a decimal comma ("1,5", "-0,25", "1,5E-3",
#: "1.234,5") or, indistinguishably, a thousands separator ("1,500").
_COMMA_NUMBER_RE = re.compile(r"^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d*),\d+(?:[eE][+-]?\d+)?$")


def vote_lines(text: str) -> list[str]:
    """The lines the delimiter vote samples: every non-blank, non-comment
    line, NOT stripped.

    Stripping before the vote erased a trailing EMPTY CELL: Excel copies
    ``"-500<TAB>-0.93<TAB>"`` for a blank last cell, and the stripped line
    had one tab where every other line had two. That single line made the
    tab count look ragged, the whitespace count won the vote, and every
    multi-word header ("Kerr Signal") fragmented into separate columns. The
    line terminators are already gone (``str.splitlines``), so nothing but
    real cell padding is left to count.
    """
    out: list[str] = []
    for raw in text.removeprefix("﻿").splitlines():
        stripped = raw.strip()
        if stripped and stripped[0] not in COMMENT_CHARS:
            out.append(raw)
    return out


def _delimiter_count(line: str, ch: str) -> int:
    """How many separators ``ch`` contributes to ``line``. A space separator
    is a RUN of whitespace (fixed-width exports pad to align columns), so it
    counts gaps between fields, not individual space characters."""
    if ch == " ":
        return max(len(line.split()) - 1, 0)
    return line.count(ch)


def _tab_over_space(lines: Sequence[str]) -> bool:
    """Whether a whitespace-voted sample is really tab-delimited.

    Every line carries at least one tab and the first line (the header) the
    most: a tab export whose text cells hold spaces ("Kerr Signal",
    "Smith, J") outvotes its own tabs when counted as whitespace runs, and a
    writer that drops trailing empty cells leaves some rows with fewer tabs
    than the header -- so neither an equal-count nor a per-line majority
    rule can see it. A whitespace-aligned file has no tabs on some line, or
    a header with fewer tabs than a data row, and keeps the space vote.
    """
    tabs = [ln.count("\t") for ln in lines]
    return bool(tabs) and min(tabs) >= 1 and tabs[0] == max(tabs)


def _detect_delimiter(raw_lines: Sequence[str]) -> str:
    """Pick the delimiter whose per-line count is both present on every
    sampled line and least variable -- a plurality vote, not a strict
    majority, so a ragged preamble line doesn't disqualify the real
    delimiter by itself (see the ``std < mean * 0.5`` consistency check).
    Defaults to comma when nothing qualifies (e.g. every candidate is
    absent from at least one of the first 10 lines). A comma win is handed
    to ``;`` when the sample is ``;``-delimited decimal-comma data
    (`_semicolon_over_comma`), and a whitespace win to tab when the sample
    is a tab export with spaces inside its cells (`_tab_over_space`)."""
    test = raw_lines[:10]
    best_delim = ","
    best_score = 0.0
    for ch in _DELIM_CANDIDATES:
        counts = [_delimiter_count(line, ch) for line in test]
        if counts and all(c > 0 for c in counts):
            mean = sum(counts) / len(counts)
            std = (sum((c - mean) ** 2 for c in counts) / len(counts)) ** 0.5
            if std < mean * 0.5 and mean > best_score:
                best_score = mean
                best_delim = ch
    if best_delim == "," and _semicolon_over_comma(test):
        return ";"
    if best_delim == " " and _tab_over_space(test):
        return "\t"
    return best_delim


def _semicolon_over_comma(lines: Sequence[str]) -> bool:
    """Whether a comma-voted sample is really ``;``-delimited decimal-comma data.

    A headerless ``"1,5;2,5"`` file has more commas than semicolons, so the
    plain vote picked ``","``. Narrow on purpose: every line needs the same
    nonzero ``;`` count and no quotes, and then either the comma counts vary
    line to line and some ``;``-cell is a comma number, or every ``;``-cell
    holding a comma is one. A file with no ``;`` returns at once.
    """
    first = lines[0].count(";") if lines else 0
    if first == 0 or any(ln.count(";") != first or '"' in ln for ln in lines):
        return False
    numbers = [
        bool(_COMMA_NUMBER_RE.match(cell.strip()))
        for ln in lines
        for cell in ln.split(";")
        if "," in cell
    ]
    if len({ln.count(",") for ln in lines}) > 1:
        return any(numbers)  # ragged alone is no evidence: "a, b;1" / "c, d, e;2"
    return all(numbers)
