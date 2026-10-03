"""UTF-8 BOM on CSV exports that need one, and BOM-tolerant re-import.

Excel on Windows reads a BOM-less CSV in the ANSI code page, so ``Å``/``⁻¹``/
``µ`` arrive garbled. Every user-facing CSV download therefore starts with a
UTF-8 BOM -- but only when the text holds a non-ASCII character, so ASCII
output (and every MATLAB golden) stays byte-identical. Every in-repo reader
drops a leading BOM, so each export still re-imports to the same columns.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.csv_safe import with_excel_bom
from quantized.datastruct import DataStruct
from quantized.io.import_preview import guess_settings, parse_import
from quantized.io.registry import import_auto
from quantized.io.xrd_csv import write_xrd_csv

client = TestClient(app)
BOM = b"\xef\xbb\xbf"


def _ds(unit: str, x_unit: str = "deg") -> dict[str, Any]:
    return {
        "time": [10.0, 10.02, 10.04],
        "values": [[100.0], [120.0], [95.0]],
        "labels": ["Intensity"],
        "units": [unit],
        "metadata": {"x_column_name": "2Theta", "x_column_unit": x_unit},
    }


def _refl(q_unit: str) -> dict[str, Any]:
    return {
        "time": [0.01, 0.02, 0.03],
        "values": [[1.0, 0.1], [0.5, 0.05], [0.25, 0.02]],
        "labels": ["R", "dR"],
        "units": ["", ""],
        "metadata": {"x_column_name": "Q", "x_column_unit": q_unit},
    }


def test_with_excel_bom_only_for_non_ascii() -> None:
    assert with_excel_bom("a,b\n1,2\n") == "a,b\n1,2\n"
    assert with_excel_bom("Q,R\nÅ^-1,\n") == "﻿Q,R\nÅ^-1,\n"
    assert with_excel_bom("﻿Q,µ\n") == "﻿Q,µ\n"  # never doubled
    assert with_excel_bom("") == ""


@pytest.mark.parametrize("fmt", ["standard", "origin"])
def test_xrd_csv_bom_and_round_trip(fmt: str, tmp_path: Path) -> None:
    ascii_resp = client.post("/api/export/xrd-csv", json={"dataset": _ds("cps"), "fmt": fmt})
    assert ascii_resp.status_code == 200
    assert not ascii_resp.content.startswith(BOM)

    resp = client.post(
        "/api/export/xrd-csv", json={"dataset": _ds("cps", x_unit="°"), "fmt": fmt}
    )
    assert resp.status_code == 200
    assert resp.content.startswith(BOM)
    assert resp.content.count(BOM) == 1
    path = tmp_path / "scan.csv"
    path.write_bytes(resp.content)
    back = import_auto(path)
    assert back.metadata["parser_name"] == "import_xrd_export"
    assert back.metadata["x_column_name"] == "2Theta"
    assert back.metadata["x_column_unit"] == "°"


def test_write_xrd_csv_bom_on_disk(tmp_path: Path) -> None:
    ascii_ds = DataStruct.from_dict(_ds("cps"))
    write_xrd_csv(ascii_ds, tmp_path / "a.csv")
    assert not (tmp_path / "a.csv").read_bytes().startswith(BOM)
    write_xrd_csv(DataStruct.from_dict(_ds("cps", x_unit="°")), tmp_path / "b.csv")
    assert (tmp_path / "b.csv").read_bytes().startswith(BOM)
    assert import_auto(tmp_path / "b.csv").metadata["x_column_unit"] == "°"


def test_consolidated_bom_and_round_trip(tmp_path: Path) -> None:
    body = {"datasets": [{"dataset": _refl("1/A"), "name": "a"}]}
    assert not client.post("/api/export/consolidated", json=body).content.startswith(BOM)
    body = {"datasets": [{"dataset": _refl("Å^-1"), "name": "a"}]}
    resp = client.post("/api/export/consolidated", json=body)
    assert resp.status_code == 200
    assert resp.content.startswith(BOM)
    path = tmp_path / "c.csv"
    path.write_bytes(resp.content)
    back = import_auto(path)
    assert back.metadata["x_column_name"] == "Q"
    assert back.metadata["x_column_unit"] == "Å^-1"


def _zip_members(content: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def test_origin_zip_csv_bom_and_round_trip(tmp_path: Path) -> None:
    plain = _zip_members(
        client.post("/api/export/origin", json={"dataset": _refl("1/A"), "filename": "s"}).content
    )
    assert not plain["s_data.csv"].startswith(BOM)

    members = _zip_members(
        client.post("/api/export/origin", json={"dataset": _refl("Å^-1"), "filename": "s"}).content
    )
    assert members["s_data.csv"].startswith(BOM)
    assert not members["s.ogs"].startswith(BOM)  # the script is not a CSV
    path = tmp_path / "s_data.csv"
    path.write_bytes(members["s_data.csv"])
    back = import_auto(path)
    assert back.metadata["x_column_name"] == "Q"
    assert back.metadata["x_column_unit"] == "Å^-1"
    assert list(back.labels) == ["R", "dR"]


def test_origin_project_zip_csv_bom() -> None:
    body = {"datasets": [{"dataset": _refl("Å^-1"), "name": "a"},
                         {"dataset": _refl("1/A"), "name": "b"}]}
    members = _zip_members(client.post("/api/export/origin-project", json=body).content)
    assert members["a_data.csv"].startswith(BOM)
    assert not members["b_data.csv"].startswith(BOM)


def test_import_wizard_drops_a_leading_bom() -> None:
    # The wizard receives file TEXT; a client that kept the BOM must not glue
    # it onto the first column name (which also hid that column's unit).
    text = "﻿Q (Å^-1),R\n0.1,1\n0.2,2\n"
    ds = parse_import(text, guess_settings(text))
    assert ds.metadata["x_column_name"] == "Q"
    assert ds.metadata["x_column_unit"] == "Å^-1"
