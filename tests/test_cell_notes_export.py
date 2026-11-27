"""Cell notes in export (ROW_RANGE_CONTRACT 7.2, D15, slice R6x).

The notes sidecar (``__quantized_cell_notes``) is private to the project file: ``.xlsx`` writes
it as cell comments, and NO other export may carry the key or the note text. The leak tests push one
dataset that holds a note through every export path and search the output for both.
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.io.convert_containers import write_h5, write_json, write_mat, write_npz
from quantized.io.convert_flat import format_csv, format_workbook, format_xy
from quantized.io.convert_meta import flatten_metadata, public_metadata
from quantized.io.hdf5 import write_hdf5
from quantized.io.origin import format_origin_project_script, format_origin_script
from quantized.io.table_export import (
    ExportColumn,
    ExportNote,
    ExportSheet,
    format_delimited,
    format_xlsx,
)
from quantized.row_sidecars import CELL_NOTES_KEY, drop_row_sidecars, slice_row_sidecars

openpyxl = pytest.importorskip("openpyxl")
client = TestClient(app)

NOTE = "ZZNOTE-sentinel-7731"
KEY = b"__quantized_cell_notes"


def _dataset() -> DataStruct:
    return DataStruct.create(
        [1.0, 2.0, 3.0, 4.0],
        [[10.0, 1.0], [20.0, 2.0], [30.0, 3.0], [40.0, 4.0]],
        labels=["Moment", "Field"],
        units=["emu", "Oe"],
        metadata={
            "x_column_name": "Temperature",
            "x_column_unit": "K",
            "sample": "S1",
            CELL_NOTES_KEY: {"0": {"2": NOTE}, "-1": {"1": NOTE + "-x"}},
        },
    )


def _leaks(payload: bytes) -> bool:
    """Does `payload` (or any member of it, if it is a zip) hold the key or a note text?"""
    chunks = [payload]
    if zipfile.is_zipfile(io.BytesIO(payload)):
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            chunks += [zf.read(n) for n in zf.namelist()]
    return any(KEY in c or NOTE.encode() in c for c in chunks)


def _ds_wire() -> dict[str, Any]:
    d = _dataset()
    return {
        "time": list(d.time),
        "values": [list(r) for r in d.values],
        "labels": list(d.labels),
        "units": list(d.units),
        "metadata": dict(d.metadata),
    }


def test_the_leak_check_can_fail() -> None:
    """The fixture carries the note, and the detector sees it in plain and zipped bytes."""
    assert CELL_NOTES_KEY in _dataset().metadata
    assert _leaks(("x" + CELL_NOTES_KEY).encode())
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("m.txt", NOTE)
    assert _leaks(buf.getvalue())


# --- direct writers -------------------------------------------------------------------------


def test_flat_writers_leave_the_key_out() -> None:
    ds = _dataset()
    assert not _leaks(format_csv(ds, "d"))
    assert not _leaks(format_xy(ds, "d"))
    assert not _leaks(format_workbook([("d", ds)]))
    rows, _ = flatten_metadata(ds.metadata)
    assert CELL_NOTES_KEY not in dict(rows)
    assert "sample" in dict(rows)  # the public metadata still goes out


@pytest.mark.parametrize("writer", [write_json, write_npz, write_mat, write_h5])
def test_container_writers_leave_the_key_out(writer: Any, tmp_path: Path) -> None:
    if writer is write_h5:
        pytest.importorskip("h5py")
    path = tmp_path / "out.bin"
    writer(path, [("d", _dataset())])
    raw = path.read_bytes()
    assert not _leaks(raw)
    if writer is write_json:
        assert json.loads(raw)["datasets"][0]["metadata"]["sample"] == "S1"
    if writer is write_npz:  # members are zipped arrays: read the metadata text back
        with np.load(path) as z:
            assert CELL_NOTES_KEY not in str(z["d__metadata"])
            assert "S1" in str(z["d__metadata"])


def test_quantized_hdf5_writer_leaves_the_key_out(tmp_path: Path) -> None:
    pytest.importorskip("h5py")
    path = tmp_path / "q.h5"
    write_hdf5(_dataset(), path)
    assert not _leaks(path.read_bytes())


def test_origin_ascii_leaves_the_key_out() -> None:
    csv_text, ogs = format_origin_script(_dataset())
    assert not _leaks((csv_text + ogs).encode())
    files, ogs2 = format_origin_project_script([(_dataset(), "B1")])
    assert not _leaks((ogs2 + "".join(t for _, t in files)).encode())


def test_public_metadata_and_the_row_helpers() -> None:
    md = dict(_dataset().metadata)
    assert CELL_NOTES_KEY not in public_metadata(md)
    assert CELL_NOTES_KEY not in drop_row_sidecars(md)
    # A backend row slice keeps the note on its row, renumbered, like the frontend slicer.
    kept = slice_row_sidecars(md, [3, 2, 0])
    assert kept[CELL_NOTES_KEY] == {"0": {"1": NOTE}}
    assert slice_row_sidecars({CELL_NOTES_KEY: "junk"}, [0])[CELL_NOTES_KEY] == {}


# --- HTTP routes ------------------------------------------------------------------------------


def test_every_export_route_leaves_the_key_out() -> None:
    ds = _ds_wire()
    posts = [
        ("/api/export/xrd-csv", {"dataset": ds, "filename": "a"}),
        ("/api/export/xrd-csv", {"dataset": ds, "fmt": "origin", "filename": "a"}),
        ("/api/export/hdf5", {"dataset": ds, "filename": "a.h5"}),
        ("/api/export/origin", {"dataset": ds, "filename": "a"}),
        ("/api/export/consolidated", {"datasets": [{"dataset": ds, "name": "a"}]}),
        ("/api/export/origin-project", {"datasets": [{"dataset": ds, "name": "a"}]}),
        ("/api/export/opj", {"datasets": [{"dataset": ds, "name": "a"}]}),
    ]
    for url, body in posts:
        resp = client.post(url, json=body)
        assert resp.status_code == 200, (url, resp.text[:200])
        assert not _leaks(resp.content), url


def test_report_export_holds_no_dataset_metadata() -> None:
    """A report is built from analysis results, never from a dataset's metadata."""
    root = Path(__file__).resolve().parents[1] / "src" / "quantized"
    names = ("calc/report.py", "calc/report_emit.py", "io/report_export.py", "io/report_blocks.py")
    for name in names:
        assert "metadata" not in (root / name).read_text(encoding="utf-8"), name


# --- worksheet export: the one place a note IS written ----------------------------------------


def _sheet(notes: list[ExportNote]) -> ExportSheet:
    return ExportSheet(
        "Run",
        [
            ExportColumn("Temperature", "K", "number", [10.0, 20.0, 30.0, 40.0]),
            ExportColumn("Moment", "emu", "number", [1.0, 2.0, 3.0, 4.0]),
        ],
        notes=notes,
    )


def _read(payload: bytes) -> Any:
    return openpyxl.load_workbook(io.BytesIO(payload))["Run"]


def test_xlsx_comment_sits_on_the_cell_it_describes() -> None:
    # Two header rows (Long Name, Units): data row 2 is sheet row 5, column 1 is "B".
    ws = _read(format_xlsx([_sheet([ExportNote(row=2, col=1, text=NOTE)])]))
    assert ws["B5"].value == 3.0
    assert ws["B5"].comment is not None and ws["B5"].comment.text == NOTE
    assert [c.coordinate for row in ws.iter_rows() for c in row if c.comment] == ["B5"]


def test_xlsx_comment_offset_follows_the_header_and_preamble_rows() -> None:
    ws = _read(format_xlsx([_sheet([ExportNote(0, 0, "first")])], header=False))
    assert ws["A1"].comment.text == "first"
    sheet = ExportSheet(
        "Run", _sheet([]).columns, preamble=("line one",), notes=[ExportNote(0, 0, "n")]
    )
    ws = _read(format_xlsx([sheet]))
    assert ws["A4"].value == 10.0 and ws["A4"].comment.text == "n"  # preamble + 2 header rows


def test_csv_and_tsv_cannot_carry_a_note() -> None:
    for delim in (",", "\t"):
        assert NOTE not in format_delimited(_sheet([ExportNote(0, 0, NOTE)]), delim)


def test_a_note_outside_the_table_is_refused() -> None:
    for note in (ExportNote(4, 0, "x"), ExportNote(0, 2, "x"), ExportNote(-1, 0, "x")):
        with pytest.raises(ValueError, match="outside the table"):
            format_xlsx([_sheet([note])])


def test_worksheet_route_writes_the_comment_and_refuses_a_bad_note() -> None:
    body: dict[str, Any] = {
        "sheets": [
            {
                "name": "Run",
                "columns": [{"name": "T", "unit": "K", "kind": "number", "cells": [1.0, 2.0]}],
                "notes": [{"row": 1, "col": 0, "text": NOTE}],
            }
        ],
        "fmt": "xlsx",
    }
    resp = client.post("/api/export/worksheet", json=body)
    assert resp.status_code == 200
    assert _read(resp.content)["A4"].comment.text == NOTE  # header rows: name + unit
    body["sheets"][0]["notes"] = [{"row": 9, "col": 0, "text": "x"}]
    assert client.post("/api/export/worksheet", json=body).status_code == 422
    body["fmt"] = "csv"
    body["sheets"][0]["notes"] = [{"row": 1, "col": 0, "text": NOTE}]
    assert NOTE not in client.post("/api/export/worksheet", json=body).text


def test_an_illegal_xml_character_in_a_note_does_not_break_the_export() -> None:
    ws = _read(format_xlsx([_sheet([ExportNote(0, 0, "a\x00b\x0cc")])]))
    assert ws["A3"].comment.text == "a�b�c"


def test_a_real_correction_trim_keeps_each_note_on_its_row() -> None:
    """The frontend relies on the backend slicing notes with a trim."""
    from quantized.calc.corrections import apply_corrections

    out = apply_corrections(_dataset(), {"xTrimMin": 3.0})  # rows x = 3 and 4 survive
    assert list(out.time) == [3.0, 4.0]
    # Notes were on column 0 row 2 (x = 3) and column -1 row 1 (x = 2, trimmed away).
    assert out.metadata[CELL_NOTES_KEY] == {"0": {"0": NOTE}}
