"""Origin export round trips for two silent-loss bugs (live audit F2 / F3).

F2: an Origin-ASCII CSV whose units row is all blank (``,,,``) re-imported with
generic ``Col1..ColN`` names because the blank row was taken as the header.
F3: text columns (``metadata["text_columns"]``) were dropped by both exports.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.io.origin import format_origin_script
from quantized.io.registry import import_auto


def _roundtrip(ds: DataStruct, tmp_path: Path) -> DataStruct:
    csv_text, _ = format_origin_script(ds, csv_name="rt_data.csv")
    path = tmp_path / "rt_data.csv"
    path.write_text(csv_text)
    return import_auto(path)


def test_blank_units_row_keeps_the_header(tmp_path: Path) -> None:
    ds = DataStruct.create(
        [1.0, 2.0, 3.0],
        [[10.0, 0.5], [20.0, 0.6], [30.0, 0.7]],
        labels=["Mom_emu", "Temp_K"],
        units=["", ""],
        metadata={"x_column_name": "Field_Oe", "x_column_unit": ""},
    )
    back = _roundtrip(ds, tmp_path)
    assert list(back.labels) == ["Mom_emu", "Temp_K"]
    assert back.metadata["x_column_name"] == "Field_Oe"
    np.testing.assert_array_equal(back.values, ds.values)
    np.testing.assert_array_equal(back.time, ds.time)


def test_text_header_over_blank_row_over_data_is_units(tmp_path: Path) -> None:
    p = tmp_path / "blank2.csv"
    p.write_text("T,R,S\n,,\n1,2,3\n4,5,6\n")
    back = import_auto(p)
    assert back.metadata["x_column_name"] == "T"
    assert list(back.labels) == ["R", "S"]
    assert back.values.shape == (2, 2)


def test_text_columns_roundtrip_through_ogs_csv(tmp_path: Path) -> None:
    ds = DataStruct.create(
        [1.0, 2.0, 3.0],
        [[10.0, 0.5], [20.0, 0.6], [30.0, 0.7]],
        labels=["Mom_emu", "Temp_K"],
        units=["emu", "K"],
        metadata={
            "x_column_name": "Field_Oe",
            "x_column_unit": "Oe",
            "text_columns": {"Sample": ["a", "b", "c"], "Lot": ["L1", "", "L3"]},
        },
    )
    csv_text, ogs = format_origin_script(ds, csv_name="rt_data.csv")
    assert "Sample" in csv_text.splitlines()[0]
    assert 'wks.col5.lname$ = "Lot";' in ogs
    back = _roundtrip(ds, tmp_path)
    assert list(back.labels) == ["Mom_emu", "Temp_K"]
    assert list(back.units) == ["emu", "K"]
    np.testing.assert_array_equal(back.values, ds.values)
    assert back.metadata["text_columns"] == {"Sample": ["a", "b", "c"], "Lot": ["L1", "", "L3"]}


def test_origin_text_columns_are_exported_too(tmp_path: Path) -> None:
    ds = DataStruct.create(
        [1.0, 2.0],
        [[10.0], [20.0]],
        labels=["M"],
        units=["emu"],
        metadata={
            "x_column_name": "H",
            "x_column_unit": "Oe",
            "origin_text_columns": {"Tag": ["x", "y"]},
        },
    )
    back = _roundtrip(ds, tmp_path)
    assert back.metadata["text_columns"] == {"Tag": ["x", "y"]}


def test_opj_export_names_the_text_columns_it_cannot_carry() -> None:
    ds = {
        "time": [1.0, 2.0],
        "values": [[3.0], [4.0]],
        "labels": ["M"],
        "units": ["emu"],
        "metadata": {"text_columns": {"Sample": ["a", "b"], "Lot": ["1", "2"]}},
    }
    client = TestClient(app)
    resp = client.post(
        "/api/export/opj", json={"datasets": [{"dataset": ds, "name": "A"}], "filename": "p"}
    )
    assert resp.status_code == 200
    assert resp.headers["X-Opj-Dropped-Text-Columns"] == "A: Sample, Lot"
    clean = {**ds, "metadata": {}}
    resp = client.post(
        "/api/export/opj", json={"datasets": [{"dataset": clean, "name": "A"}], "filename": "p"}
    )
    assert "X-Opj-Dropped-Text-Columns" not in resp.headers
