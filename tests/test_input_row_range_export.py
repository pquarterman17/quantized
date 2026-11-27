"""The input row range of an output worksheet stays in the project file (OG20).

``__quantized_input_row_range`` records which rows of its source a committed output was computed
on. It is provenance for the ``.dwk`` alone: no export writer may carry the key or its values.
Every path the cell-notes leak test pushes a dataset through is pushed through here too, plus the
row helpers (the key describes the SOURCE's rows, so a slice or a trim of the output must leave it
untouched).
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
from quantized.io.table_export import ExportColumn, ExportSheet, format_delimited, format_xlsx
from quantized.row_sidecars import INPUT_ROW_RANGE_KEY, drop_row_sidecars, slice_row_sidecars

client = TestClient(app)

SENTINEL_ID = "ZZSRC-sentinel-4417"
RANGE = [{"datasetId": SENTINEL_ID, "from": 20, "to": 43, "rows": 48}]
KEY = INPUT_ROW_RANGE_KEY.encode()


def _dataset() -> DataStruct:
    return DataStruct.create(
        [1.0, 2.0, 3.0, 4.0],
        [[10.0, 1.0], [20.0, 2.0], [30.0, 3.0], [40.0, 4.0]],
        labels=["Moment", "Field"],
        units=["emu", "Oe"],
        metadata={"x_column_name": "Temperature", "sample": "S1", INPUT_ROW_RANGE_KEY: RANGE},
    )


def _leaks(payload: bytes) -> bool:
    chunks = [payload]
    if zipfile.is_zipfile(io.BytesIO(payload)):
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            chunks += [zf.read(n) for n in zf.namelist()]
    return any(KEY in c or SENTINEL_ID.encode() in c for c in chunks)


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
    assert INPUT_ROW_RANGE_KEY in _dataset().metadata
    assert _leaks(("x" + INPUT_ROW_RANGE_KEY).encode())
    assert _leaks(SENTINEL_ID.encode())


def test_flat_writers_leave_the_key_out() -> None:
    ds = _dataset()
    assert not _leaks(format_csv(ds, "d"))
    assert not _leaks(format_xy(ds, "d"))
    assert not _leaks(format_workbook([("d", ds)]))
    rows, _ = flatten_metadata(ds.metadata)
    assert not any(k.startswith(INPUT_ROW_RANGE_KEY) for k, _v in rows)
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
    if writer is write_npz:
        with np.load(path) as z:
            assert INPUT_ROW_RANGE_KEY not in str(z["d__metadata"])
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


def test_worksheet_formats_carry_no_metadata_key() -> None:
    columns = [ExportColumn("T", "K", "number", [1.0, 2.0])]
    sheet = ExportSheet("Run", columns, preamble=("line one",))
    assert not _leaks(format_xlsx([sheet]))
    assert not _leaks(format_delimited(sheet, ",").encode())
    assert not _leaks(format_delimited(sheet, "\t").encode())


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


def test_public_metadata_and_the_row_helpers_leave_it_as_written() -> None:
    md = dict(_dataset().metadata)
    assert INPUT_ROW_RANGE_KEY not in public_metadata(md)
    # It describes the source's rows, not the output's: slicing or dropping sidecars leaves it.
    assert slice_row_sidecars(md, [3, 2, 0])[INPUT_ROW_RANGE_KEY] == RANGE
    assert drop_row_sidecars(md)[INPUT_ROW_RANGE_KEY] == RANGE


def test_a_real_correction_trim_keeps_the_recorded_range() -> None:
    from quantized.calc.corrections import apply_corrections

    out = apply_corrections(_dataset(), {"xTrimMin": 3.0})
    assert list(out.time) == [3.0, 4.0]
    assert out.metadata[INPUT_ROW_RANGE_KEY] == RANGE
