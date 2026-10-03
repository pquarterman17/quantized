"""An upload's ``metadata['source']`` is the picked file's name (plot audit r2).

Before: it was the server's temp copy (``/tmp/tmpXXXX/data.csv``), a path that
is deleted before the response is even sent, shown verbatim in the Inspector."""

from __future__ import annotations

from pathlib import Path

import openpyxl
from fastapi.testclient import TestClient

from quantized.routes import _datasetcache as dc

_CSV = b"t,a\n1,10\n2,20\n3,30\n"


def test_upload_source_is_the_file_name(client: TestClient) -> None:
    res = client.post("/api/parsers/upload", files={"file": ("run 7.csv", _CSV)})
    assert res.status_code == 200, res.text
    assert res.json()["metadata"]["source"] == "run 7.csv"
    assert dc.resolve_dataset(res.headers["X-Dataset-Handle"]).metadata["source"] == "run 7.csv"


def test_every_uploaded_sheet_is_renamed(client: TestClient, tmp_path: Path) -> None:
    wb = openpyxl.Workbook()
    wb.active.append(["x", "y"])
    wb.active.append([1.0, 2.0])
    second = wb.create_sheet("Two")
    second.append(["x", "z"])
    second.append([1.0, 3.0])
    wb.save(tmp_path / "book.xlsx")
    with (tmp_path / "book.xlsx").open("rb") as fh:
        body = client.post("/api/parsers/upload", files={"file": ("book.xlsx", fh)}).json()
    assert body["metadata"]["source"] == "book.xlsx"
    assert body["sheets"][0]["metadata"]["source"] == "book.xlsx"


def test_a_path_import_keeps_its_real_path(client: TestClient, tmp_path: Path) -> None:
    path = tmp_path / "local.csv"
    path.write_bytes(_CSV)
    res = client.post("/api/parsers/import", json={"path": str(path)})
    assert res.status_code == 200, res.text
    assert res.json()["metadata"]["source"] == str(path)
