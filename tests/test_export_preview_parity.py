"""The Publication preview renders exactly what Export writes (publication-
figures audit #4).

``/api/export/figure-hitmap`` used to hand-copy the export's renderer
arguments and missed ``error_spans``, ``width_in``/``height_in`` and
``transparent``: the preview showed the preset size with no error bars on an
opaque canvas beside an export at the page size with them. Both routes now
build their arguments in ONE function (``_flat_render_kwargs``); here the
preview's PNG must be the export's PNG pixel for pixel, at the same size.
"""

from __future__ import annotations

import base64
import io
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from quantized.app import app

client = TestClient(app)

DPI = 80


def _request(**extra: Any) -> dict[str, Any]:
    return {
        "dataset": {
            "time": [0.0, 1.0, 2.0, 3.0, 4.0],
            "values": [[1.0], [3.0], [2.0], [4.0], [3.5]],
            "labels": ["Signal"],
            "units": ["V"],
            "metadata": {},
        },
        "title": "Parity",
        "dpi": DPI,
        "width_in": 3.2,
        "height_in": 2.4,
        "transparent": True,
        "error_spans": [{"y": {"plus": [0.5] * 5, "minus": [0.3] * 5}}],
        "overrides": {"page_pad": {"left": 0.05, "right": 0.05, "top": 0.05, "bottom": 0.05}},
        **extra,
    }


def _pixels(png: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(png)).convert("RGBA"))


def _preview(body: dict[str, Any]) -> dict[str, Any]:
    r = client.post("/api/export/figure-hitmap", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _export(body: dict[str, Any]) -> bytes:
    r = client.post("/api/export/figure", json={**body, "fmt": "png"})
    assert r.status_code == 200, r.text
    return r.content


def test_preview_is_the_export_pixel_for_pixel() -> None:
    body = _request()
    hit = _preview(body)
    preview = _pixels(base64.b64decode(hit["image"]))
    export = _pixels(_export(body))
    assert (hit["width"], hit["height"]) == (round(3.2 * DPI), round(2.4 * DPI))
    assert preview.shape == export.shape
    assert np.array_equal(preview, export)


@pytest.mark.parametrize(
    "field",
    [
        {"error_spans": None},
        {"transparent": False},
        {"width_in": None, "height_in": None},
    ],
    ids=["error_spans", "transparent", "page size"],
)
def test_each_once_dropped_field_reaches_the_preview(field: dict[str, Any]) -> None:
    """Changing the field changes the preview, as it changes the export."""
    with_field = _pixels(base64.b64decode(_preview(_request())["image"]))
    without = _pixels(base64.b64decode(_preview(_request(**field))["image"]))
    assert with_field.shape != without.shape or not np.array_equal(with_field, without)


def test_transparent_preview_has_a_transparent_canvas() -> None:
    corner = _pixels(base64.b64decode(_preview(_request())["image"]))[0, 0]
    assert corner[3] == 0
