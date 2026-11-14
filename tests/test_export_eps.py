"""Gap-audit-2 #16: EPS publication export through matplotlib's PostScript
backend (permissive; no GPL converter). Every figure renderer accepts it, and
the single-figure and page routes serve it as application/postscript."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure import render_figure
from quantized.calc.figure_page import _FORMATS as PAGE_FORMATS
from quantized.calc.figure_polar import _FORMATS as POLAR_FORMATS

client = TestClient(app)


def _dataset() -> dict[str, Any]:
    return {
        "time": [10.0, 20.0, 30.0, 40.0],
        "values": [[1.0], [4.0], [2.0], [3.0]],
        "labels": ["I"],
        "units": ["cps"],
        "metadata": {},
    }


def _is_eps(data: bytes) -> bool:
    return data.startswith(b"%!PS-Adobe-3.0 EPSF-3.0") and b"%%BoundingBox:" in data


def test_render_figure_writes_eps() -> None:
    assert _is_eps(render_figure([0, 1, 2], [("a", [0, 1, 4])], fmt="eps"))


@pytest.mark.parametrize("formats", [PAGE_FORMATS, POLAR_FORMATS])
def test_every_renderer_lists_eps(formats: tuple[str, ...]) -> None:
    assert "eps" in formats


def test_figure_route_serves_eps() -> None:
    resp = client.post("/api/export/figure", json={"dataset": _dataset(), "fmt": "eps"})
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/postscript"
    assert _is_eps(resp.content)


def test_figure_page_route_serves_eps() -> None:
    panel = {"figure": {"dataset": _dataset()}, "row": 0, "col": 0}
    resp = client.post(
        "/api/export/figure-page", json={"rows": 1, "cols": 1, "panels": [panel], "fmt": "eps"}
    )
    assert resp.status_code == 200, resp.text
    assert _is_eps(resp.content)
