"""Excel sheet shapes the CSV reader already handled (round-4 import audit).

Each of these imported wrongly or not at all through ``import_excel`` while
the same table saved as CSV was read correctly:

- a units row under the header ("Temperature" / "K") became the header;
- a sheet whose data starts in column B gave an all-NaN x axis (nothing
  plots);
- a date/time x column read as NaN, and the header above it was lost;
- numbers stored as text ("1", "2.5" -- pasted from a text file) failed
  with "no numeric data rows".
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

import pytest

openpyxl = pytest.importorskip("openpyxl")

from quantized.io.excel import import_excel  # noqa: E402


def _book(tmp_path: Path, rows: list[list[Any]]) -> Path:
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    path = tmp_path / "sheet.xlsx"
    wb.save(path)
    return path


def test_units_row_under_the_header(tmp_path: Path) -> None:
    path = _book(tmp_path, [["Temperature", "Resistance"], ["K", "Ohm"], [1, 2], [2, 3]])
    ds = import_excel(path)
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.metadata["x_column_unit"] == "K"
    assert ds.labels == ("Resistance",)
    assert ds.units == ("Ohm",)
    assert ds.time.tolist() == [1.0, 2.0]


def test_data_starting_in_column_b(tmp_path: Path) -> None:
    path = _book(tmp_path, [[None, "T", "R"], [None, 1, 2], [None, 2, 3]])
    ds = import_excel(path)
    assert ds.metadata["x_column_name"] == "T"
    assert ds.time.tolist() == [1.0, 2.0]
    assert ds.labels == ("R",)


def test_datetime_x_column(tmp_path: Path) -> None:
    t0 = dt.datetime(2026, 1, 1, 12, tzinfo=dt.UTC)
    naive = t0.replace(tzinfo=None)
    path = _book(
        tmp_path,
        [["When", "P"], [naive, 1e-6], [naive + dt.timedelta(hours=1), 2e-6]],
    )
    ds = import_excel(path)
    assert ds.metadata["x_column_name"] == "When"
    assert ds.labels == ("P",)
    assert ds.time.tolist() == [t0.timestamp(), t0.timestamp() + 3600.0]
    assert ds.metadata["time_is_datetime"] is True


def test_numbers_stored_as_text(tmp_path: Path) -> None:
    path = _book(tmp_path, [["T", "R"], ["1", "2.5"], ["2", "3.5"]])
    ds = import_excel(path)
    assert ds.metadata["x_column_name"] == "T"
    assert ds.time.tolist() == [1.0, 2.0]
    assert ds.values[:, 0].tolist() == [2.5, 3.5]


def test_plain_sheet_unchanged(tmp_path: Path) -> None:
    path = _book(tmp_path, [["T", "R"], [1, 2], [2, 3]])
    ds = import_excel(path)
    assert ds.metadata["x_column_name"] == "T"
    assert ds.labels == ("R",)
    assert ds.units == ("",)
    assert "time_is_datetime" not in ds.metadata
