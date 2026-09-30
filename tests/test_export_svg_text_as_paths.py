"""``svg_text_as_paths`` -- the Office-copy SVG option (PR #492 review, finding 1).

Every export defaults to ``svg.fonttype = "none"`` (``calc.figure_render.
BASE_RC``): SVG text stays live ``<text>`` naming the render's fonts (DejaVu
Sans, cmsy10 for mathtext, ...). A paste target that lacks those fonts --
typical of an Office machine -- substitutes its own, so the pasted figure no
longer matches the PNG or the exported file. "Copy Figure" therefore asks for
``svg_text_as_paths=true`` on the raw ``image/svg+xml`` representation it puts
on the clipboard: every glyph becomes a path and the SVG depends on no fonts.

What this pins, per route that the copy commands POST to:

* the flag removes every ``<text>`` element (plain labels AND mathtext);
* the default (flag omitted) is unchanged: live ``<text>`` is still there;
* the flag is a no-op for raster output (byte-identical PNG).
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _dataset() -> dict[str, Any]:
    xs = [float(i) for i in range(12)]
    return {
        "time": xs,
        "values": [[x**0.5, 2.0 - x] for x in xs],
        "labels": ["Moment", "Field"],
        "units": ["emu", "Oe"],
        "metadata": {},
    }


def _figure(fmt: str, **extra: Any) -> dict[str, Any]:
    return {
        "dataset": _dataset(),
        "fmt": fmt,
        "title": "Hysteresis",
        "x_label": r"$\mu_0 H$ (T)",
        "y_label": "M (emu)",
        **extra,
    }


def _facets() -> list[dict[str, Any]]:
    return [
        {"label": lvl, "x": [0.0, 1.0, 2.0], "series": [{"label": "M", "y": [1.0, 2.0, 1.5]}]}
        for lvl in ("A", "B")
    ]


def _page(fmt: str, **extra: Any) -> dict[str, Any]:
    panels = [{"figure": _figure(fmt), "row": 0, "col": i} for i in range(2)]
    return {"rows": 1, "cols": 2, "panels": panels, "fmt": fmt, **extra}


def _post(route: str, body: dict[str, Any]) -> bytes:
    resp = client.post(route, json=body)
    assert resp.status_code == 200, resp.text
    return resp.content


_CASES = [
    pytest.param("/api/export/figure", _figure, id="figure"),
    pytest.param(
        "/api/export/figure",
        lambda fmt, **kw: _figure(fmt, facets=_facets(), **kw),
        id="figure-facets",
    ),
    pytest.param("/api/export/figure-page", _page, id="figure-page"),
]


@pytest.mark.parametrize(("route", "body"), _CASES)
def test_default_svg_keeps_live_text(route: str, body: Any) -> None:
    svg = _post(route, body("svg")).decode("utf-8")
    assert "<text" in svg


@pytest.mark.parametrize(("route", "body"), _CASES)
def test_text_as_paths_svg_has_no_text_elements(route: str, body: Any) -> None:
    svg = _post(route, body("svg", svg_text_as_paths=True)).decode("utf-8")
    assert svg.lstrip().startswith(("<?xml", "<svg"))
    assert "<text" not in svg
    # The glyphs are still drawn -- as path outlines referenced by <use>.
    assert "<use" in svg


@pytest.mark.parametrize(("route", "body"), _CASES)
def test_text_as_paths_is_a_noop_for_png(route: str, body: Any) -> None:
    plain = _post(route, body("png", dpi=72))
    flagged = _post(route, body("png", dpi=72, svg_text_as_paths=True))
    assert plain[:8] == b"\x89PNG\r\n\x1a\n"
    assert flagged == plain


def test_calc_renderer_takes_the_flag_directly() -> None:
    from quantized.calc.figure import render_figure

    xs = [0.0, 1.0, 2.0]
    series = [("M", [1.0, 2.0, 3.0])]
    live = render_figure(xs, series, x_label="x", fmt="svg").decode("utf-8")
    outlined = render_figure(
        xs, series, x_label="x", fmt="svg", svg_text_as_paths=True
    ).decode("utf-8")
    assert "<text" in live
    assert "<text" not in outlined
