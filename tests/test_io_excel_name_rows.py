"""Excel name / unit / description rows, and text columns (worksheet audit #11).

A sheet laid out as Origin and most lab templates do -- a names row, a units
row, a description (Comments) row, then data -- read the description row as
the column names, set every unit to "", and silently dropped a text column
and a date column. The CSV reader already recognised that three-row block
(`_origin_ascii_header`); the Excel reader now applies the same rule and
keeps text and non-X date columns as text. Synthetic workbooks only.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

openpyxl = pytest.importorskip("openpyxl")

from quantized.io.excel import import_excel  # noqa: E402


def _workbook(path: Path, rows: list[list[object]]) -> Path:
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    wb.save(path)
    return path


def _data(n: int = 6) -> list[list[object]]:
    return [
        [10 + 5 * i, 100.0 - 1.5 * i, f"S{i % 3}", dt.datetime(2026, 3, 1, 12, i)] for i in range(n)
    ]


def test_names_units_and_comments_rows(tmp_path: Path) -> None:
    rows: list[list[object]] = [
        ["Temperature", "Resistance", "Sample", "Logged"],
        ["K", "Ohm", "", ""],
        ["sample stage T", "4-probe R", "sample id", "timestamp"],
        *_data(),
    ]
    ds = import_excel(_workbook(tmp_path / "t.xlsx", rows))
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.metadata["x_column_unit"] == "K"
    assert ds.labels == ("Resistance",)
    assert ds.units == ("Ohm",)
    # the description row is kept, not taken for names
    assert ds.metadata["comments"] == ["sample stage T\t4-probe R\tsample id\ttimestamp"]
    text = ds.metadata["text_columns"]
    assert text["Sample"] == ["S0", "S1", "S2", "S0", "S1", "S2"]
    assert text["Logged"][0] == "2026-03-01 12:00:00"


def test_a_sparse_numeric_column_does_not_become_text(tmp_path: Path) -> None:
    rows: list[list[object]] = [["T", "R", "Note"]]
    rows += [[float(i), 2.0 * i, 7.5 if i == 3 else None] for i in range(20)]
    ds = import_excel(_workbook(tmp_path / "s.xlsx", rows))
    assert "text_columns" not in ds.metadata


def test_a_plain_names_and_units_sheet_is_unchanged(tmp_path: Path) -> None:
    rows: list[list[object]] = [["Field", "Moment"], ["Oe", "emu"]]
    rows += [[100.0 * i, 1e-4 * i] for i in range(5)]
    ds = import_excel(_workbook(tmp_path / "p.xlsx", rows))
    assert ds.metadata["x_column_name"] == "Field" and ds.metadata["x_column_unit"] == "Oe"
    assert ds.labels == ("Moment",) and ds.units == ("emu",)
    assert "text_columns" not in ds.metadata and "comments" not in ds.metadata
