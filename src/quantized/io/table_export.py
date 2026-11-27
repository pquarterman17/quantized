"""Worksheet export: a table of named columns -> CSV, TSV or Excel (.xlsx).

Worksheet audit #8: the only full-sheet export was "consolidated CSV" (no
text columns, no masked rows, no units row), "Export XRD CSV" relabelled any
Y as intensity, and there was no ``.xlsx`` export at all. Origin's ASCII and
Excel export write the sheet as it stands: a Long Name row, a Units row, then
the data, every column in its own place, text columns included.

The frontend decides WHICH cells (the worksheet's own column order, the
selected rows, masked rows left out, a date X, categorical labels) and sends
them as :class:`ExportColumn` s; this module only lays them out, so the copy
on the clipboard and the file on disk cannot disagree about what a column
holds. The header shape is the one our own importers read back
(``_origin_ascii_header`` / ``_looks_like_units_row`` for CSV,
``io.excel`` for xlsx), so an export re-imports with the same names and
units (tests/test_io_table_export.py).

Pure ``io`` layer: no fastapi/pydantic imports; ``openpyxl`` (already the
xlsx reader's dependency) is imported only when an ``.xlsx`` is written.
"""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from quantized.csv_safe import neutralize_formula
from quantized.heavy_import import heavy_imports

__all__ = [
    "COLUMN_KINDS",
    "ExportColumn",
    "ExportNote",
    "ExportSheet",
    "format_delimited",
    "format_xlsx",
]

#: ``number`` cells are floats (``None``/NaN = blank); ``text`` cells strings;
#: ``datetime`` cells UTC epoch seconds, written as ``YYYY-MM-DD HH:MM:SS``
#: text in CSV/TSV and as real date cells in Excel.
COLUMN_KINDS = ("number", "text", "datetime")

#: Excel's sheet-name rules: at most 31 characters, none of ``[]:*?/\``.
_SHEET_NAME_MAX = 31
_SHEET_BAD = str.maketrans({c: "_" for c in "[]:*?/\\"})
#: Excel's hard limits: rows per sheet, characters per cell.
_XLSX_MAX_ROWS = 1_048_576
_XLSX_MAX_CELL = 32_767
#: The author Excel shows on a cell note.
_NOTE_AUTHOR = "Quantized"
#: XML 1.0 forbids these control characters; openpyxl refuses to write them.
_XLSX_ILLEGAL = str.maketrans(
    {c: "\ufffd" for c in (*range(0x00, 0x09), 0x0B, 0x0C, *range(0x0E, 0x20))}
)


def _xlsx_text(text: str) -> str:
    """``text`` as an Excel cell: XML-illegal control characters (a NUL or
    form feed from a binary-ish import) become U+FFFD instead of 500ing the
    export, and a cell is cut at Excel's 32 767-character limit."""
    return text.translate(_XLSX_ILLEGAL)[:_XLSX_MAX_CELL]


@dataclass(frozen=True)
class ExportColumn:
    """One worksheet column: its Long Name, unit and cells (one per row)."""

    name: str
    unit: str
    kind: str
    cells: Sequence[float | str | None]


@dataclass(frozen=True)
class ExportNote:
    """A cell note: ``row`` is the 0-based DATA row of the exported table (the writer adds the
    header rows above it) and ``col`` the 0-based exported column. Written as an Excel comment;
    CSV and TSV have no place for it."""

    row: int
    col: int
    text: str


@dataclass(frozen=True)
class ExportSheet:
    """One sheet: a name (the Excel tab) and its columns, left to right."""

    name: str
    columns: Sequence[ExportColumn]
    #: Lines written above the header rows, one per line (a CSV line as
    #: given, an Excel row with the text in its first cell) — the column-roles
    #: line of ``io/_column_marker.py``. Written only with ``header``: a
    #: headerless table has no header block for it to sit above.
    #: Empty for the app's own exports.
    preamble: Sequence[str] = ()
    #: Cell notes, written as ``.xlsx`` comments (ignored by CSV and TSV).
    notes: Sequence[ExportNote] = ()


def _check(sheet: ExportSheet) -> int:
    """The sheet's row count; raises ``ValueError`` on a malformed sheet."""
    if not sheet.columns:
        raise ValueError(f"sheet {sheet.name!r} has no columns to export")
    rows = {len(c.cells) for c in sheet.columns}
    if len(rows) != 1:
        raise ValueError(f"sheet {sheet.name!r}: columns have different row counts {sorted(rows)}")
    for n in sheet.notes:
        if not (0 <= n.row < next(iter(rows))) or not (0 <= n.col < len(sheet.columns)):
            raise ValueError(
                f"sheet {sheet.name!r}: a note points outside the table "
                f"(row {n.row}, column {n.col})"
            )
    for c in sheet.columns:
        if c.kind not in COLUMN_KINDS:
            raise ValueError(f"column {c.name!r}: unknown kind {c.kind!r}")
        if c.kind == "number":
            _check_numeric(c)
    return rows.pop()


def _check_numeric(column: ExportColumn) -> None:
    """A ``number`` column holds numbers or numeric text (``"1.5"``, parsed);
    any other string is refused, naming the first one, rather than written as
    a blank cell."""
    for r, v in enumerate(column.cells):
        if isinstance(v, str) and v.strip() and _parse(v) is None and not _is_nonfinite_text(v):
            raise ValueError(
                f"column {column.name!r}, row {r + 1}: {v!r} is not a number in a number column "
                "(set the column to text, or fix the cell)"
            )


def _parse(text: str) -> float | None:
    try:
        v = float(text)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def _is_nonfinite_text(text: str) -> bool:
    """``nan`` / ``inf`` text parses but is blank in a number column, as NaN is."""
    try:
        return not math.isfinite(float(text))
    except ValueError:
        return False


def _number(value: float | str | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, str):
        return _parse(value) if value.strip() else None
    v = float(value)
    return v if math.isfinite(v) else None


def _number_text(value: float | str | None) -> str:
    v = _number(value)
    if v is None:
        return ""
    text = repr(v)  # shortest round-trip form
    return text[:-2] if text.endswith(".0") else text


def _stamp(value: float | str | None) -> datetime | None:
    v = _number(value)
    if v is None:
        return None
    try:
        return datetime.fromtimestamp(v, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def _date_text(value: float | str | None) -> str:
    stamp = _stamp(value)
    if stamp is None:
        return ""
    text = stamp.strftime("%Y-%m-%d %H:%M:%S")
    return f"{text}.{stamp.microsecond // 1000:03d}" if stamp.microsecond else text


def _cell_text(column: ExportColumn, value: float | str | None) -> str:
    if column.kind == "text":  # file-derived text: never a live formula
        return "" if value is None else neutralize_formula(str(value))
    if column.kind == "datetime":
        return _date_text(value)
    return _number_text(value)


def _header_rows(sheet: ExportSheet) -> list[list[str]]:
    """The Long Name row, and the Units row when any column has a unit."""
    rows = [[neutralize_formula(c.name) for c in sheet.columns]]
    if any(c.unit for c in sheet.columns):
        rows.append([neutralize_formula(c.unit) for c in sheet.columns])
    return rows


def format_delimited(sheet: ExportSheet, delimiter: str = ",", *, header: bool = True) -> str:
    """``sheet`` as CSV (``delimiter=","``) or TSV (``"\\t"``) text: the
    header rows (`_header_rows`) unless ``header`` is false, then the data.
    Cells are quoted only when they must be (``csv.QUOTE_MINIMAL``)."""
    if delimiter not in (",", "\t", ";"):
        raise ValueError(f"unsupported delimiter {delimiter!r}")
    n_rows = _check(sheet)
    out = io.StringIO()
    writer = csv.writer(out, delimiter=delimiter, lineterminator="\n")
    for line in sheet.preamble if header else ():
        out.write(line + "\n")
    if header:
        writer.writerows(_header_rows(sheet))
    for r in range(n_rows):
        writer.writerow([_cell_text(c, c.cells[r]) for c in sheet.columns])
    return out.getvalue()


def _sheet_title(name: str, taken: set[str]) -> str:
    base = (name.translate(_SHEET_BAD).strip("' ") or "Sheet")[:_SHEET_NAME_MAX]
    title, k = base, 2
    while title.lower() in taken:
        suffix = f" ({k})"
        title, k = base[: _SHEET_NAME_MAX - len(suffix)] + suffix, k + 1
    taken.add(title.lower())
    return title


def format_xlsx(sheets: Sequence[ExportSheet], *, header: bool = True) -> bytes:
    """``sheets`` as one Excel workbook, a tab per sheet, numbers as numbers
    and dates as date cells (shown ``yyyy-mm-dd hh:mm:ss``, UTC)."""
    if not sheets:
        raise ValueError("nothing to export")
    with heavy_imports("openpyxl"):  # the xlsx reader's own dependency (BUG-032)
        from openpyxl import Workbook
    with heavy_imports("openpyxl.comments"):
        from openpyxl.comments import Comment

    wb = Workbook()
    wb.remove(wb.active)
    taken: set[str] = set()
    for sheet in sheets:
        n_rows = _check(sheet)
        # Rows written above the data: none without a header, else the preamble
        # and the Long Name row (+ the Units row when a column has a unit).
        above = len(sheet.preamble) + len(_header_rows(sheet)) if header else 0
        if n_rows + above > _XLSX_MAX_ROWS:
            raise ValueError(
                f"sheet {sheet.name!r} has {n_rows} rows; an Excel sheet holds at most "
                f"{_XLSX_MAX_ROWS - above} data rows -- export CSV instead"
            )
        ws = wb.create_sheet(_sheet_title(sheet.name, taken))
        for line in sheet.preamble if header else ():
            ws.append([_xlsx_text(line)])
        if header:
            for row in _header_rows(sheet):
                ws.append([_xlsx_text(cell) for cell in row])
        first = ws.max_row + 1 if header else 1
        for r in range(n_rows):
            ws.append([_xlsx_cell(c, c.cells[r]) for c in sheet.columns])
        for n in sheet.notes:  # the cell its data landed in, below the header rows
            cell = ws.cell(row=first + n.row, column=n.col + 1)
            cell.comment = Comment(_xlsx_text(n.text), _NOTE_AUTHOR)
        for k, c in enumerate(sheet.columns, start=1):
            if c.kind == "datetime":
                for row_cells in ws.iter_rows(min_row=first, min_col=k, max_col=k):
                    row_cells[0].number_format = "yyyy-mm-dd hh:mm:ss"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _xlsx_cell(column: ExportColumn, value: float | str | None) -> float | str | datetime | None:
    if column.kind == "text":  # openpyxl writes a leading "=" as a formula
        return None if value is None or value == "" else _xlsx_text(neutralize_formula(str(value)))
    if column.kind == "datetime":
        stamp = _stamp(value)
        return None if stamp is None else stamp.replace(tzinfo=None)  # Excel has no zones
    return _number(value)
