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


def test_figure_style_preset_download() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "pdf", "style": "aps", "filename": "fig1"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:5] == b"%PDF-"


def _demo_map() -> dict:
    import numpy as np
    x = np.linspace(-2.0, 2.0, 16)
    y = np.linspace(-1.0, 3.0, 12)
    xg, yg = np.meshgrid(x, y)
    z = 100.0 * np.exp(-(xg**2 + (yg - 1.0) ** 2))
    return {"x_axis": x.tolist(), "y_axis": y.tolist(), "z_grid": z.tolist()}


def test_map_figure_contourf_pdf() -> None:
    resp = client.post(
        "/api/export/map-figure",
        json={**_demo_map(), "kind": "contourf", "fmt": "pdf",
              "x_label": "Qx", "y_label": "Qz", "z_label": "I", "filename": "rsm map"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == 'attachment; filename="rsm_map.pdf"'
    assert resp.content[:5] == b"%PDF-"


def test_map_figure_surface_png() -> None:
    resp = client.post(
        "/api/export/map-figure",
        json={**_demo_map(), "kind": "surface", "fmt": "png"},
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_map_figure_log_contour_svg() -> None:
    resp = client.post(
        "/api/export/map-figure",
        json={**_demo_map(), "kind": "contour", "fmt": "svg",
              "level_scale": "log", "levels": 8},
    )
    assert resp.status_code == 200
    assert b"<svg" in resp.content[:400]


def test_map_figure_bad_kind_is_422() -> None:
    resp = client.post("/api/export/map-figure", json={**_demo_map(), "kind": "nope"})
    assert resp.status_code == 422


def test_statplot_box_pdf() -> None:
    resp = client.post(
        "/api/export/statplot-figure",
        json={"kind": "box", "data": [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]],
              "labels": ["A", "B"], "fmt": "pdf", "filename": "box plot"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == 'attachment; filename="box_plot.pdf"'
    assert resp.content[:5] == b"%PDF-"


def test_statplot_histogram_with_fit_png() -> None:
    import numpy as np
    sample = list(np.linspace(0, 10, 200))
    resp = client.post(
        "/api/export/statplot-figure",
        json={"kind": "histogram", "data": sample, "fit": "norm", "fmt": "png"},
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_statplot_bad_kind_is_422() -> None:
    resp = client.post(
        "/api/export/statplot-figure", json={"kind": "swarm", "data": [1.0, 2.0, 3.0]}
    )
    assert resp.status_code == 422


def test_map_figure_degenerate_grid_is_422_not_500() -> None:
    # a 1-wide grid used to raise matplotlib TypeError -> 500
    resp = client.post(
        "/api/export/map-figure",
        json={"x_axis": [1.0], "y_axis": [1.0, 2.0], "z_grid": [[1.0], [2.0]],
              "kind": "contourf"},
    )
    assert resp.status_code == 422


def test_figure_bad_style_is_422() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "pdf", "style": "nope"},
    )
    assert resp.status_code == 422


def test_figure_title_and_label_overrides() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(),
            "fmt": "svg",
            "title": "Scan 1",
            "x_label": "Two-theta",
            "y_label": "Counts",
        },
    )
    assert resp.status_code == 200
    svg = resp.content.decode("utf-8", "ignore")
    assert "Scan 1" in svg
    assert "Two-theta" in svg
    assert "Counts" in svg


def test_figure_series_styles_applied() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(),
            "fmt": "svg",
            "series_styles": [{"color": "#abcdef", "width": 2.5, "line": "dashed"}],
        },
    )
    assert resp.status_code == 200
    assert "#abcdef" in resp.content.decode("utf-8", "ignore")


def test_figure_bad_format_is_422() -> None:
    resp = client.post("/api/export/figure", json={"dataset": _xrd_dataset(), "fmt": "bmp"})
    assert resp.status_code == 422


def test_export_opj_roundtrips_through_our_reader(tmp_path):
    """POST /api/export/opj -> a CPYA project our own Origin reader re-opens."""
    from quantized.io.origin_project import read_origin_books

    ds = {
        "time": [1.0, 2.0, 3.0],
        "values": [[10.0], [20.0], [30.0]],
        "labels": ["Moment"],
        "units": ["emu"],
        "metadata": {"x_column_long": "Field", "x_unit": "Oe"},
    }
    resp = client.post(
        "/api/export/opj",
        json={"datasets": [{"dataset": ds, "name": "LoopA"}], "filename": "proj"},
    )
    assert resp.status_code == 200
    assert resp.content.startswith(b"CPYA")
    out = tmp_path / "roundtrip.opj"
    out.write_bytes(resp.content)
    books = read_origin_books(out)
    assert books[0].metadata["origin_book"] == "LoopA"
    assert books[0].labels == ("Moment",)
    assert list(books[0].time) == [1.0, 2.0, 3.0]


def test_export_opj_rejects_empty():
    resp = client.post("/api/export/opj", json={"datasets": [], "filename": "x"})
    assert resp.status_code == 422


def test_export_origin_project_multibook_zip():
    """POST /api/export/origin-project -> one .ogs + one CSV per book."""
    import io as _io
    import zipfile as _zip

    ds = {
        "time": [1.0, 2.0],
        "values": [[3.0], [4.0]],
        "labels": ["M"],
        "units": ["emu"],
        "metadata": {"origin_book_long": "30 nm sample"},
    }
    resp = client.post(
        "/api/export/origin-project",
        json={
            "datasets": [{"dataset": ds, "name": "LoopA"}, {"dataset": ds, "name": "LoopB"}],
            "filename": "proj",
        },
    )
    assert resp.status_code == 200
    zf = _zip.ZipFile(_io.BytesIO(resp.content))
    names = set(zf.namelist())
    assert names == {"proj.ogs", "LoopA_data.csv", "LoopB_data.csv"}
    ogs = zf.read("proj.ogs").decode()
    assert ogs.count("newbook") == 2
    assert 'page.longname$ = "30 nm sample";' in ogs
