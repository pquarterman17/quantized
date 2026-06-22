"""Integration tests for /api/export (TestClient). The writers are golden in
test_io_xrd_csv / test_io_hdf5; here we prove the transport: downloadable file
responses, filename sanitization, and error mapping."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _xrd_dataset() -> dict[str, Any]:
    return {
        "time": [10.0, 10.02, 10.04, 10.06],
        "values": [[100.0], [120.0], [95.0], [110.0]],
        "labels": ["Intensity"],
        "units": ["cps"],
        "metadata": {"x_column_name": "2Theta", "x_column_unit": "deg"},
    }


def test_xrd_csv_download() -> None:
    resp = client.post(
        "/api/export/xrd-csv",
        json={"dataset": _xrd_dataset(), "filename": "scan1"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert resp.headers["content-disposition"] == 'attachment; filename="scan1.csv"'
    body = resp.text
    assert "Intensity" in body
    assert "10.0" in body  # x values present
    assert body.endswith("\n")


def test_xrd_csv_origin_format() -> None:
    resp = client.post(
        "/api/export/xrd-csv",
        json={"dataset": _xrd_dataset(), "fmt": "origin", "include_metadata": False},
    )
    assert resp.status_code == 200
    # Origin ASCII is tab-separated with a 3-row header (name/unit/designation).
    assert "\t" in resp.text


def test_filename_is_sanitized() -> None:
    # Header-injection / traversal attempt must be neutralized.
    resp = client.post(
        "/api/export/xrd-csv",
        json={"dataset": _xrd_dataset(), "filename": '../../evil"\r\nX: y'},
    )
    assert resp.status_code == 200
    cd = resp.headers["content-disposition"]
    assert "\r" not in cd and "\n" not in cd and '"y' not in cd
    assert cd.endswith('.csv"')


def test_xrd_csv_bad_format_is_422() -> None:
    resp = client.post(
        "/api/export/xrd-csv",
        json={"dataset": _xrd_dataset(), "fmt": "nope"},
    )
    assert resp.status_code == 422


def test_hdf5_download_is_valid_file() -> None:
    resp = client.post(
        "/api/export/hdf5",
        json={"dataset": _xrd_dataset(), "filename": "scan1"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-disposition"] == 'attachment; filename="scan1.h5"'
    # HDF5 files start with the signature \x89HDF\r\n\x1a\n.
    assert resp.content[:8] == b"\x89HDF\r\n\x1a\n"
