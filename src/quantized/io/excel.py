"""Excel ``.xlsx`` parser. Port of MATLAB parser.importExcel (via openpyxl).

Reads a sheet's cell grid, detects the header + data-start rows from a numeric
shadow matrix, and (by default) takes the first column as the x-axis. Mirrors
importExcel's logic; the cell grid replaces MATLAB's ``readcell``.
"""

from __future__ import annotations

import zipfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import openpyxl
from openpyxl.utils.exceptions import InvalidFileException

from quantized.datastruct import DataStruct
from quantized.io.base import resolve_column
from quantized.io.delimited import _extract_units

__all__ = ["import_excel"]


def _cell_to_float(value: Any) -> float:
    if isinstance(value, bool):  # bool is an int subclass — not data
        return float("nan")
    if isinstance(value, (int, float)):
        return float(value)
    return float("nan")


def _header_str(value: Any, col: int) -> str:
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, bool) and isinstance(value, (int, float)):
        return str(value)
    return f"Col{col + 1}"


def import_excel(
    filepath: str | Path,
    *,
    sheet: int | str = 0,
    time_column: int | str = 0,
    data_columns: Sequence[int | str] | None = None,
) -> DataStruct:
    """Import an ``.xlsx`` sheet (first column = x-axis by default)."""
    path = Path(filepath)
    try:
        workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    except (zipfile.BadZipFile, InvalidFileException, OSError) as exc:
        # An empty / non-ZIP / truncated .xlsx raises BadZipFile or
        # InvalidFileException (neither a ValueError) -> would 500 the import
        # route. Reject cleanly instead.
        raise ValueError(f"{path.name} is not a readable .xlsx workbook: {exc}") from exc
    try:
        worksheet = workbook[sheet] if isinstance(sheet, str) else workbook.worksheets[sheet]
        sheet_name = worksheet.title
        grid: list[list[Any]] = [list(row) for row in worksheet.iter_rows(values_only=True)]
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
    first_data = next((i for i, s in enumerate(scores) if s > 0.5), 0)
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
