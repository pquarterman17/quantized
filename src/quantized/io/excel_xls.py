"""Legacy Excel 97-2003 ``.xls`` reader (xlrd, BSD-3).

Reads a sheet into the same cell grid the ``.xlsx`` reader produces and hands
it to :func:`quantized.io.excel.import_grid`, so header / units / date / text
column handling is identical. xlrd 2.x reads ``.xls`` only (never ``.xlsx``).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import xlrd
import xlrd.compdoc

from quantized.datastruct import DataStruct
from quantized.io.excel import MAX_CELLS, import_grid

__all__ = ["import_xls", "xls_sheet_titles"]

_UNREADABLE = (
    xlrd.XLRDError, xlrd.compdoc.CompDocError, OSError, EOFError, ValueError, IndexError,
    KeyError, AssertionError,
)


def _open(path: Path) -> Any:
    try:
        return xlrd.open_workbook(str(path), on_demand=True)
    except _UNREADABLE as exc:
        raise ValueError(f"{path.name} is not a readable .xls workbook: {exc}") from exc


def xls_sheet_titles(path: Path) -> list[str]:
    book = _open(path)
    try:
        return [str(n) for n in book.sheet_names()]
    finally:
        book.release_resources()


def _cell(book: Any, cell: Any) -> Any:
    ctype, value = cell.ctype, cell.value
    if ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK, xlrd.XL_CELL_ERROR):
        return None
    if ctype == xlrd.XL_CELL_BOOLEAN:
        return bool(value)
    if ctype == xlrd.XL_CELL_DATE:
        try:
            return xlrd.xldate.xldate_as_datetime(value, book.datemode)
        except (xlrd.XLDateError, OverflowError, ValueError):
            return None
    if ctype == xlrd.XL_CELL_TEXT:
        return str(value) if str(value).strip() else None
    num = float(value)  # an integral cell is an int, as openpyxl reads .xlsx
    return int(num) if num.is_integer() and abs(num) < 2**53 else num


def import_xls(path: str | Path, *, sheet: int | str = 0) -> DataStruct:
    """Import one ``.xls`` sheet (first column = x-axis by default)."""
    p = Path(path)
    book = _open(p)
    try:
        try:
            ws = book.sheet_by_name(sheet) if isinstance(sheet, str) else book.sheet_by_index(sheet)
        except (xlrd.XLRDError, IndexError) as exc:
            raise ValueError(f"{p.name}: no such sheet {sheet!r}") from exc
        if ws.nrows * max(ws.ncols, 1) > MAX_CELLS:
            raise ValueError(f"{p.name}: sheet spans more than {MAX_CELLS} cells")
        grid: list[list[Any]] = []
        for r in range(ws.nrows):
            row = [_cell(book, c) for c in ws.row(r)]
            while row and row[-1] is None:
                row.pop()
            grid.append(row)
        return import_grid(p, str(ws.name), grid, parser_name="import_xls")
    except _UNREADABLE as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError(f"{p.name}: damaged .xls data ({exc})") from exc
    finally:
        book.release_resources()
