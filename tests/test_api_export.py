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


def test_figure_page_size_sets_the_raster_pixels() -> None:
    # #54 Stage 3: width_in/height_in (from the window's PageSetup) flow through
    # the route to matplotlib figsize — the PNG is width_in*dpi x height_in*dpi.
    from io import BytesIO

    from PIL import Image

    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(),
            "fmt": "png",
            "width_in": 5.0,
            "height_in": 3.0,
            "dpi": 100,
        },
    )
    assert resp.status_code == 200
    with Image.open(BytesIO(resp.content)) as im:
        assert im.size == (500, 300)


def test_figure_reciprocal_x_scale_renders() -> None:
    # MAIN #12 (Arrhenius reciprocal axis): x_scale takes precedence over
    # x_log/y_log booleans and renders without error via the FuncScale path.
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(),
            "fmt": "png",
            "x_scale": "reciprocal",
            "filename": "arrhenius",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


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


def _demo_points() -> dict:
    import numpy as np
    rng = np.random.default_rng(11)
    x = rng.uniform(-2.0, 2.0, 60)
    y = rng.uniform(-1.0, 3.0, 60)
    z = 100.0 * np.exp(-(x**2 + (y - 1.0) ** 2)) + rng.normal(0.0, 0.5, 60)
    return {"x_axis": x.tolist(), "y_axis": y.tolist(), "z_values": z.tolist()}


def test_map_figure_scattered_tricontour_png() -> None:
    # gap #17 last remaining piece: a raw scattered (RSM) cloud, no regridding.
    resp = client.post(
        "/api/export/map-figure",
        json={**_demo_points(), "contour_source": "points", "kind": "contourf", "fmt": "png"},
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_map_figure_scattered_collinear_is_422() -> None:
    resp = client.post(
        "/api/export/map-figure",
        json={
            "x_axis": [0.0, 1.0, 2.0, 3.0], "y_axis": [0.0, 0.0, 0.0, 0.0],
            "z_values": [1.0, 2.0, 3.0, 4.0], "contour_source": "points", "kind": "contourf",
        },
    )
    assert resp.status_code == 422
    assert "degenerate" in resp.json()["detail"]


def test_map_figure_scattered_kind_restriction_is_422() -> None:
    resp = client.post(
        "/api/export/map-figure",
        json={**_demo_points(), "contour_source": "points", "kind": "heatmap"},
    )
    assert resp.status_code == 422


def test_map_figure_dpi_none_uses_style_preset() -> None:
    web = client.post(
        "/api/export/map-figure",
        json={**_demo_map(), "kind": "contourf", "fmt": "png", "style": "web"},
    )
    aps = client.post(
        "/api/export/map-figure",
        json={**_demo_map(), "kind": "contourf", "fmt": "png", "style": "aps"},
    )
    assert web.status_code == aps.status_code == 200
    assert len(aps.content) > len(web.content)


def test_statplot_figure_dpi_none_uses_style_preset() -> None:
    payload = {"kind": "histogram", "data": list(range(1, 101)), "fmt": "png"}
    web = client.post("/api/export/statplot-figure", json={**payload, "style": "web"})
    aps = client.post("/api/export/statplot-figure", json={**payload, "style": "aps"})
    assert web.status_code == aps.status_code == 200
    assert len(aps.content) > len(web.content)


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


def test_figure_x_fmt_and_y_fmt_render_and_appear_in_svg() -> None:
    # MAIN #24: tick-label number format threaded through the route into
    # calc.figure_ticks -- SVG embeds tick label text literally (same
    # precedent as test_figure_title_and_label_overrides above), so the
    # formatted mantissa/exponent strings are checkable end-to-end, not just
    # "renders without error".
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(),
            "fmt": "svg",
            "x_fmt": {"mode": "fixed", "digits": 3},
            "y_fmt": {"mode": "sci", "digits": 1},
        },
    )
    assert resp.status_code == 200
    svg = resp.content.decode("utf-8", "ignore")
    assert "10.000" in svg  # x tick at 10.0, fixed digits=3


def test_figure_x_fmt_auto_is_omittable() -> None:
    # The default/omitted case must still render (backward compatible with
    # every caller that predates MAIN #24).
    resp = client.post("/api/export/figure", json={"dataset": _xrd_dataset(), "fmt": "pdf"})
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_linear_tick_steps_render_and_appear_in_svg() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(),
            "fmt": "svg",
            "x_step": 0.02,
            "y_step": 10.0,
            "x_fmt": {"mode": "fixed", "digits": 2},
        },
    )
    assert resp.status_code == 200
    svg = resp.content.decode("utf-8", "ignore")
    assert "10.02" in svg
    assert "10.04" in svg


def test_figure_x_fmt_bad_mode_is_422() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "pdf", "x_fmt": {"mode": "bogus", "digits": 2}},
    )
    assert resp.status_code == 422


def test_figure_page_panel_x_fmt_renders() -> None:
    # Each panel's nested figure payload carries its own x_fmt/y_fmt (the
    # figure-page per-panel-own-view-fmt contract).
    resp = client.post(
        "/api/export/figure-page",
        json={
            "rows": 1,
            "cols": 1,
            "panels": [
                {
                    "figure": {
                        "dataset": _xrd_dataset(),
                        "x_fmt": {"mode": "fixed", "digits": 2},
                    },
                    "row": 0,
                    "col": 0,
                }
            ],
            "fmt": "pdf",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_page_panel_linear_tick_steps_render() -> None:
    resp = client.post(
        "/api/export/figure-page",
        json={
            "rows": 1,
            "cols": 1,
            "panels": [
                {
                    "figure": {
                        "dataset": _xrd_dataset(),
                        "x_step": 0.02,
                        "y_step": 10.0,
                    },
                    "row": 0,
                    "col": 0,
                }
            ],
            "fmt": "pdf",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_bad_format_is_422() -> None:
    resp = client.post("/api/export/figure", json={"dataset": _xrd_dataset(), "fmt": "bmp"})
    assert resp.status_code == 422


def _three_channel_dataset() -> dict[str, Any]:
    return {
        "time": [1.0, 2.0, 3.0, 4.0],
        "values": [[1.0, 2.0, 5.0], [4.0, 3.0, 4.0], [9.0, 5.0, 3.0], [16.0, 7.0, 2.0]],
        "labels": ["a", "b", "c"],
        "units": ["V", "V", "K"],
        "metadata": {},
    }


# ── MAIN #13: fill under/between curves (wire-level channel resolution) ─────
def test_figure_fill_under_download() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "png", "series_styles": [{"fill": "under"}]},
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_figure_fill_between_channels_download() -> None:
    # y_keys=["a", "c"] -> display series 0="a", 1="c"; fill.vs=2 (channel "c")
    # must resolve to display position 1, matching the frontend's own
    # channel-index semantic for SeriesStyle.fill.
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _three_channel_dataset(),
            "fmt": "pdf",
            "y_keys": [0, 2],
            "series_styles": [{"fill": {"vs": 2}}, None],
        },
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_fill_vs_unplotted_channel_degrades_gracefully() -> None:
    # channel 1 ("b") is never plotted here -> no band, but no 500 either.
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _three_channel_dataset(),
            "fmt": "pdf",
            "y_keys": [0],
            "series_styles": [{"fill": {"vs": 1}}],
        },
    )
    assert resp.status_code == 200


# ── MAIN #14: colour-mapped scatter (wire-level channel index) ──────────────
def test_figure_color_by_channel_download() -> None:
    # color_by=2 names channel "c" (never itself plotted as x/y) as the
    # per-point colour source for series "a".
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _three_channel_dataset(),
            "fmt": "png",
            "y_keys": [0],
            "series_styles": [{"color_by": 2, "colormap": "magma"}],
        },
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_figure_color_by_out_of_range_is_safe_not_500() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(),
            "fmt": "png",
            "series_styles": [{"color_by": 99}],
        },
    )
    assert resp.status_code == 200


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


# ── /api/export/figure-hitmap (#13 — preview element map) ───────────────────
def test_figure_hitmap_elements_and_axes() -> None:
    ds = {
        "time": [1.0, 2.0, 3.0, 4.0],
        "values": [[1.0, 2.0], [4.0, 3.0], [9.0, 5.0], [16.0, 7.0]],
        "labels": ["a", "b"],
        "units": ["V", "V"],
        "metadata": {},
    }
    resp = client.post("/api/export/figure-hitmap", json={
        "dataset": ds,
        "title": "T",
        "dpi": 100,
        "overrides": {"annotations": [{"x": 2.0, "y": 4.0, "text": "pk"}]},
    })
    assert resp.status_code == 200
    m = resp.json()
    assert m["width"] > 0 and m["height"] > 0
    ids = {e["id"] for e in m["elements"]}
    assert {"title", "xlabel", "legend", "series:0", "series:1", "ann:0"} <= ids
    for e in m["elements"]:  # boxes are inside the image, top-left origin
        assert 0 <= e["x0"] < e["x1"] <= m["width"] + 1
        assert -1 <= e["y0"] < e["y1"] <= m["height"] + 1
    ax = m["axes"]
    assert ax["xlim"][0] < 2 < ax["xlim"][1]
    assert ax["xlog"] is False
    assert m["image"][:10]  # base64 payload present


def _demo_corner(k: int = 2, n: int = 200) -> dict:
    import numpy as np

    rng = np.random.default_rng(3)
    samples = rng.normal(0.0, 1.0, size=(n, k)).tolist()
    return {"samples": samples, "param_names": [f"p{i}" for i in range(k)]}


def test_corner_figure_pdf_roundtrip() -> None:
    resp = client.post(
        "/api/export/corner-figure",
        json={**_demo_corner(4), "fmt": "pdf", "filename": "posterior corner"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == (
        'attachment; filename="posterior_corner.pdf"'
    )
    assert resp.content[:5] == b"%PDF-"


def test_corner_figure_png_with_truths() -> None:
    resp = client.post(
        "/api/export/corner-figure",
        json={**_demo_corner(2), "fmt": "png", "truths": [0.1, -0.2], "style": "aps"},
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_corner_figure_bad_format_is_422() -> None:
    resp = client.post(
        "/api/export/corner-figure", json={**_demo_corner(2), "fmt": "bmp"}
    )
    assert resp.status_code == 422


def test_corner_figure_shape_mismatch_is_422_not_500() -> None:
    """param_names length must match the samples column count."""
    body = _demo_corner(3)
    body["param_names"] = ["only_one"]
    resp = client.post("/api/export/corner-figure", json=body)
    assert resp.status_code == 422


def test_figure_x_breaks_override_renders() -> None:
    ds = {
        "time": [0.0, 1.0, 2.0, 3.0, 60.0, 61.0, 62.0],
        "values": [[1.0], [2.0], [1.5], [3.0], [4.0], [3.5], [5.0]],
        "labels": ["y"],
        "units": [""],
        "metadata": {},
    }
    resp = client.post("/api/export/figure", json={
        "dataset": ds,
        "fmt": "pdf",
        "overrides": {"x_breaks": [[3.0, 60.0]]},
    })
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_x_breaks_invalid_is_422() -> None:
    resp = client.post("/api/export/figure", json={
        "dataset": _xrd_dataset(),
        "overrides": {"x_breaks": [[5.0, 2.0]]},  # lo > hi
    })
    assert resp.status_code == 422


# ── /api/export/categorical-figure (gap #20 grouped/stacked bar) ────────────
def test_categorical_figure_grouped_pdf() -> None:
    resp = client.post(
        "/api/export/categorical-figure",
        json={
            "groups": ["Low", "High"],
            "series": ["A", "B"],
            "values": [[10.0, 20.0], [15.0, 25.0]],
            "errors": [[1.0, None], [2.0, 3.0]],
            "stacked": False,
            "fmt": "pdf",
            "filename": "bar chart",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == 'attachment; filename="bar_chart.pdf"'
    assert resp.content[:5] == b"%PDF-"


def test_categorical_figure_stacked_png() -> None:
    resp = client.post(
        "/api/export/categorical-figure",
        json={
            "groups": ["Low", "High"],
            "series": ["A", "B"],
            "values": [[10.0, 20.0], [15.0, 25.0]],
            "stacked": True,
            "fmt": "png",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_categorical_figure_shape_mismatch_is_422() -> None:
    resp = client.post(
        "/api/export/categorical-figure",
        json={"groups": ["A", "B"], "series": ["x"], "values": [[1.0]]},
    )
    assert resp.status_code == 422


def test_categorical_figure_bad_format_is_422() -> None:
    resp = client.post(
        "/api/export/categorical-figure",
        json={"groups": ["A"], "series": ["x"], "values": [[1.0]], "fmt": "bmp"},
    )
    assert resp.status_code == 422


# ── /api/export/facets-figure (gap #21 faceting) ────────────────────────────
def test_facets_figure_pdf() -> None:
    resp = client.post(
        "/api/export/facets-figure",
        json={
            "panels": [
                {"label": "Low", "x": [0, 1, 2], "series": [{"label": "y", "y": [1, 2, 3]}]},
                {"label": "High", "x": [0, 1, 2], "series": [{"label": "y", "y": [3, 2, 1]}]},
            ],
            "fmt": "pdf",
            "title": "facets",
            "filename": "facet grid",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == 'attachment; filename="facet_grid.pdf"'
    assert resp.content[:5] == b"%PDF-"


def test_facets_figure_empty_panels_is_422() -> None:
    resp = client.post("/api/export/facets-figure", json={"panels": []})
    assert resp.status_code == 422


def test_facets_figure_bad_format_is_422() -> None:
    panels = [{"label": "l", "x": [0, 1], "series": [{"label": "y", "y": [1, 2]}]}]
    resp = client.post(
        "/api/export/facets-figure",
        json={"panels": panels, "fmt": "bmp"},
    )
    assert resp.status_code == 422


def test_figure_custom_legend_anchor_renders() -> None:
    ds = {
        "time": [1.0, 2.0, 3.0],
        "values": [[1.0, 2.0], [2.0, 3.0], [3.0, 5.0]],
        "labels": ["a", "b"],
        "units": ["", ""],
        "metadata": {},
    }
    resp = client.post("/api/export/figure", json={
        "dataset": ds,
        "fmt": "png",
        "overrides": {"legend": {"loc": "custom", "anchor": [0.7, 0.3]}},
    })
    assert resp.status_code == 200
    assert resp.content[:4] == b"\x89PNG"
