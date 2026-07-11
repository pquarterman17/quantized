"""Integration tests for POST /api/export/figure-page (TestClient).

The composer's layout/label logic is unit-tested in test_calc_figure_page;
here we prove the transport: panel payloads (the same shape /api/export/figure
takes) resolve through the shared series helper, vector-first default, panel
labels land in the exported SVG text, invalid specs map to 422 (never 500),
and the rich-text guard reaches panel titles.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _dataset(scale: float = 1.0) -> dict[str, Any]:
    return {
        "time": [10.0, 10.02, 10.04, 10.06],
        "values": [[100.0 * scale], [120.0 * scale], [95.0 * scale], [110.0 * scale]],
        "labels": ["Intensity"],
        "units": ["cps"],
        "metadata": {"x_column_name": "2Theta", "x_column_unit": "deg"},
    }


def _page_2x2(**extra: Any) -> dict[str, Any]:
    panels = [
        {"figure": {"dataset": _dataset(1.0 + i)}, "row": i // 2, "col": i % 2}
        for i in range(4)
    ]
    return {"rows": 2, "cols": 2, "panels": panels, **extra}


def test_page_2x2_svg_download_with_panel_labels() -> None:
    resp = client.post("/api/export/figure-page", json=_page_2x2(fmt="svg"))
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/svg+xml"
    assert b"<svg" in resp.content[:400]
    svg = resp.content.decode("utf-8", "ignore")
    for lbl in ("(a)", "(b)", "(c)", "(d)"):
        assert lbl in svg


def test_page_default_is_vector_pdf() -> None:
    # Vector-first: omitting fmt must yield a PDF, never raster.
    resp = client.post("/api/export/figure-page", json=_page_2x2())
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:5] == b"%PDF-"
    assert resp.headers["content-disposition"].endswith('filename="figure_page.pdf"')


def test_page_png_preview_render() -> None:
    # The composer UI's preview path: PNG at a low DPI.
    resp = client.post("/api/export/figure-page", json=_page_2x2(fmt="png", dpi=72))
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_page_empty_grid_is_422() -> None:
    resp = client.post(
        "/api/export/figure-page", json={"rows": 2, "cols": 2, "panels": []}
    )
    assert resp.status_code == 422
    assert "panel" in resp.json()["detail"]


def test_page_overlapping_spans_is_422() -> None:
    body = {
        "rows": 1,
        "cols": 2,
        "panels": [
            {"figure": {"dataset": _dataset()}, "row": 0, "col": 0, "col_span": 2},
            {"figure": {"dataset": _dataset()}, "row": 0, "col": 1},
        ],
    }
    resp = client.post("/api/export/figure-page", json=body)
    assert resp.status_code == 422
    assert "overlap" in resp.json()["detail"]


def test_page_out_of_bounds_panel_is_422() -> None:
    body = {
        "rows": 1,
        "cols": 1,
        "panels": [{"figure": {"dataset": _dataset()}, "row": 0, "col": 3}],
    }
    resp = client.post("/api/export/figure-page", json=body)
    assert resp.status_code == 422


def test_page_bad_format_is_422() -> None:
    resp = client.post("/api/export/figure-page", json=_page_2x2(fmt="bmp"))
    assert resp.status_code == 422


def test_page_panel_x_breaks_override_is_422() -> None:
    body = {
        "rows": 1,
        "cols": 1,
        "panels": [
            {
                "figure": {
                    "dataset": _dataset(),
                    "overrides": {"x_breaks": [[10.01, 10.03]]},
                },
                "row": 0,
                "col": 0,
            }
        ],
    }
    resp = client.post("/api/export/figure-page", json=body)
    assert resp.status_code == 422
    assert "x_breaks" in resp.json()["detail"]


def test_page_rich_text_panel_title_renders() -> None:
    # GOTO #5 through the page route: a valid mathtext panel title renders
    # (output differs from the literal-text version) and never errors.
    def body(title: str) -> dict[str, Any]:
        return {
            "rows": 1,
            "cols": 1,
            "fmt": "svg",
            "panels": [
                {"figure": {"dataset": _dataset()}, "row": 0, "col": 0, "title": title}
            ],
        }

    plain = client.post("/api/export/figure-page", json=body("mu0 H"))
    rich = client.post("/api/export/figure-page", json=body(r"$\mu_0 H$"))
    assert plain.status_code == 200 and rich.status_code == 200
    assert rich.content != plain.content


def test_page_panel_title_override_beats_figure_title() -> None:
    body = {
        "rows": 1,
        "cols": 1,
        "fmt": "svg",
        "panels": [
            {
                "figure": {"dataset": _dataset(), "title": "inner title"},
                "row": 0,
                "col": 0,
                "title": "override title",
            }
        ],
    }
    resp = client.post("/api/export/figure-page", json=body)
    assert resp.status_code == 200
    svg = resp.content.decode("utf-8", "ignore")
    assert "override title" in svg
    assert "inner title" not in svg


def test_page_filename_is_sanitized() -> None:
    resp = client.post(
        "/api/export/figure-page",
        json=_page_2x2(fmt="svg", filename="../fig 1?<>"),
    )
    assert resp.status_code == 200
    cd = resp.headers["content-disposition"]
    assert ".." not in cd and "<" not in cd
    assert cd.endswith('.svg"')
