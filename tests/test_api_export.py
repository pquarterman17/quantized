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


def test_origin_export_is_zip_with_both_files() -> None:
    import io
    import zipfile

    resp = client.post(
        "/api/export/origin",
        json={"dataset": _xrd_dataset(), "filename": "scan1"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert resp.headers["content-disposition"] == 'attachment; filename="scan1.zip"'
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = set(zf.namelist())
        assert names == {"scan1.ogs", "scan1_data.csv"}
        ogs = zf.read("scan1.ogs").decode()
        assert "impASC" in ogs and 'wks.col1.type = 4;  // X' in ogs


def test_consolidated_export_combines_datasets() -> None:
    ds = _xrd_dataset()
    resp = client.post(
        "/api/export/consolidated",
        json={
            "datasets": [
                {"dataset": ds, "name": "a.refl"},
                {"dataset": ds, "name": "b.refl"},
            ],
            "fmt": "standard",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    header = resp.text.splitlines()[0]
    # two Q blocks (one per dataset).
    assert header.count("Q") == 2


def test_consolidated_empty_is_422() -> None:
    resp = client.post("/api/export/consolidated", json={"datasets": []})
    assert resp.status_code == 422


def test_figure_pdf_download() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "pdf", "filename": "fig1"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == 'attachment; filename="fig1.pdf"'
    assert resp.content[:5] == b"%PDF-"


def test_figure_svg_download() -> None:
    resp = client.post("/api/export/figure", json={"dataset": _xrd_dataset(), "fmt": "svg"})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/svg+xml"
    assert b"<svg" in resp.content[:400]


def test_figure_tiff_download() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "tiff", "dpi": 150, "filename": "fig1"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/tiff"
    assert resp.headers["content-disposition"] == 'attachment; filename="fig1.tiff"'
    assert resp.content[:4] in (b"II*\x00", b"MM\x00*")


def test_figure_dpi_is_clamped() -> None:
    # An absurd dpi must not blow up — it is clamped server-side and still renders.
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "png", "dpi": 100000},
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_figure_bad_format_is_422() -> None:
    resp = client.post("/api/export/figure", json={"dataset": _xrd_dataset(), "fmt": "bmp"})
    assert resp.status_code == 422
