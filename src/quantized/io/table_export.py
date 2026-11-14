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

__all__ = ["COLUMN_KINDS", "ExportColumn", "ExportSheet", "format_delimited", "format_xlsx"]

#: ``number`` cells are floats (``None``/NaN = blank); ``text`` cells strings;
#: ``datetime`` cells UTC epoch seconds, written as ``YYYY-MM-DD HH:MM:SS``
#: text in CSV/TSV and as real date cells in Excel.
COLUMN_KINDS = ("number", "text", "datetime")

#: Excel's sheet-name rules: at most 31 characters, none of ``[]:*?/\``.
_SHEET_NAME_MAX = 31
_SHEET_BAD = str.maketrans({c: "_" for c in "[]:*?/\\"})


@dataclass(frozen=True)
class ExportColumn:
    """One worksheet column: its Long Name, unit and cells (one per row)."""

    name: str
    unit: str
    kind: str
    cells: Sequence[float | str | None]


@dataclass(frozen=True)
class ExportSheet:
    """One sheet: a name (the Excel tab) and its columns, left to right."""

    name: str
    columns: Sequence[ExportColumn]


def _check(sheet: ExportSheet) -> int:
    """The sheet's row count; raises ``ValueError`` on a malformed sheet."""
    if not sheet.columns:
        raise ValueError(f"sheet {sheet.name!r} has no columns to export")
    rows = {len(c.cells) for c in sheet.columns}
    if len(rows) != 1:
        raise ValueError(f"sheet {sheet.name!r}: columns have different row counts {sorted(rows)}")
    for c in sheet.columns:
        if c.kind not in COLUMN_KINDS:
            raise ValueError(f"column {c.name!r}: unknown kind {c.kind!r}")
    return rows.pop()


def _number(value: float | str | None) -> float | None:
    if value is None or isinstance(value, str):
        return None
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
    from openpyxl import Workbook  # the xlsx reader's own dependency

    wb = Workbook()
    wb.remove(wb.active)
    taken: set[str] = set()
    for sheet in sheets:
        n_rows = _check(sheet)
        ws = wb.create_sheet(_sheet_title(sheet.name, taken))
        if header:
            for row in _header_rows(sheet):
                ws.append(row)
        first = ws.max_row + 1 if header else 1
        for r in range(n_rows):
            ws.append([_xlsx_cell(c, c.cells[r]) for c in sheet.columns])
        for k, c in enumerate(sheet.columns, start=1):
            if c.kind == "datetime":
                for row_cells in ws.iter_rows(min_row=first, min_col=k, max_col=k):
                    row_cells[0].number_format = "yyyy-mm-dd hh:mm:ss"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _xlsx_cell(column: ExportColumn, value: float | str | None) -> float | str | datetime | None:
    if column.kind == "text":  # openpyxl writes a leading "=" as a formula
        return None if value is None or value == "" else neutralize_formula(str(value))
    if column.kind == "datetime":
        stamp = _stamp(value)
        return None if stamp is None else stamp.replace(tzinfo=None)  # Excel has no zones
    return _number(value)
