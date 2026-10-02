"""Excel ``.xlsx`` parser. Port of MATLAB parser.importExcel (via openpyxl).

Reads a sheet's cell grid, detects the header + data-start rows from a numeric
shadow matrix, and (by default) takes the first column as the x-axis. Mirrors
importExcel's logic; the cell grid replaces MATLAB's ``readcell``.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import openpyxl
from openpyxl.utils.exceptions import InvalidFileException

from quantized.datastruct import DataStruct
from quantized.io._delimited_layout import _is_data_cell, _walk_back_gappy_rows
from quantized.io.base import CORRUPT_ARCHIVE_ERRORS, resolve_column
from quantized.io.delimited import _extract_units

__all__ = ["import_excel"]

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


def _cell_to_float(value: Any) -> float:
    if isinstance(value, bool):  # bool is an int subclass — not data
        return float("nan")
    if isinstance(value, (int, float)):
        return float(value)
    return float("nan")


def _cell_token(value: Any) -> str:
    """A cell as the text token ``_walk_back_gappy_rows`` classifies.

    The sheet is typed, so only a real number is data: a text cell that
    merely LOOKS numeric (a ``"2019"`` year header) or a date is mapped to a
    placeholder that is neither a number nor a missing-value spelling.
    """
    if value is None:
        return ""
    if not isinstance(value, bool) and isinstance(value, (int, float)):
        return repr(float(value))
    if isinstance(value, str) and not _is_data_cell(value.strip()):
        return value
    return "#text"


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


def _read_grid(worksheet: Any, name: str) -> list[list[Any]]:
    """The sheet's cells as rows, refusing once more than ``MAX_CELLS`` arrive."""
    grid: list[list[Any]] = []
    cells = 0
    for row in worksheet.iter_rows(values_only=True):
        cells += len(row)
        if cells > MAX_CELLS:
            raise ValueError(f"{name}: sheet spans more than {MAX_CELLS} cells")
        grid.append(list(row))
    return grid


def import_excel(
    filepath: str | Path,
    *,
    sheet: int | str = 0,
    time_column: int | str = 0,
    data_columns: Sequence[int | str] | None = None,
) -> DataStruct:
    """Import an ``.xlsx`` sheet (first column = x-axis by default)."""
    path = Path(filepath)
    # We own the OS handle: openpyxl leaves its archive open when it raises
    # mid-load or mid-stream, and on Windows an open handle makes the upload
    # route's temp-dir cleanup fail, turning a clean 422 into a 500.
    with path.open("rb") as handle:
        try:
            _check_parts(path)
            workbook = openpyxl.load_workbook(handle, data_only=True, read_only=True)
        except _UNREADABLE as exc:
            # An empty / non-ZIP / truncated / damaged .xlsx raises BadZipFile,
            # InvalidFileException, zlib or XML errors (none a ValueError) ->
            # would 500 the import route. Reject cleanly instead.
            raise ValueError(f"{path.name} is not a readable .xlsx workbook: {exc}") from exc
        try:
            worksheet = workbook[sheet] if isinstance(sheet, str) else workbook.worksheets[sheet]
            sheet_name = worksheet.title
            grid = _read_grid(worksheet, path.name)
        except CORRUPT_ARCHIVE_ERRORS as exc:  # the worksheet is streamed: damage shows up here
            raise ValueError(f"{path.name}: damaged worksheet data ({exc})") from exc
        finally:
            workbook.close()

    while grid and all(v is None for v in grid[-1]):
        grid.pop()
    if not grid:
        raise ValueError(f"sheet has no data: {path.name}")
    n_cols = max(len(r) for r in grid)
    grid = [r + [None] * (n_cols - len(r)) for r in grid]
    while n_cols > 0 and all(row[n_cols - 1] is None for row in grid):
        n_cols -= 1
        grid = [row[:n_cols] for row in grid]

    num_mat = np.array([[_cell_to_float(v) for v in row] for row in grid], dtype=float)
    scores = [
        (float(np.count_nonzero(~np.isnan(num_mat[i]))) / n_cols) if n_cols else 0.0
        for i in range(len(grid))
    ]
    first_data = next((i for i, s in enumerate(scores) if s > 0.5), -1)
    if first_data < 0:
        first_data = 0
    else:
        # A 2-column row with one blank cell scores exactly 0.5, so leading
        # gappy data rows (and the header above them) were dropped silently.
        # Same positive-evidence walk-back the delimited parser uses.
        tokens = [[_cell_token(v) for v in row] for row in grid[: first_data + 1]]
        first_data = _walk_back_gappy_rows(tokens, first_data)
    header_row = first_data - 1 if first_data >= 1 and scores[first_data - 1] < 0.5 else -1

    if header_row >= 0:
        col_headers = [_header_str(grid[header_row][c], c) for c in range(n_cols)]
    else:
        col_headers = [f"Col{c + 1}" for c in range(n_cols)]

    data = num_mat[first_data:]
    keep = [i for i in range(data.shape[0]) if not np.all(np.isnan(data[i]))]
    data = data[keep]
    if data.shape[0] == 0:
        raise ValueError(f"no numeric data rows in {path.name}")
    n_rows = data.shape[0]

    if isinstance(time_column, int) and time_column < 0:
        time_idx = -1
    else:
        time_idx = resolve_column(time_column, col_headers)
    time_vec = np.arange(1, n_rows + 1, dtype=float) if time_idx < 0 else data[:, time_idx]

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
        units.append(unit)

    if time_idx >= 0:
        x_unit, x_name = _extract_units(col_headers[time_idx])
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
    return DataStruct.create(
        time_vec, data[:, data_idx], labels=labels, units=units, metadata=metadata
    )
