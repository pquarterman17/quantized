"""Panel insets (gap #15) through the REAL /api/export/figure route -- proves
the FastAPI transport (the untyped ``overrides`` dict, see
``routes/export_figures.py``'s own ``overrides: dict[str, Any] | None``)
carries ``panel_insets`` from an HTTP request down into
``calc.figure_panel_insets``, not just the pure-function path already
exercised by ``tests/test_calc_figure_panel_insets.py``."""

from __future__ import annotations

import base64
import io
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image

from quantized.app import app

client = TestClient(app)


def _dataset() -> dict[str, Any]:
    return {
        "time": [0, 1, 2, 3],
        "values": [[1, 50], [2, 60], [3, 55], [4, 70]],
        "labels": ["M", "T"],
        "units": ["emu", "K"],
        "metadata": {},
    }


def _body(overrides: dict[str, Any]) -> dict[str, Any]:
    return {
        "dataset": _dataset(),
        "y_keys": [0],
        "fmt": "svg",
        "overrides": overrides,
    }


def _tiny_png_base64() -> str:
    img = Image.new("RGB", (2, 2), color=(10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def test_dataset_panel_inset_renders_through_the_route() -> None:
    body = _body({
        "panel_insets": [
            {
                "at": [0.1, 0.1, 0.3, 0.3],
                "content": {
                    "kind": "dataset",
                    "x": [0, 1, 2],
                    "series": [{"label": "fit", "y": [1, 2, 3]}],
                },
            }
        ]
    })
    resp = client.post("/api/export/figure", json=body)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("image/svg")
    assert b"<svg" in resp.content


def test_image_panel_inset_renders_through_the_route() -> None:
    body = _body({
        "panel_insets": [
            {
                "at": [0.1, 0.1, 0.3, 0.3],
                "content": {"kind": "image", "data": _tiny_png_base64(), "format": "png"},
            }
        ]
    })
    resp = client.post("/api/export/figure", json=body)
    assert resp.status_code == 200, resp.text
    assert b"<svg" in resp.content


def test_table_panel_inset_renders_through_the_route() -> None:
    body = _body({
        "panel_insets": [
            {
                "at": [0.1, 0.1, 0.3, 0.3],
                "content": {"kind": "table", "headers": ["p", "v"], "rows": [["x0", "1.2"]]},
            }
        ]
    })
    resp = client.post("/api/export/figure", json=body)
    assert resp.status_code == 200, resp.text
    assert b"<svg" in resp.content


def test_malformed_panel_inset_is_refused_with_422() -> None:
    bad = {"at": [0, 0, -1, 1], "content": {"kind": "table", "rows": [["1"]]}}
    resp = client.post("/api/export/figure", json=_body({"panel_insets": [bad]}))
    assert resp.status_code == 422


def test_multiple_panel_insets_all_render_through_the_route() -> None:
    body = _body({
        "panel_insets": [
            {"at": [0.05, 0.05, 0.25, 0.25], "content": {"kind": "table", "rows": [["a"]]}},
            {
                "at": [0.6, 0.6, 0.25, 0.25],
                "content": {
                    "kind": "dataset",
                    "x": [0, 1],
                    "series": [{"label": "s", "y": [0, 1]}],
                },
            },
        ]
    })
    resp = client.post("/api/export/figure", json=body)
    assert resp.status_code == 200, resp.text
    assert b"<svg" in resp.content
