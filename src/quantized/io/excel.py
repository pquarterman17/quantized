"""Excel ``.xlsx`` parser. Port of MATLAB parser.importExcel (via openpyxl).

Reads a sheet's cell grid, detects the header + data-start rows from a numeric
shadow matrix, and (by default) takes the first column as the x-axis. Mirrors
importExcel's logic; the cell grid replaces MATLAB's ``readcell``.
"""

from __future__ import annotations

import datetime as dt
import re
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import openpyxl
from openpyxl.utils.exceptions import InvalidFileException

from quantized.datastruct import DataStruct
from quantized.io._delimited_layout import (
    _is_data_cell,
    _looks_like_units_row,
    _to_float,
    _walk_back_gappy_rows,
)
from quantized.io.base import CORRUPT_ARCHIVE_ERRORS, resolve_column
from quantized.io.delimited import _extract_units

__all__ = ["import_excel", "read_sheet", "sheet_titles"]

# Hostile-input bounds (security audit 2026-10-01). openpyxl pads every row
# out to the sheet's widest column and yields every empty row before the last
# one, so a few-KB workbook with one far-away cell expands to rows x columns
# cells; 2**25 is ~4x the documented 1M x 8 import envelope. Members other
# than the streamed worksheets (shared strings, styles) are parsed whole, so
# their uncompressed size is capped like a .brml scan document.
MAX_CELLS = 1 << 25
MAX_PART_BYTES = 256 << 20
_UNREADABLE: tuple[type[Exception], ...] = (*CORRUPT_ARCHIVE_ERRORS, InvalidFileException, OSError)
_MANIFEST = "[Content_Types].xml"
_CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
_WORKSHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"


def _cell_to_float(value: Any, text_numbers: bool = False) -> float:
    """A cell's number; NaN for anything else. ``text_numbers`` also reads a
    numeric TEXT cell (only used when the sheet has no real number at all)."""
    if isinstance(value, bool):  # bool is an int subclass — not data
        return float("nan")
    if isinstance(value, (int, float)):
        return float(value)
    if text_numbers and isinstance(value, str):
        return _to_float(value)
    return float("nan")


def _is_datetime(value: Any) -> bool:
    return isinstance(value, (dt.datetime, dt.date))


def _epoch(value: dt.date) -> float:
    """A date/time cell as UTC epoch seconds (the CSV reader's convention)."""
    stamp = value if isinstance(value, dt.datetime) else dt.datetime(*value.timetuple()[:3])
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=dt.UTC)
    return stamp.timestamp()


def _cell_token(value: Any, text_numbers: bool = False) -> str:
    """A cell as the text token ``_walk_back_gappy_rows`` classifies.

    The sheet is typed, so only a real number is data: a text cell that
    merely LOOKS numeric (a ``"2019"`` year header) or a date is mapped to a
    placeholder that is neither a number nor a missing-value spelling --
    unless ``text_numbers`` (the sheet holds numbers only as text).
    """
    if value is None:
        return ""
    if not isinstance(value, bool) and isinstance(value, (int, float)):
        return repr(float(value))
    if isinstance(value, str) and (text_numbers or not _is_data_cell(value.strip())):
        return value
    return "#text"


def _row_width(row: Sequence[Any]) -> int:
    end = len(row)
    while end and row[end - 1] is None:
        end -= 1
    return end


def _units_row(grid: list[list[Any]], scores: list[float], first_data: int, n_cols: int) -> bool:
    """Is the row above ``first_data`` a units row under a header (the CSV
    reader's ``_looks_like_units_row`` rule, header at least as wide)?"""
    if first_data < 2 or scores[first_data - 1] >= 0.5 or scores[first_data - 2] >= 0.5:
        return False
    head, units = grid[first_data - 2], grid[first_data - 1]
    if _row_width(head) < _row_width(units):
        return False
    tokens = ["" if v is None else str(v) for v in units[: _row_width(units)]]
    return _looks_like_units_row(tokens, n_cols)


def _header_str(value: Any, col: int) -> str:
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, bool) and isinstance(value, (int, float)):
        return str(value)
    return f"Col{col + 1}"


def _worksheet_parts(zf: zipfile.ZipFile) -> set[str]:
    """The parts ``[Content_Types].xml`` declares as worksheets.

    Only these are streamed. A folder name proves nothing: a worksheet's own
    ``.rels`` sits under ``xl/worksheets/`` and is parsed whole, and shared
    strings live wherever the manifest says."""
    try:
        root = ET.fromstring(zf.read(_MANIFEST))  # noqa: S314 (size checked first)
    except (KeyError, ET.ParseError):
        return set()
    return {
        str(el.get("PartName", "")).lstrip("/")
        for el in root.iter(f"{{{_CT_NS}}}Override")
        if el.get("ContentType") == _WORKSHEET_TYPE
    }


def _check_parts(path: Path) -> None:
    """Refuse a non-worksheet part whose uncompressed size passes the cap."""
    if not zipfile.is_zipfile(path):
        return  # openpyxl reports a non-ZIP file below
    with zipfile.ZipFile(path) as zf:
        infos = zf.infolist()
        # The manifest is checked before it is read to find the worksheets.
        infos.sort(key=lambda info: info.filename != _MANIFEST)
        streamed: set[str] | None = None
        for info in infos:
            if streamed is None and info.filename != _MANIFEST:
                streamed = _worksheet_parts(zf)
            if streamed is not None and info.filename in streamed:
                continue
            if info.file_size > MAX_PART_BYTES:
                raise ValueError(
                    f"{path.name}: part {info.filename!r} is {info.file_size} bytes "
                    f"uncompressed (limit {MAX_PART_BYTES})"
                )


def _read_grid(worksheet: Any, name: str, max_rows: int | None = None) -> list[list[Any]]:
    """The sheet's cells as rows with trailing blanks trimmed (the first
    ``max_rows`` only, when given).

    The ``<dimension>`` tag is ignored: openpyxl pads every row to its width,
    and a wrong ``A1:XFD...`` tag would refuse a 2-column sheet past ~2,048
    rows. Two counts stay under ``MAX_CELLS``: the cells read (each row at
    least one, so a run of missing rows counts), and rows x widest trimmed
    row, the grid the import pads them to."""
    worksheet.reset_dimensions()
    grid: list[list[Any]] = []
    scanned = 0
    width = 1
    for row in worksheet.iter_rows(values_only=True):
        if max_rows is not None and len(grid) >= max_rows:
            break
        scanned += max(1, len(row))
        end = len(row)
        while end and row[end - 1] is None:
            end -= 1
        width = max(width, end)
        if scanned > MAX_CELLS or (len(grid) + 1) * width > MAX_CELLS:
            raise ValueError(f"{name}: sheet spans more than {MAX_CELLS} cells")
        grid.append(list(row[:end]))
    return grid


def _open_workbook(path: Path, handle: Any) -> Any:
    """``openpyxl``'s read-only workbook on ``handle``, behind the part-size check."""
    try:
        _check_parts(path)
        return openpyxl.load_workbook(handle, data_only=True, read_only=True)
    except _UNREADABLE as exc:
        # An empty / non-ZIP / truncated / damaged .xlsx raises BadZipFile,
        # InvalidFileException, zlib or XML errors (none a ValueError) ->
        # would 500 the import route. Reject cleanly instead.
        raise ValueError(f"{path.name} is not a readable .xlsx workbook: {exc}") from exc


def sheet_titles(path: Path) -> list[str]:
    """Every worksheet's title, in workbook order (no cell is read)."""
    with path.open("rb") as handle:
        workbook = _open_workbook(path, handle)
        try:
            return [str(ws.title) for ws in workbook.worksheets]
        finally:
            workbook.close()


def read_sheet(
    path: Path, sheet: int | str = 0, *, max_rows: int | None = None
) -> tuple[str, list[list[Any]]]:
    """A sheet's title and bounded rows (``_read_grid``), behind the part-size
    check. The one way any parser reads a workbook (``io/sims.py`` too).

    Raises ``ValueError`` for an unreadable, damaged or over-cap workbook."""
    # We own the OS handle: openpyxl leaves its archive open when it raises
    # mid-load or mid-stream, and on Windows an open handle makes the upload
    # route's temp-dir cleanup fail, turning a clean 422 into a 500.
    with path.open("rb") as handle:
        workbook = _open_workbook(path, handle)
        try:
            worksheet = workbook[sheet] if isinstance(sheet, str) else workbook.worksheets[sheet]
            return worksheet.title, _read_grid(worksheet, path.name, max_rows)
        except CORRUPT_ARCHIVE_ERRORS as exc:  # the worksheet is streamed: damage shows up here
            raise ValueError(f"{path.name}: damaged worksheet data ({exc})") from exc
        finally:
            workbook.close()


def import_excel(
    filepath: str | Path,
    *,
    sheet: int | str = 0,
    time_column: int | str = 0,
    data_columns: Sequence[int | str] | None = None,
) -> DataStruct:
    """Import an ``.xlsx`` sheet (first column = x-axis by default)."""
    path = Path(filepath)
    sheet_name, grid = read_sheet(path, sheet)

    while grid and all(v is None for v in grid[-1]):
        grid.pop()
    if not grid:
        raise ValueError(f"sheet has no data: {path.name}")
    n_cols = max(len(r) for r in grid)
    grid = [r + [None] * (n_cols - len(r)) for r in grid]
    while n_cols > 0 and all(row[n_cols - 1] is None for row in grid):
        n_cols -= 1
        grid = [row[:n_cols] for row in grid]
    # Leading blank columns too: a table that starts in column B otherwise
    # took the empty column A as its x axis (all NaN, nothing plots).
    lead = 0
    while lead < n_cols - 1 and all(row[lead] is None for row in grid):
        lead += 1
    if lead:
        grid = [row[lead:] for row in grid]
        n_cols -= lead

    # Numbers typed in as text count only when the sheet has no real number.
    text_numbers = not any(
        not isinstance(v, bool) and isinstance(v, (int, float)) for row in grid for v in row
    )
    num_mat = np.array(
        [[_cell_to_float(v, text_numbers) for v in row] for row in grid], dtype=float
    )
    dates = np.array([[_is_datetime(v) for v in row] for row in grid], dtype=bool)
    present = ~np.isnan(num_mat) | dates
    scores = [
        (float(np.count_nonzero(present[i])) / n_cols) if n_cols else 0.0
        for i in range(len(grid))
    ]
    first_data = next((i for i, s in enumerate(scores) if s > 0.5), -1)
    if first_data < 0:
        first_data = 0
    else:
        # A 2-column row with one blank cell scores exactly 0.5, so leading
        # gappy data rows (and the header above them) were dropped silently.
        # Same positive-evidence walk-back the delimited parser uses.
        tokens = [[_cell_token(v, text_numbers) for v in row] for row in grid[: first_data + 1]]
        first_data = _walk_back_gappy_rows(tokens, first_data)
    units_row = first_data - 1 if _units_row(grid, scores, first_data, n_cols) else -1
    if units_row >= 0:
        header_row = units_row - 1
    else:
        header_row = first_data - 1 if first_data >= 1 and scores[first_data - 1] < 0.5 else -1

    if header_row >= 0:
        col_headers = [_header_str(grid[header_row][c], c) for c in range(n_cols)]
    else:
        col_headers = [f"Col{c + 1}" for c in range(n_cols)]
    row_units = [
        "" if units_row < 0 or v is None else re.sub(r"^\s*[(\[](.*?)[)\]]\s*$", r"\1", str(v))
        for v in (grid[units_row] if units_row >= 0 else [None] * n_cols)
    ]

    keep = [i for i in range(first_data, len(grid)) if present[i].any()]
    data = num_mat[keep]
    if data.shape[0] == 0:
        raise ValueError(f"no numeric data rows in {path.name}")
    n_rows = data.shape[0]

    if isinstance(time_column, int) and time_column < 0:
        time_idx = -1
    else:
        time_idx = resolve_column(time_column, col_headers)
    time_vec = np.arange(1, n_rows + 1, dtype=float) if time_idx < 0 else data[:, time_idx]
    time_is_datetime = time_idx >= 0 and bool(dates[keep, time_idx].mean() >= 0.8)
    if time_is_datetime:
        time_vec = np.array(
            [_epoch(grid[i][time_idx]) if dates[i, time_idx] else np.nan for i in keep],
            dtype=float,
        )

    if data_columns is None:
        candidates = [c for c in range(n_cols) if c != time_idx]
        data_idx = [
            c for c in candidates if (np.count_nonzero(~np.isnan(data[:, c])) / n_rows) > 0.1
        ]
    else:
        data_idx = [resolve_column(s, col_headers) for s in data_columns]
    if not data_idx:
        raise ValueError(f"no valid data columns in {path.name}")

    labels: list[str] = []
    units: list[str] = []
    for c in data_idx:
        unit, label = _extract_units(col_headers[c])
        labels.append(label)
        units.append(row_units[c] or unit)

    if time_idx >= 0:
        x_unit, x_name = _extract_units(col_headers[time_idx])
        x_unit = row_units[time_idx] or x_unit
        if not x_name:
            x_name = col_headers[time_idx]
    else:
        x_name, x_unit = "Sample Index", ""

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_excel",
        "x_column_name": x_name,
        "x_column_unit": x_unit,
        "sheet_name": sheet_name,
        "all_column_names": col_headers,
    }
    if time_is_datetime:
        metadata.update({"time_is_datetime": True, "time_timezone": "UTC"})
    return DataStruct.create(
        time_vec, data[:, data_idx], labels=labels, units=units, metadata=metadata
    )
