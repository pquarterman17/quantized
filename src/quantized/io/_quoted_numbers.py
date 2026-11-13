"""Quoted numbers in a COMMA-delimited file (RFC 4180), and rows the layout
scorer skips.

A comma-delimited file cannot use a decimal comma, so a quoted cell such as
``"1,234.5"`` -- what Excel and most US-locale tools write for a number with
thousands separators -- is that number. Before this module such a cell read
as text: NaN with no note and, in the first data row, the layout scorer took
the row (and the header above it) for preamble and dropped both.

The decision is made PER COLUMN, after the row is split (the tokenizer itself,
``_delimited_layout.split_row``, is unchanged):

* A cell is "number-shaped" when it is a US-grouped number: a first group of
  1-3 digits that does not start with 0, then ``,ddd`` groups, then an
  optional fraction and exponent (``"1,234"``, ``"1,234,567.891"``,
  ``"-1,234.5"``). A quoted ``"2,000"`` is 2000 here: in a CSV the comma
  inside a quoted number can only be a separator. Accounting forms are read
  too, and called out in the note: a leading currency sign
  (``"$1,234.50"``) and parentheses for a negative (``"(1,234.5)"``).
  A leading zero (``"001,002,003"``, ``"01,234.5"``) is an identifier, never a
  number; so are phone-like groups (``"555,123,4567"``) and dates.
* Number-shaped cells are converted only in a column that is otherwise
  numeric. A column holding real text (``abc``, ``def``) keeps every cell as
  text -- the column is imported as a text column, intact.
* The comma-aware layout (number-shaped cells scored as numbers) is used only
  when every column it relies on is otherwise numeric; else the plain layout
  stands. Rows the chosen layout still skips between the header and the data
  are named in a note.
Every conversion, and every row skipped, is reported.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

import numpy as np

from quantized.io import _decimal_comma as dc
from quantized.io._delimited_layout import _MISSING_TOKENS, _is_numeric_like

__all__ = [
    "choose_layout",
    "detect",
    "grouped_value",
    "import_notes",
    "scoring_rows",
    "skipped_row_notes",
    "ungroup_columns",
]

_GROUPED_RE = re.compile(
    r"^(?P<paren>\()?(?P<cur>[$€£¥])?(?P<sign>[+-])?(?P<cur2>[$€£¥])?"
    r"(?P<num>[1-9]\d{0,2}(?:,\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?)(?(paren)\))$"
)

#: Any number-like cell with a comma ("1,5", "01,234.5", "(2,5)"): scored as
#: a number by the comma-aware layout so its ROW stays data; the cell itself is
#: converted only when it is a grouped number, and reported when it is not.
_COMMA_NUMBERISH_RE = re.compile(
    r"^[(]?[$€£¥]?[+-]?[$€£¥]?[\d.]*\d[\d.]*(?:,[\d.]+)+(?:[eE][+-]?\d+)?\)?$"
)

Layout = tuple[int, int, int]


def _numberish(cell: str) -> bool:
    return grouped_value(cell) is not None or bool(_COMMA_NUMBERISH_RE.match(cell.strip()))


def grouped_value(cell: str) -> float | None:
    """The number a quoted US-grouped cell writes, or ``None`` (module doc)."""
    text = cell.strip()
    if "," not in text:
        return None
    m = _GROUPED_RE.match(text)
    if m is None or (m["cur"] and m["cur2"]) or (m["paren"] and m["sign"]):
        return None
    value = float(m["num"].replace(",", ""))
    return -value if m["paren"] or m["sign"] == "-" else value


def _accounting(cell: str) -> bool:
    m = _GROUPED_RE.match(cell.strip())
    return bool(m and (m["paren"] or m["cur"] or m["cur2"]))


def _blank(cell: str) -> bool:
    return not cell or cell.lower() in _MISSING_TOKENS


def _column_is_numeric(cells: Sequence[str]) -> bool:
    """Every non-blank cell is a plain number or a grouped one."""
    seen = False
    for cell in cells:
        text = cell.strip()
        if _blank(text):
            continue
        if not (_is_numeric_like(text) or _numberish(text)):
            return False
        seen = True
    return seen


def _cells(rows: Sequence[Sequence[str]], c: int) -> list[str]:
    return [row[c] if c < len(row) else "" for row in rows]


class _GroupedAsNumber(Sequence[Sequence[str]]):
    """The rows with every grouped cell scored as a number (layout only)."""

    def __init__(self, rows: Sequence[Sequence[str]]) -> None:
        self._rows = rows

    def __len__(self) -> int:
        return len(self._rows)

    def _mapped(self, row: Sequence[str]) -> list[str]:
        return ["0" if _numberish(c) else c for c in row]

    def __getitem__(self, index):  # type: ignore[no-untyped-def]
        if isinstance(index, slice):
            return [self._mapped(r) for r in self._rows[index]]
        return self._mapped(self._rows[index])


def choose_layout(
    rows: Sequence[Sequence[str]], detect: Callable[[Sequence[Sequence[str]]], Layout]
) -> Layout:
    """The plain layout, or the comma-aware one when it differs AND every
    column holding a grouped cell in its data block is otherwise numeric."""
    plain = detect(rows)
    try:
        aware = detect(_GroupedAsNumber(rows))
    except ValueError:
        return plain
    if aware == plain:
        return plain
    block = rows[aware[1] :]
    width = max((len(r) for r in block), default=0)
    for c in range(width):
        cells = _cells(block, c)
        if any(_numberish(x) for x in cells) and not _column_is_numeric(cells):
            return plain
    return aware


def scoring_rows(rows: Sequence[Sequence[str]]) -> Sequence[Sequence[str]]:
    """The Import Wizard's guess (one score per row, no layout triple): the
    comma-aware view when every column holding a number-shaped comma cell
    below the first row is otherwise numeric, else ``rows`` as they are."""
    body = rows[1:]
    width = max((len(r) for r in body), default=0)
    for c in range(width):
        cells = _cells(body, c)
        if any(_numberish(x) for x in cells) and not _column_is_numeric(cells):
            return rows
    return _GroupedAsNumber(rows)


def ungroup_columns(
    col_headers: Sequence[str], matrix: np.ndarray, data_tokens: Sequence[Sequence[str]]
) -> list[str]:
    """Write grouped cells' numbers into ``matrix`` (in place) in otherwise
    numeric columns; one note per converted column."""
    notes: list[str] = []
    rows = data_tokens[: matrix.shape[0]]
    for c, header in enumerate(col_headers[: matrix.shape[1]]):
        if not np.isnan(matrix[:, c]).any():
            continue
        cells = _cells(rows, c)
        hits = [(r, grouped_value(x)) for r, x in enumerate(cells) if np.isnan(matrix[r, c])]
        hits = [(r, v) for r, v in hits if v is not None]
        if not hits or not _column_is_numeric(cells):
            continue
        for r, v in hits:
            matrix[r, c] = v
        n = len(hits)
        first = cells[hits[0][0]].strip()
        accounting = sum(_accounting(cells[r]) for r, _ in hits)
        extra = (
            f"; {accounting} of them in accounting form "
            "(a currency sign, or parentheses read as negative)"
            if accounting
            else ""
        )
        notes.append(
            f"Column '{header}' has {n} quoted {'cell' if n == 1 else 'cells'} written with "
            f"thousands separators (e.g. '{first}'), read as {'a number' if n == 1 else 'numbers'} "
            f"(e.g. {hits[0][1]:.15g}){extra}."
        )
    return notes


def skipped_row_notes(
    rows: Sequence[Sequence[str]], header_row: int, units_row: int, data_start: int
) -> list[str]:
    """A note naming the rows between the header and the data that are neither
    the units row nor read as data -- the layout scorer never drops silently."""
    first = header_row + 1 if header_row >= 0 else 0
    skipped = [
        r for r in range(first, data_start) if r != units_row and any(c.strip() for c in rows[r])
    ]
    if header_row < 0:
        # No header: rows above the data are a preamble, unless they are as
        # wide as the data (then they were probably data, or the header).
        width = len(rows[data_start]) if data_start < len(rows) else 0
        skipped = [r for r in skipped if len(rows[r]) >= width > 1]
    if not skipped:
        return []
    shown = ", ".join(f"'{','.join(rows[r])}'" for r in skipped[:3])
    more = f" and {len(skipped) - 3} more" if len(skipped) > 3 else ""
    n = len(skipped)
    return [
        f"{n} {'row' if n == 1 else 'rows'} above the data {'was' if n == 1 else 'were'} not read "
        f"as data or as the header: {shown}{more}. Check the header and data start in the "
        "Import Wizard."
    ]


def detect(
    rows: Sequence[Sequence[str]],
    detect_layout: Callable[[Sequence[Sequence[str]]], Layout],
    text: str,
    delim: str,
) -> Layout:
    """``delimited.import_csv``'s layout: the comma-aware one where sound
    (:func:`choose_layout`) in a comma-delimited file with quotes."""
    quoted = delim == "," and '"' in text
    return choose_layout(rows, detect_layout) if quoted else detect_layout(rows)


def import_notes(
    col_headers: Sequence[str],
    matrix: np.ndarray,
    data_tokens: Sequence[Sequence[str]],
    rows: Sequence[Sequence[str]],
    layout: Layout,
    delim: str,
    text: str,
    comma_path: bool,
    comma_cols: Sequence[int],
) -> list[str]:
    """``delimited.import_csv``'s comma notes, converting in place where it
    reads a number: decimal-comma cells left blank (the comma path); quoted
    grouped numbers read and other comma cells left blank (a comma-delimited
    file with quotes); then the rows the layout skipped above the data."""
    header_row, data_start, units_row = layout
    notes: list[str] = []
    if comma_path:
        notes = dc.stray_comma_notes(col_headers, matrix, data_tokens, converted=comma_cols)
    elif delim == "," and '"' in text:
        notes = ungroup_columns(col_headers, matrix, data_tokens)
        notes += dc.stray_comma_notes(col_headers, matrix, data_tokens, separator_choice=False)
    return notes + skipped_row_notes(rows, header_row, units_row, data_start)
