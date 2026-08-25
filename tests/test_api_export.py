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


# ── /api/export/figure facets (FIGURE_AUTHORING_WORKFLOW_PLAN F4.4, export
# half): a faceted Stage window must export as the SAME small-multiples
# grid, not a single overlaid plot — the named gap #222 left open (its
# module doc: "FigureSpec has no transport fields for facetKey"). ─────────
def _xy_facets() -> list[dict]:
    return [
        {
            "label": "level 0", "x": [0.0, 1.0, 2.0],
            "series": [{"label": "y", "y": [0.0, 1.0, 2.0]}],
        },
        {
            "label": "level 1", "x": [0.0, 1.0, 2.0],
            "series": [{"label": "y", "y": [1.0, 2.0, 3.0]}],
        },
    ]


def test_figure_facets_renders_grid_not_single_panel() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(), "fmt": "svg", "facets": _xy_facets(), "filename": "facets1",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/svg+xml"
    assert resp.headers["content-disposition"] == 'attachment; filename="facets1.svg"'
    svg = resp.content.decode("utf-8", "ignore")
    # Both facet-level titles render — proof this is the small-multiples
    # grid (calc.figure_facets), not the flat single-panel path, which never
    # sees these labels at all.
    assert "level 0" in svg
    assert "level 1" in svg


def test_figure_facets_pdf_and_png_render() -> None:
    for fmt, magic in (("pdf", b"%PDF-"), ("png", b"\x89PNG\r\n\x1a\n")):
        resp = client.post(
            "/api/export/figure",
            json={"dataset": _xrd_dataset(), "fmt": fmt, "facets": _xy_facets()},
        )
        assert resp.status_code == 200
        assert resp.content[: len(magic)] == magic


def test_figure_facets_title_and_labels_apply_figure_wide() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(), "fmt": "svg", "facets": _xy_facets(),
            "title": "Faceted title", "x_label": "Time (s)", "y_label": "Signal (V)",
        },
    )
    assert resp.status_code == 200
    svg = resp.content.decode("utf-8", "ignore")
    assert "Faceted title" in svg
    assert "Time (s)" in svg
    assert "Signal (V)" in svg


def test_figure_facets_empty_list_falls_back_to_single_panel() -> None:
    # An empty (not None) facets list is falsy -> today's flat single-panel
    # path, matching the calc layer's own `if req.facets:` gate (same
    # contract as StatplotFigureRequest/CategoricalFigureRequest).
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "pdf", "facets": []},
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_facets_null_cells_render_as_gaps() -> None:
    # The frontend's null-gap wire convention (a non-finite cell) must not
    # 422 -- calc.figure_facets converts null -> NaN via np.asarray(dtype=float).
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(), "fmt": "pdf",
            "facets": [
                {
                    "label": "a", "x": [0.0, None, 2.0],
                    "series": [{"label": "y", "y": [1.0, 2.0, None]}],
                },
            ],
        },
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_facets_bad_format_is_422_not_500() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "bmp", "facets": _xy_facets()},
    )
    assert resp.status_code == 422


def test_figure_facets_malformed_panel_is_422_not_500() -> None:
    # A panel whose series `y` disagrees in length with `x` is a malformed
    # payload (a frontend bug, not a user-triggerable state) -- must be
    # refused cleanly (422), never a 500.
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(), "fmt": "pdf",
            "facets": [
                {"label": "a", "x": [0.0, 1.0], "series": [{"label": "y", "y": [1.0, 2.0, 3.0]}]},
            ],
        },
    )
    assert resp.status_code == 422


def test_figure_facets_panel_with_no_series_still_renders() -> None:
    # A facet level with zero series (every channel hidden for that panel)
    # is not malformed -- an empty axes cell, not a 422.
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _xrd_dataset(), "fmt": "pdf",
            "facets": [{"label": "a", "x": [], "series": []}],
        },
    )
    assert resp.status_code == 200


# ── Fix-round C1: the REAL wire shape (`lib/figureContract.ts` marks
# x_log/y_log "unsupported -- legacy wire fallback; derive x_scale
# instead", and `buildFigureSpecForView` only ever emits x_scale/y_scale) is
# x_scale/y_scale with NO x_log/y_log booleans at all -- a log-scaled
# faceted view must not silently export with linear axes. ──────────────────
def test_figure_facets_x_scale_log_round_trips_to_log_axes_no_legacy_booleans() -> None:
    from unittest.mock import patch

    import matplotlib.figure

    captured: dict[str, matplotlib.figure.Figure] = {}
    real_savefig = matplotlib.figure.Figure.savefig

    def fake_savefig(self: matplotlib.figure.Figure, *a: object, **kw: object) -> None:
        captured["fig"] = self
        real_savefig(self, *a, **kw)

    with patch.object(matplotlib.figure.Figure, "savefig", fake_savefig):
        resp = client.post(
            "/api/export/figure",
            json={
                "dataset": _xrd_dataset(), "fmt": "pdf", "facets": _xy_facets(),
                # deliberately no x_log/y_log -- the actual wire shape.
                "x_scale": "log", "y_scale": "log",
            },
        )
    assert resp.status_code == 200
    fig = captured["fig"]
    axes = [ax for ax in fig.axes if ax.get_visible()]
    assert len(axes) == 2
    for ax in axes:
        assert ax.get_xscale() == "log"
        assert ax.get_yscale() == "log"


# ── Fix-round C4: the facet branch used to substitute `req.x_label or ""`
# instead of deriving "label (unit)" from the dataset like the flat path
# does -- an unlabeled faceted export must still show the auto-derived
# axis labels. ───────────────────────────────────────────────────────────
def test_figure_facets_derives_axis_labels_when_absent() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "svg", "facets": _xy_facets()},
    )
    assert resp.status_code == 200
    svg = resp.content.decode("utf-8", "ignore")
    # _xrd_dataset's metadata names its x column "2Theta"/"deg" and its one
    # channel "Intensity"/"cps" -- the SAME "label (unit)" derivation
    # `_figure_series` applies on the flat path.
    assert "2Theta (deg)" in svg
    assert "Intensity (cps)" in svg


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


# ── JMP_GAP J5 residual: connect-group-means "interaction plot" line ───────


def test_statplot_box_connect_means_pdf() -> None:
    resp = client.post(
        "/api/export/statplot-figure",
        json={"kind": "box", "data": [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]],
              "labels": ["A", "B"], "fmt": "pdf", "show_connect_means": True},
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_statplot_show_connect_means_omitted_is_byte_identical_to_false() -> None:
    # New opt-in flag -- an existing consumer that never sends it must see
    # BYTE-IDENTICAL output to explicitly sending it false.
    base = {"kind": "box", "data": [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]],
            "labels": ["A", "B"], "fmt": "png"}
    omitted = client.post("/api/export/statplot-figure", json=base)
    explicit_false = client.post(
        "/api/export/statplot-figure", json={**base, "show_connect_means": False},
    )
    assert omitted.status_code == explicit_false.status_code == 200
    assert omitted.content == explicit_false.content


# ── /api/export/statplot-figure facets (GUI_INTERACTION #12 slice 4b) ───────
def test_statplot_facets_box_pdf() -> None:
    resp = client.post(
        "/api/export/statplot-figure",
        json={
            "kind": "box",
            "data": [[1, 2, 3]],  # unused single-panel fallback, still required
            "facets": [
                {"label": "grp=0", "data": [[1, 2, 3, 4], [2, 3, 4, 5]], "labels": ["A", "B"]},
                {"label": "grp=1", "data": [[5, 6, 7], [6, 7, 8]], "labels": ["A", "B"]},
            ],
            "fmt": "pdf",
            "filename": "box facets",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == 'attachment; filename="box_facets.pdf"'
    assert resp.content[:5] == b"%PDF-"


def test_statplot_facets_per_facet_kind_mixes_box_and_violin() -> None:
    # Per-slice mode fidelity: a violin facet that degraded to box on screen
    # carries its own "kind", independent of the request's top-level "kind".
    resp = client.post(
        "/api/export/statplot-figure",
        json={
            "kind": "violin",
            "data": [[1, 2, 3]],
            "facets": [
                {"label": "grp=0", "kind": "violin", "data": [[1, 2, 3, 4, 5]]},
                {"label": "grp=1", "kind": "box", "data": [[2, 3, 4, 5, 6]]},
            ],
            "fmt": "png",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_statplot_facets_bad_kind_is_422() -> None:
    resp = client.post(
        "/api/export/statplot-figure",
        json={
            "kind": "box",
            "data": [[1, 2]],
            "facets": [{"label": "a", "kind": "swarm", "data": [[1, 2, 3]]}],
        },
    )
    assert resp.status_code == 422


def test_statplot_facets_empty_list_falls_back_to_single_panel() -> None:
    # An empty (not None) facets list is falsy -> today's flat single-panel
    # path, matching the calc layer's own `if req.facets:` gate.
    resp = client.post(
        "/api/export/statplot-figure",
        json={"kind": "box", "data": [[1, 2, 3], [4, 5, 6]], "facets": [], "fmt": "pdf"},
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


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
    # FU-facet-hitmap (flat-path-unchanged evidence): the flat response's key
    # set is EXACTLY what it was before per-panel geometry existed -- no
    # `panels` key leaking in, `axes` still the single dict.
    assert set(m.keys()) == {"image", "width", "height", "elements", "axes"}
    assert isinstance(m["axes"], dict)


# ── FU-facet-hitmap (closes the former R1/fix-round-3 gap): a facet-bound
# hitmap request now returns REAL per-panel geometry -- one `panels` entry
# per facet panel (pixel rect + data limits + facet label) and `elements`
# tagged with a `panel` index -- instead of `elements: []` + a synthetic
# whole-image `axes` rect. ───────────────────────────────────────────────────
def test_figure_hitmap_facets_returns_per_panel_axes_and_elements() -> None:
    resp = client.post(
        "/api/export/figure-hitmap",
        json={"dataset": _xrd_dataset(), "dpi": 100, "facets": _xy_facets()},
    )
    assert resp.status_code == 200
    m = resp.json()
    assert m["width"] > 0 and m["height"] > 0
    # No single-`axes` field for a faceted response -- `panels` replaces it.
    assert "axes" not in m
    panels = m["panels"]
    assert len(panels) == len(_xy_facets()) == 2
    labels = {p["label"] for p in panels}
    assert labels == {"level 0", "level 1"}
    # Distinct, NON-OVERLAPPING pixel rects (2 panels -> side-by-side columns,
    # `_grid_shape(2)` = 1 row x 2 cols): panel 0 must end at or before where
    # panel 1 begins in x.
    p0, p1 = sorted(panels, key=lambda p: p["panel"])
    assert p0["x1"] <= p1["x0"]
    assert (p0["x0"], p0["y0"], p0["x1"], p0["y1"]) != (p1["x0"], p1["y0"], p1["x1"], p1["y1"])
    # Distinct DATA limits -- panel 0's y is [0,1,2], panel 1's is [1,2,3]
    # (`_xy_facets()`), each panel keeping its own independent y-autoscale
    # (`render_facets_figure`'s own doc), so a point mapped through panel 0's
    # ylim would give a VISIBLY different (wrong) answer for a click that
    # landed in panel 1.
    assert p0["ylim"] != p1["ylim"]
    assert p0["ylim"][1] < p1["ylim"][1]
    for p in panels:
        assert p["xscale"] == "linear" and p["yscale"] == "linear"
    # `elements` are real, non-empty, and each carries its panel index.
    assert m["elements"] != []
    panel_indices = {e["panel"] for e in m["elements"]}
    assert panel_indices == {0, 1}
    ids = {e["id"] for e in m["elements"]}
    assert {"title", "series:0"} <= ids
    for e in m["elements"]:  # boxes are inside the image, top-left origin
        assert 0 <= e["x0"] < e["x1"] <= m["width"] + 1
        assert -1 <= e["y0"] < e["y1"] <= m["height"] + 1

    import base64
    from io import BytesIO as _BytesIO

    from PIL import Image

    png = base64.b64decode(m["image"])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    with Image.open(_BytesIO(png)) as im:
        assert im.size == (m["width"], m["height"])


# ── FU-facet-hitmap fix round 2 (G1): a series line's `get_window_extent` is
# the transform of its FULL data extent, unclipped to the axes' current view
# -- a zoomed `x_lim` override (exactly what a Stage box-zoom sets) put most
# of a line's raw data far outside the narrowed view, ballooning the reported
# pixel box to several times the image width and spilling across every
# sibling panel's own hit-region -- the moment box-zoom is used, per-panel
# targeting (the entire point of this lane) broke. `test_..._per_panel_axes_
# and_elements` above only ever exercised the no-override case, where the
# bug is invisible (a line's natural data range already fits the default
# view) -- this is the override-bearing case that catches it. ───────────────
def test_figure_hitmap_facets_series_boxes_clip_to_own_panel_under_zoom() -> None:
    n = 4
    facets = [
        {
            "label": f"level {i}", "x": list(range(10)),
            "series": [{"label": "y", "y": [float(v) for v in range(10)]}],
        }
        for i in range(n)
    ]
    resp = client.post(
        "/api/export/figure-hitmap",
        json={
            "dataset": _xrd_dataset(), "dpi": 100, "facets": facets,
            "overrides": {"x_lim": [4.0, 5.0]},
        },
    )
    assert resp.status_code == 200
    m = resp.json()
    panels = {p["panel"]: p for p in m["panels"]}
    assert len(panels) == n
    series_boxes = [e for e in m["elements"] if e["id"] == "series:0"]
    assert len(series_boxes) == n  # every panel's line still visible in [4,5]
    for e in series_boxes:
        p = panels[e["panel"]]
        # The box must stay INSIDE its own panel's axes rect -- never
        # extend past it (the exact regression: boxes several times the
        # image width, reaching every other panel).
        assert p["x0"] - 1e-6 <= e["x0"] < e["x1"] <= p["x1"] + 1e-6
        assert p["y0"] - 1e-6 <= e["y0"] < e["y1"] <= p["y1"] + 1e-6
    # No two panels' series boxes overlap -- the actual per-panel-targeting
    # property this lane exists to guarantee.
    for a in series_boxes:
        for b in series_boxes:
            if a["panel"] == b["panel"]:
                continue
            overlap_x = a["x0"] < b["x1"] and b["x0"] < a["x1"]
            overlap_y = a["y0"] < b["y1"] and b["y0"] < a["y1"]
            assert not (overlap_x and overlap_y), (a["panel"], b["panel"])
    # Titles are UNAFFECTED by the zoom (a text glyph's bbox, not a
    # data-space transform) -- still one per panel, never dropped.
    assert len([e for e in m["elements"] if e["id"] == "title"]) == n


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


# ── /api/export/categorical-figure facets (GUI_INTERACTION #12 slice 4b) ────
def test_categorical_facets_grouped_pdf() -> None:
    resp = client.post(
        "/api/export/categorical-figure",
        json={
            "groups": ["Low"], "series": ["A"], "values": [[1.0]],  # unused fallback
            "facets": [
                {
                    "label": "grp=0", "groups": ["Low", "High"], "series": ["A", "B"],
                    "values": [[10.0, 20.0], [15.0, 25.0]], "errors": [[1.0, None], [2.0, 3.0]],
                },
                {
                    "label": "grp=1", "groups": ["Low", "High"], "series": ["A", "B"],
                    "values": [[5.0, 8.0], [6.0, 9.0]],
                },
            ],
            "fmt": "pdf",
            "filename": "bar facets",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == 'attachment; filename="bar_facets.pdf"'
    assert resp.content[:5] == b"%PDF-"


def test_categorical_facets_panels_with_different_category_sets() -> None:
    resp = client.post(
        "/api/export/categorical-figure",
        json={
            "groups": ["Low"], "series": ["A"], "values": [[1.0]],
            "facets": [
                {
                    "label": "a", "groups": ["Low", "High"], "series": ["A"],
                    "values": [[1.0], [2.0]],
                },
                {"label": "b", "groups": ["Low"], "series": ["A"], "values": [[3.0]]},
            ],
            "fmt": "png",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_categorical_facets_shape_mismatch_is_422() -> None:
    resp = client.post(
        "/api/export/categorical-figure",
        json={
            "groups": ["A"], "series": ["x"], "values": [[1.0]],
            "facets": [{"label": "a", "groups": ["A", "B"], "series": ["x"], "values": [[1.0]]}],
        },
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


# ── Secondary (right) Y axis / matplotlib twinx (y2 export parity) ──────────
def test_figure_y2_subset_renders_a_real_twinx() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _three_channel_dataset(),
            "fmt": "svg",
            "y2_keys": ["c"],
            "y2_label": "Temperature (K)",
        },
    )
    assert resp.status_code == 200
    svg = resp.content.decode("utf-8", "ignore")
    assert "Temperature (K)" in svg


def test_figure_y2_keys_not_a_subset_of_y_keys_is_422() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _three_channel_dataset(),
            "fmt": "pdf",
            "y_keys": ["a", "b"],
            "y2_keys": ["c"],  # not in y_keys
        },
    )
    assert resp.status_code == 422
    assert "y2_keys" in resp.json()["detail"]


def test_figure_y2_keys_empty_is_todays_single_axis_behaviour() -> None:
    # PNG (not PDF): a PDF embeds a /CreationDate second-resolution
    # timestamp, so two renders straddling a second boundary would differ by
    # those bytes alone (see test_calc_figure.py's `_stable_pdf` precedent).
    ds = _three_channel_dataset()
    no_y2 = client.post("/api/export/figure", json={"dataset": ds, "fmt": "png"})
    empty_y2 = client.post(
        "/api/export/figure", json={"dataset": ds, "fmt": "png", "y2_keys": []}
    )
    assert no_y2.status_code == empty_y2.status_code == 200
    assert no_y2.content == empty_y2.content


# ── Grouped xy split (GUI_INTERACTION #12 Slice 5) ──────────────────────────
def _group_fixture() -> dict[str, Any]:
    # Same tiny fixture as calc.plotting's test_build_grouped_series_matches_
    # frontend_parity_fixture (tests/test_calc_plotting.py) and the
    # frontend's plotspec.test.ts parity test -- row 2's NaN VALUE and row
    # 4's NaN GROUP prove finite-masking / non-finite-level-dropping.
    return {
        "time": [0.0, 1.0, 2.0, 3.0, 4.0],
        "values": [[10.0, 1.0], [20.0, 2.0], [None, 1.0], [40.0, 2.0], [50.0, None]],
        "labels": ["Value", "Group"],
        "units": ["V", ""],
        "metadata": {},
    }


def test_figure_group_col_splits_series_and_renders() -> None:
    # Two points per level -- a masked line with only ONE finite point draws
    # a zero-width artist that the hitmap silently drops (calc.figure_hitmap's
    # bbox.width <= 0 guard), so this is a deliberately "2+ points/level"
    # fixture, not the single-point-per-level parity fixture above.
    ds = {
        "time": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
        "values": [[1.0, 10.0], [2.0, 10.0], [3.0, 20.0], [4.0, 20.0], [5.0, 30.0], [6.0, 30.0]],
        "labels": ["a", "g"],
        "units": ["V", ""],
        "metadata": {},
    }
    resp = client.post(
        "/api/export/figure-hitmap",
        json={"dataset": ds, "y_keys": ["a"], "group_col": 1, "dpi": 100},
    )
    assert resp.status_code == 200
    ids = {e["id"] for e in resp.json()["elements"]}
    assert {"series:0", "series:1", "series:2"} <= ids  # one per level
    assert "series:3" not in ids


def test_figure_group_col_series_labels_render_in_svg() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _group_fixture(),
            "fmt": "svg",
            "y_keys": ["Value"],
            "group_col": 1,
        },
    )
    assert resp.status_code == 200
    svg = resp.content.decode("utf-8", "ignore")
    # Integer-valued levels render WITHOUT a trailing ".0" (JS `${level}`
    # coercion, not Python's `str(float)` -- calc.plotting._format_level).
    assert "Value (Group=1)" in svg
    assert "Value (Group=2)" in svg
    assert "Group=1.0" not in svg
    assert "Group=2.0" not in svg


def test_figure_group_col_with_y2_keys_is_422() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _three_channel_dataset(),
            "group_col": 2,
            "y2_keys": ["b"],
        },
    )
    assert resp.status_code == 422
    assert "group_col" in resp.json()["detail"]


def test_figure_group_col_bad_column_is_422() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _three_channel_dataset(), "group_col": 99},
    )
    assert resp.status_code == 422


def test_figure_without_group_col_is_byte_identical_to_before() -> None:
    ds = _xrd_dataset()
    omitted = client.post("/api/export/figure", json={"dataset": ds, "fmt": "png"})
    explicit_none = client.post(
        "/api/export/figure", json={"dataset": ds, "fmt": "png", "group_col": None}
    )
    assert omitted.status_code == explicit_none.status_code == 200
    assert omitted.content == explicit_none.content


def test_figure_y2_lim_and_scale_render() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": _three_channel_dataset(),
            "fmt": "png",
            "y2_keys": ["c"],
            "y2_scale": "log",
            "overrides": {"y2_lim": [1.0, 10.0]},
        },
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_figure_hitmap_with_y2_does_not_error() -> None:
    resp = client.post(
        "/api/export/figure-hitmap",
        json={"dataset": _three_channel_dataset(), "y2_keys": ["c"], "dpi": 100},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["image"]
    # Primary series ("a", "b") remain individually hit-testable; the y2
    # series ("c") is rendered but not required to be (see calc.figure_y2's
    # doc on the hitmap's known y2 limitation).
    ids = {e["id"] for e in body["elements"]}
    assert "series:0" in ids and "series:1" in ids


def test_figure_page_panel_with_y2_keys_renders_a_real_twinx() -> None:
    # GUI_INTERACTION #12 slice 4c: FIXED — a page panel's y2_keys now
    # threads through to a real Axes.twinx() (calc.figure_page._draw_panel),
    # the same as the single-figure /figure route (test_figure_y2_subset_
    # renders_a_real_twinx above); it no longer fails loud with a 422.
    resp = client.post(
        "/api/export/figure-page",
        json={
            "rows": 1,
            "cols": 1,
            "panels": [
                {
                    "figure": {
                        "dataset": _three_channel_dataset(), "y2_keys": ["c"],
                        "y2_scale": "log",
                    },
                    "row": 0,
                    "col": 0,
                }
            ],
            "fmt": "png",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


# ── F4.4 follow-up (2026-08-24): routes/export_page.py used to render a
# facet-bound panel by pre-rendering a whole PNG (render_facets_figure at a
# fixed dpi) and embedding it via imshow -- one raster cell inside an
# otherwise-vector PDF/SVG page. A faceted page panel now renders as a REAL
# vector sub-grid of matplotlib Axes inside the cell (calc.figure_page_facets
# .draw_facet_panel_cell, reusing calc.figure_facets.draw_facet_grid's shared
# per-panel core) -- no AxesImage anywhere on the page. Replaces
# test_figure_page_facet_panel_embeds_as_raster_grid_not_flattened, renamed
# honestly now that the behavior it asserted (raster embed) is gone. ────────
def test_figure_page_facet_panel_renders_as_vector_sub_grid_not_raster() -> None:
    from unittest.mock import patch

    import matplotlib.figure

    captured: dict[str, matplotlib.figure.Figure] = {}
    real_savefig = matplotlib.figure.Figure.savefig

    def fake_savefig(self: matplotlib.figure.Figure, *a: object, **kw: object) -> None:
        captured["fig"] = self
        real_savefig(self, *a, **kw)

    with patch.object(matplotlib.figure.Figure, "savefig", fake_savefig):
        resp = client.post(
            "/api/export/figure-page",
            json={
                "rows": 1,
                "cols": 2,
                "panels": [
                    {
                        "figure": {"dataset": _xrd_dataset(), "facets": _xy_facets()},
                        "row": 0, "col": 0,
                    },
                    {
                        "figure": {"dataset": _xrd_dataset()},
                        "row": 0, "col": 1,
                    },
                ],
                "fmt": "pdf",
            },
        )
    assert resp.status_code == 200
    fig = captured["fig"]
    axes = list(fig.axes)
    # No AxesImage anywhere on the page -- the whole page stays true vector.
    assert all(len(ax.images) == 0 for ax in axes)
    # _xy_facets() has 2 levels -> calc.figure_facets._grid_shape(2) == (1, 2):
    # 1 invisible cell-frame axes (the page-letter anchor) + 2 real facet
    # sub-axes, plus the 1 sibling flat panel = 4 axes total.
    assert len(axes) == 4
    facet_subs = [ax for ax in axes if ax.get_title() in ("level 0", "level 1")]
    assert {ax.get_title() for ax in facet_subs} == {"level 0", "level 1"}
    for ax in facet_subs:
        assert len(ax.get_lines()) == 1
    # The facet sub-grid shares x among ITSELF only -- never with the sibling
    # flat panel on the same page.
    assert facet_subs[0].get_shared_x_axes().joined(facet_subs[0], facet_subs[1])
    sibling_axes = [ax for ax in axes if ax not in facet_subs and ax.get_lines()]
    assert len(sibling_axes) == 1
    assert not facet_subs[0].get_shared_x_axes().joined(facet_subs[0], sibling_axes[0])
    # The page letter still renders for the faceted cell (anchored on the
    # cell-frame axes, same mechanism every other panel's letter uses).
    all_texts = [t.get_text() for ax in axes for t in ax.texts]
    assert "(a)" in all_texts
    assert "(b)" in all_texts


# ── V5 (fix round 2): routing the nested figure's overrides STRAIGHT onto
# PagePanel sent a facet panel through _validate_panel_overrides, which
# rejects x_breaks/margins as page-incompatible -- correct for an ORDINARY
# panel, but the facet renderer never looks at those keys at all (the
# standalone facet path's generic _validate_overrides accepted-and-ignored
# them). A well-formed margins/x_breaks override on a facet panel must
# still 200 and render (silently unused), not 422; a genuinely malformed
# override shape must still 422 (only the CONSUMED subset is narrowed, not
# validation). ──────────────────────────────────────────────────────────
def test_figure_page_facet_panel_with_page_incompatible_overrides_still_renders() -> None:
    resp = client.post(
        "/api/export/figure-page",
        json={
            "rows": 1, "cols": 1,
            "panels": [
                {
                    "figure": {
                        "dataset": _xrd_dataset(), "facets": _xy_facets(),
                        "overrides": {"margins": {"left": 0.2}},
                    },
                    "row": 0, "col": 0,
                },
            ],
            "fmt": "pdf",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_page_facet_panel_x_breaks_override_still_renders() -> None:
    resp = client.post(
        "/api/export/figure-page",
        json={
            "rows": 1, "cols": 1,
            "panels": [
                {
                    "figure": {
                        "dataset": _xrd_dataset(), "facets": _xy_facets(),
                        "overrides": {"x_breaks": [[0.0, 1.0]]},
                    },
                    "row": 0, "col": 0,
                },
            ],
            "fmt": "pdf",
        },
    )
    assert resp.status_code == 200


def test_figure_page_facet_panel_malformed_overrides_still_422s() -> None:
    resp = client.post(
        "/api/export/figure-page",
        json={
            "rows": 1, "cols": 1,
            "panels": [
                {
                    "figure": {
                        "dataset": _xrd_dataset(), "facets": _xy_facets(),
                        "overrides": {"x_lim": [1.0]},  # malformed: needs [lo, hi]
                    },
                    "row": 0, "col": 0,
                },
            ],
            "fmt": "pdf",
        },
    )
    assert resp.status_code == 422


def test_figure_page_two_panels_one_with_y2_one_without_both_render() -> None:
    # A mixed page (a doubleY panel alongside an ordinary one) must not
    # cross-contaminate — each panel's own y2_mask is independent.
    resp = client.post(
        "/api/export/figure-page",
        json={
            "rows": 1,
            "cols": 2,
            "panels": [
                {
                    "figure": {"dataset": _three_channel_dataset(), "y2_keys": ["c"]},
                    "row": 0, "col": 0,
                },
                {
                    "figure": {"dataset": _three_channel_dataset()},
                    "row": 0, "col": 1,
                },
            ],
            "fmt": "pdf",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"


def test_figure_page_panel_y2_keys_not_a_subset_of_y_keys_is_422() -> None:
    resp = client.post(
        "/api/export/figure-page",
        json={
            "rows": 1,
            "cols": 1,
            "panels": [
                {
                    "figure": {
                        "dataset": _three_channel_dataset(), "y_keys": ["a", "b"],
                        "y2_keys": ["c"],
                    },
                    "row": 0,
                    "col": 0,
                }
            ],
            "fmt": "pdf",
        },
    )
    assert resp.status_code == 422


# --- MAIN_PLAN #35: transparent background over the wire --------------------


def _alpha_at_origin(png: bytes) -> int:
    from io import BytesIO

    from PIL import Image

    with Image.open(BytesIO(png)) as im:
        return im.convert("RGBA").getpixel((0, 0))[3]


def test_figure_transparent_defaults_off() -> None:
    """Omitting the field must not change any existing caller's output."""
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "png", "dpi": 50},
    )
    assert resp.status_code == 200
    assert _alpha_at_origin(resp.content) == 255


def test_figure_transparent_true_reaches_the_renderer() -> None:
    resp = client.post(
        "/api/export/figure",
        json={"dataset": _xrd_dataset(), "fmt": "png", "dpi": 50, "transparent": True},
    )
    assert resp.status_code == 200
    assert _alpha_at_origin(resp.content) == 0
