"""European decimal-comma reading for delimited text (the ``decimal`` option).

Shared by the one-shot delimited parser (:mod:`quantized.io.delimited`) and
the Import Wizard engine (:mod:`quantized.io.import_parse`). Pure layer:
strings in -> floats/column indices out. No fastapi/pydantic/
``quantized.routes`` imports.

``decimal`` takes three values:

* ``"."`` -- the old behaviour, exactly. The caller does not enter this
  module beyond :func:`check_decimal`.
* ``","`` -- every column is read the European way: ``","`` is the decimal
  mark and ``"."`` groups thousands (``"1.234,5"`` -> 1234.5). Needs a
  non-comma delimiter, since with a comma delimiter ``"1,5"`` is two cells.
* ``"auto"`` (the default) -- column by column. A column is converted only
  when the delimiter is not a comma, every cell is a comma number (or a
  value that reads the same in both locales: an integer, a NaN/Inf spelling,
  a blank or missing-value spelling), and the reading is unambiguous. A
  column like ``"1,500"`` -- exactly three digits after the comma and no
  other evidence -- could be 1.5 or 1500. The file does not say which, so
  it fails closed and the error names the Import Wizard's decimal-separator
  control. That holds with plain integers mixed in too; only a column with
  a text cell keeps the old reading.

A pure US file never reaches the per-column work here: the callers skip it
entirely unless the text contains a comma and the delimiter is not one.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Any, overload

import numpy as np

from quantized.io._delimited_layout import _MISSING_TOKENS, _is_numeric_like, _to_float

__all__ = [
    "DECIMAL_CHOICES",
    "check_decimal",
    "decimal_metadata",
    "layout_rows",
    "resolve_decimal_columns",
    "uses_decimal_path",
]

DECIMAL_CHOICES = ("auto", ".", ",")

#: A comma-written number. Same shape as ``_delimited_layout._COMMA_NUMBER_RE``
#: (the fail-closed check for ``decimal="."``), with named groups.
_COMMA_RE = re.compile(
    r"^(?P<sign>[+-]?)(?P<int>\d{1,3}(?:\.\d{3})+|\d*),(?P<frac>\d+)(?P<exp>[eE][+-]?\d+)?$"
)
#: "1.234" / "12.345.678": a whole number with "." thousands groups. Only the
#: forced ``","`` mode reads it as thousands; auto never sees it as comma data.
_THOUSANDS_RE = re.compile(r"^[+-]?\d{1,3}(?:\.\d{3})+$")


def check_decimal(decimal: str, delim: str) -> str:
    """Validate ``decimal`` against the resolved delimiter; return it."""
    if decimal not in DECIMAL_CHOICES:
        raise ValueError(
            f"decimal separator must be one of 'auto', '.', ',' (got {decimal!r})"
        )
    if decimal == "," and delim == ",":
        raise ValueError(
            "a ',' decimal separator needs a non-comma delimiter (semicolon, tab or "
            "whitespace); with a comma delimiter '1,5' is two cells"
        )
    return decimal


def uses_decimal_path(decimal: str, delim: str, text_has_comma: bool) -> bool:
    """Whether to take the decimal-comma path for this file.

    Always for a forced ``","``. Under ``"auto"``, never for a comma
    delimiter or for text with no comma in it -- every pure US file -- so
    those take exactly the old code path.
    """
    return decimal == "," or (decimal == "auto" and delim != "," and text_has_comma)


def _comma_value(match: re.Match[str]) -> float:
    whole = match["int"].replace(".", "") or "0"
    return float(f"{match['sign']}{whole}.{match['frac']}{match['exp'] or ''}")


def _european_value(cell: str) -> float:
    """``cell`` read with ``","`` as the decimal mark and ``"."`` as thousands."""
    match = _COMMA_RE.match(cell)
    if match:
        return _comma_value(match)
    if _THOUSANDS_RE.match(cell):
        return float(cell.replace(".", ""))
    if "." in cell:
        return math.nan  # "1.5" is not a number in this locale
    return _to_float(cell)


def _is_neutral(cell: str) -> bool:
    """A cell that reads the same with either decimal mark: a blank or
    missing-value spelling, an integer, a NaN/Inf spelling."""
    if cell.lower() in _MISSING_TOKENS:
        return True
    return "." not in cell and "," not in cell and _is_numeric_like(cell)


def _unambiguous(match: re.Match[str]) -> bool:
    """A comma number that cannot be a US thousands-grouped integer."""
    whole = match["int"]
    return (
        len(match["frac"]) != 3
        or match["exp"] is not None
        or "." in whole
        or whole in ("", "0")
        or len(whole) > 3
    )


class _CommaAwareRows(Sequence[Sequence[str]]):
    """Token rows in which every comma number reads as ``"0"``.

    Layout detection scores rows by how many cells ``float()`` accepts, and
    it rejects ``"1,5"``. A European file's data rows then looked like text,
    so the header was taken for data. Only the scoring sees this view; the
    real cells are converted later, column by column.
    """

    __slots__ = ("_rows",)

    def __init__(self, rows: Sequence[Sequence[str]]) -> None:
        self._rows = rows

    def __len__(self) -> int:
        return len(self._rows)

    @staticmethod
    def _mapped(row: Sequence[str]) -> list[str]:
        return ["0" if _COMMA_RE.match(c.strip()) else c for c in row]

    @overload
    def __getitem__(self, index: int) -> list[str]: ...
    @overload
    def __getitem__(self, index: slice) -> list[list[str]]: ...
    def __getitem__(self, index: int | slice) -> list[str] | list[list[str]]:
        if isinstance(index, slice):
            return [self._mapped(row) for row in self._rows[index]]
        return self._mapped(self._rows[index])


def layout_rows(rows: Sequence[Sequence[str]]) -> Sequence[Sequence[str]]:
    """The view of ``rows`` that layout detection should score."""
    return _CommaAwareRows(rows)


def _column_cells(data_tokens: Sequence[Sequence[str]], c: int) -> list[str]:
    return [row[c].strip() if c < len(row) else "" for row in data_tokens]


def _ambiguous_error(header: str, file_label: str, example: str) -> ValueError:
    return ValueError(
        f"Column '{header}' in {file_label} writes numbers like '{example}', where the comma "
        "could be a decimal or a thousands separator ('1,500' is 1.5 or 1500); pick the "
        "decimal separator (Point or Comma) in the Import Wizard."
    )


def _auto_column(cells: list[str], numeric_ratio: float) -> tuple[bool, str | None]:
    """``(convert, ambiguous_example)`` for one column under ``"auto"``."""
    non_blank = [cell for cell in cells if cell]
    matches = [_COMMA_RE.match(cell) for cell in non_blank]
    hits = [m for m in matches if m]
    if not hits:
        return False, None
    # non_blank[0] may be the header itself (a file with no recognisable
    # number); the fail-closed check below has always tolerated that.
    rest = zip(non_blank[1:], matches[1:], strict=True)
    if not all(m or _is_neutral(cell) for cell, m in rest):
        return False, None
    if any(_unambiguous(m) for m in hits):
        return True, None
    # Ambiguous. Refuse where decimal="." has always refused (a non-numeric
    # column that is entirely comma numbers, bar a possible header cell), and
    # also where integers are mixed in: every cell is then a comma number or
    # neutral, and keeping today's reading would turn the comma cells into
    # NaN without a word. A column with any text cell is never refused.
    if numeric_ratio <= 0.1 and all(m for m in matches[1:]):
        return False, hits[0].group(0)
    if matches[0] or _is_neutral(non_blank[0]):
        return False, hits[0].group(0)
    return False, None


def resolve_decimal_columns(
    file_label: str,
    col_headers: Sequence[str],
    matrix: np.ndarray,
    data_tokens: Sequence[Sequence[str]],
    *,
    decimal: str,
) -> list[int]:
    """Convert decimal-comma columns of ``matrix`` in place; return their indices.

    ``decimal`` is ``"auto"`` or ``","`` (the caller handles ``"."``).
    Raises ``ValueError`` on an ambiguous ``"auto"`` column. Every ambiguous
    column is checked before any is converted, so a refusal leaves
    ``matrix`` untouched.
    """
    n_rows = max(matrix.shape[0], 1)
    pending: list[tuple[int, list[str]]] = []
    for c, header in enumerate(col_headers):
        if decimal == "auto" and not np.isnan(matrix[:, c]).any():
            continue  # every cell already parsed: no comma number in it
        cells = _column_cells(data_tokens, c)
        if decimal == ",":
            pending.append((c, cells))
            continue
        numeric_ratio = np.count_nonzero(~np.isnan(matrix[:, c])) / n_rows
        convert, example = _auto_column(cells, numeric_ratio)
        if example is not None:
            raise _ambiguous_error(header, file_label, example)
        if convert:
            pending.append((c, cells))
    converted: list[int] = []
    for c, cells in pending:
        values = [_european_value(cell) for cell in cells]
        # Forced mode visits every column; record (and rewrite) only the ones
        # where a "," or "." cell actually read as a European number.
        pairs = zip(cells, values, strict=True)
        if any(("," in cell or "." in cell) and not math.isnan(v) for cell, v in pairs):
            matrix[:, c] = values
            converted.append(c)
        elif decimal == ",":
            matrix[:, c] = values  # "1.5" is not a number in this locale
    return converted


def decimal_metadata(column_names: Sequence[str]) -> tuple[dict[str, Any], str]:
    """Metadata keys and one note for the columns read with a decimal comma."""
    names = list(column_names)
    note = f"Column(s) read with ',' as the decimal separator: {', '.join(names)}."
    return {"decimal_separator": ",", "decimal_comma_columns": names}, note
