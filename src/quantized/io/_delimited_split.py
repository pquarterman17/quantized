"""Tokenizing one delimited text row, RFC 4180 quoting included.

Moved out of :mod:`quantized.io._delimited_layout` (which re-exports
``split_row``) so the quoted-number rule below has room.

A comma-delimited file cannot use a decimal comma, so a QUOTED cell such as
``"1,234.5"`` or ``"12,345,678"`` -- what Excel and most US-locale tools
write for a number with thousands separators -- is that number. It used to
read as text: the cell became NaN without a word, and when it sat in the
first data row the layout scorer took the whole row (and the header above
it) for preamble and dropped both. A grouped cell is read as its number only
when nothing else fits it: a fraction (``"1,234.5"``), an exponent, or more
than one group (``"1,234,567"``). ``"1,234"`` could equally be a European
``1.234``, so it is left alone and reported
(:func:`quantized.io._decimal_comma.stray_comma_notes`).
"""

from __future__ import annotations

import csv
import re
from collections.abc import Sequence

__all__ = ["grouped_number_notes", "split_row", "ungroup"]

#: "1,234.5" / "12,345,678" / "1,234e3": unambiguous US thousands grouping.
_GROUPED_RE = re.compile(
    r"^[+-]?\d{1,3}(?:,\d{3}(?:,\d{3})+|,\d{3}(?:\.\d*|[eE][+-]?\d+|\.\d*[eE][+-]?\d+))$"
)


def ungroup(cell: str) -> str:
    """``cell`` without its thousands commas when it is unambiguously a
    US-grouped number (see the module docstring), else ``cell`` unchanged."""
    text = cell.strip()
    return text.replace(",", "") if "," in text and _GROUPED_RE.match(text) else cell


def split_row(line: str, delim: str) -> list[str]:
    """Tokenize one (already stripped) delimited line.

    * A space delimiter splits on whitespace RUNS. Splitting on each single
      space turned ``"1.5  2"`` into three cells but ``"10.5 3"`` into two, so
      a fixed-width file's values landed in different columns row to row.
    * A line carrying a double quote goes through :mod:`csv`, so a quoted
      cell (``"1"``, or ``"x, y"`` with the delimiter inside it) is one cell
      with its quotes removed instead of a quoted string that fails ``float()``
      or a cell split in two that shifts every column after it. In a
      comma-delimited line a quoted thousands-grouped number is read as that
      number (module docstring).
    * Anything else is a plain ``str.split`` -- the fast, common case.
    """
    if '"' in line:
        if delim == " ":
            return next(csv.reader([line], delimiter=" ", skipinitialspace=True))
        cells = next(csv.reader([line], delimiter=delim))
        return [ungroup(c) for c in cells] if delim == "," else cells
    if delim == " ":
        return line.split()
    return line.split(delim)


def grouped_number_notes(
    col_headers: Sequence[str], data_lines: Sequence[str], delim: str
) -> list[str]:
    """One note per column in which :func:`split_row` read quoted
    thousands-grouped cells as numbers -- a conversion is never silent.
    Only lines carrying a quote are re-read, so a plain file pays nothing."""
    if delim != ",":
        return []
    found: dict[int, list[str]] = {}
    for line in data_lines:
        if '"' not in line:
            continue
        for c, cell in enumerate(next(csv.reader([line], delimiter=delim))):
            if c < len(col_headers) and ungroup(cell) != cell:
                found.setdefault(c, []).append(cell.strip())
    notes = []
    for c, cells in sorted(found.items()):
        n = len(cells)
        noun = "cell" if n == 1 else "cells"
        notes.append(
            f"Column '{col_headers[c]}' has {n} quoted {noun} written with thousands "
            f"separators (e.g. '{cells[0]}'), read as {'a number' if n == 1 else 'numbers'} "
            f"(e.g. {cells[0].replace(',', '')})."
        )
    return notes
