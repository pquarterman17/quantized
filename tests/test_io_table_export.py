"""Worksheet export to CSV / TSV / Excel, and back (worksheet audit #8).

The export writes a Long Name row, a Units row and the data, every column in
place -- text columns included -- and our own importers read it back with
the same names, units and text. Synthetic data only.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.io.delimited import import_csv
from quantized.io.table_export import ExportColumn, ExportSheet, format_delimited, format_xlsx

openpyxl = pytest.importorskip("openpyxl")

from quantized.io.excel import import_excel  # noqa: E402

client = TestClient(app)
T0 = datetime(2026, 3, 1, 12, 0, tzinfo=UTC).timestamp()
N = 6


def _sheet(name: str = "run 1") -> ExportSheet:
    return ExportSheet(
        name,
        [
            ExportColumn("Temperature", "K", "number", [10.0 + 5 * i for i in range(N)]),
            ExportColumn("Sample", "", "text", [f"S{i % 3}" for i in range(N)]),
            ExportColumn("Resistance", "Ohm", "number", [100.5 - i if i != 2 else None for i in range(N)]),
            ExportColumn("Logged", "", "datetime", [T0 + 60.0 * i for i in range(N)]),
        ],
    )


def test_csv_layout() -> None:
    text = format_delimited(_sheet())
    lines = text.splitlines()
    assert lines[0] == "Temperature,Sample,Resistance,Logged"
    assert lines[1] == "K,,Ohm,"
    assert lines[2] == "10,S0,100.5,2026-03-01 12:00:00"
    assert lines[4] == "20,S2,,2026-03-01 12:02:00"  # a blank stays blank


@pytest.mark.parametrize("delim", [",", "\t"])
def test_csv_and_tsv_round_trip(tmp_path: Path, delim: str) -> None:
    path = tmp_path / ("w.csv" if delim == "," else "w.tsv")
    path.write_text(format_delimited(_sheet(), delim), encoding="utf-8")
    ds = import_csv(path)
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.metadata["x_column_unit"] == "K"
    assert ds.labels == ("Resistance",) and ds.units == ("Ohm",)
    np.testing.assert_allclose(ds.time, [10.0 + 5 * i for i in range(N)])
    assert np.isnan(ds.values[2, 0])
    text = ds.metadata["text_columns"]
    assert text["Sample"] == [f"S{i % 3}" for i in range(N)]
    assert text["Logged"][1] == "2026-03-01 12:01:00"
    # the file's column order is kept
    assert ds.metadata["all_column_names"] == ["Temperature", "Sample", "Resistance", "Logged"]


def test_xlsx_round_trip_with_one_tab_per_sheet(tmp_path: Path) -> None:
    second = ExportSheet("Run:2?", [ExportColumn("Field", "Oe", "number", [0.0, 1.0, 2.0])])
    path = tmp_path / "w.xlsx"
    path.write_bytes(format_xlsx([_sheet(), second]))
    wb = openpyxl.load_workbook(path)
    assert wb.sheetnames == ["run 1", "Run_2_"]
    assert isinstance(wb["run 1"]["D3"].value, datetime)  # a real date cell
    assert wb["run 1"]["A3"].value == 10
    ds = import_excel(path)
    assert ds.metadata["x_column_name"] == "Temperature" and ds.metadata["x_column_unit"] == "K"
    assert ds.labels == ("Resistance",) and ds.units == ("Ohm",)
    assert ds.metadata["text_columns"]["Sample"][:3] == ["S0", "S1", "S2"]
    assert ds.metadata["text_columns"]["Logged"][0] == "2026-03-01 12:00:00"


def test_a_date_x_column_reimports_as_dates(tmp_path: Path) -> None:
    sheet = ExportSheet(
        "log",
        [
            ExportColumn("Date", "", "datetime", [T0 + 3600.0 * i for i in range(N)]),
            ExportColumn("Temp", "C", "number", [20.0 + i for i in range(N)]),
        ],
    )
    csv_path = tmp_path / "d.csv"
    csv_path.write_text(format_delimited(sheet), encoding="utf-8")
    xlsx_path = tmp_path / "d.xlsx"
    xlsx_path.write_bytes(format_xlsx([sheet]))
    for ds in (import_csv(csv_path), import_excel(xlsx_path)):
        assert ds.metadata["time_is_datetime"] is True
        np.testing.assert_allclose(ds.time, [T0 + 3600.0 * i for i in range(N)])
        assert ds.units == ("C",)


def test_text_never_becomes_a_live_formula() -> None:
    sheet = ExportSheet(
        "s", [ExportColumn("=HYPERLINK(1)", "", "text", ["=cmd()", "-1.5", "+x"])]
    )
    lines = format_delimited(sheet).splitlines()
    assert lines == ["'=HYPERLINK(1)", "'=cmd()", "-1.5", "'+x"]
    wb = openpyxl.load_workbook(io.BytesIO(format_xlsx([sheet])))
    assert wb.active["A2"].value == "'=cmd()"
    assert wb.active["A2"].data_type == "s"


def test_malformed_sheets_are_refused() -> None:
    with pytest.raises(ValueError, match="different row counts"):
        format_delimited(
            ExportSheet("s", [ExportColumn("a", "", "number", [1.0]), ExportColumn("b", "", "number", [])])
        )


def test_the_route(tmp_path: Path) -> None:
    body = {
        "fmt": "tsv",
        "filename": "Ångström run",
        "sheets": [
            {
                "name": "s",
                "columns": [
                    {"name": "x", "unit": "s", "cells": [1, 2, 3]},
                    {"name": "label", "kind": "text", "cells": ["a", "b", None]},
                ],
            }
        ],
    }
    r = client.post("/api/export/worksheet", json=body)
    assert r.status_code == 200, r.text
    assert r.text.splitlines()[:3] == ["x\tlabel", "s\t", "1\ta"]
    assert ".tsv" in r.headers["content-disposition"]
    body["fmt"] = "xlsx"
    r = client.post("/api/export/worksheet", json=body)
    assert r.status_code == 200
    assert openpyxl.load_workbook(io.BytesIO(r.content)).sheetnames == ["s"]
    body["sheets"][0]["columns"][1]["cells"] = ["a"]  # type: ignore[index]
    assert client.post("/api/export/worksheet", json=body).status_code == 422
