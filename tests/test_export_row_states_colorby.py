"""G24 row states on a colour-by / size-by series -- canvas <-> export parity, BACKEND half.

``frontend/src/lib/rowStateColorBy.test.ts`` builds, from ONE row style, what the canvas paints
per point (the colour scale's spec with the row states over it) and the real export request for
three series: colour-by, size-by and both, and pins them as
``tests/fixtures/wire/row_states_colorby.json``. This file posts each request to the real
``/api/export/figure`` route, captures the matplotlib figure and reads every drawn point back:

* a row WITH a state is drawn in its exact colour and glyph, a row without keeps the scale's
  colour (within a few 8-bit steps: the screen samples its own viridis table) or the series
  stroke, and the series' glyph;
* a size-by series keeps each point's diameter (the sizes are in points squared);
* the excluded row is not drawn; the row with a state and a missing colour value IS drawn;
* greyscale drops the row colours of a colour-by series and keeps the glyphs;
* a wrong-length array fails closed (the series draws as before, no row states).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.colors import to_hex, to_rgb

from quantized.app import app

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "row_states_colorby.json"
CASES: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
GLYPH_BY_VERTICES = {26: "circle", 5: "square", 4: "triangle"}
SCALE_TOLERANCE = 12 / 255  # per channel: the screen's viridis table vs matplotlib's


def _render(body: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json={**body, "fmt": "png"})
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1]


def _points(fig: Any) -> dict[float, dict[str, Any]]:
    """Every drawn scatter point of the plot axes by its y value: fill, glyph and size (pt^2)."""
    out: dict[float, dict[str, Any]] = {}
    for coll in fig.axes[0].collections:
        offsets = np.asarray(coll.get_offsets())
        if len(offsets) == 0:
            continue
        glyph = GLYPH_BY_VERTICES.get(len(coll.get_paths()[0].vertices), "other")
        faces = coll.get_facecolors()
        sizes = np.asarray(coll.get_sizes())
        for i, (_, y) in enumerate(offsets):
            out[round(float(y), 9)] = {
                "fill": to_hex(faces[i if len(faces) > 1 else 0]),
                "shape": glyph,
                "size": float(sizes[i if len(sizes) > 1 else 0]),
            }
    return out


def _screen_rgb(fill: str) -> tuple[float, float, float]:
    m = re.match(r"rgb\((\d+), (\d+), (\d+)\)", fill)
    if m:
        return tuple(int(g) / 255 for g in m.groups())  # type: ignore[return-value]
    return to_rgb(fill)


@pytest.mark.parametrize("name", list(CASES))
def test_export_draws_every_point_as_the_screen_does(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = CASES[name]
    drawn = _points(_render(case["request"], monkeypatch))
    screen = case["screen"]["points"]
    assert len(drawn) == len(screen) == 7  # the excluded row is in neither
    for want in screen:
        got = drawn[round(float(want["y"]), 9)]
        assert got["shape"] == want["shape"], want
        if want["state"]:
            assert got["fill"] == want["fill"], want  # a row's own colour is exact
        else:
            assert _screen_rgb(got["fill"]) == pytest.approx(
                _screen_rgb(want["fill"]), abs=SCALE_TOLERANCE
            ), want
        if want["diam"] is not None:
            assert got["size"] == pytest.approx(want["diam"] ** 2, rel=1e-6), want


def test_a_state_row_with_a_missing_colour_value_is_still_drawn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Row 5 (Signal 3.5) has no Temp but has a state: drawn on screen, so drawn here."""
    drawn = _points(_render(CASES["colorBy"]["request"], monkeypatch))
    assert drawn[3.5]["fill"] == "#2d3047"


def test_without_the_row_arrays_the_colour_scale_alone_is_drawn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = json.loads(json.dumps(CASES["colorBy"]["request"]))
    for key in ("row_colors", "row_markers"):
        del body["series_styles"][0][key]
    drawn = _points(_render(body, monkeypatch))
    assert {p["shape"] for p in drawn.values()} == {"circle"}
    assert "#0b6e4f" not in {p["fill"] for p in drawn.values()}


def test_a_wrong_length_array_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.loads(json.dumps(CASES["sizeBy"]["request"]))
    body["series_styles"][0]["row_colors"] = ["#0b6e4f"]
    body["series_styles"][0]["row_markers"] = ["square"]
    drawn = _points(_render(body, monkeypatch))
    assert {p["shape"] for p in drawn.values()} <= {"circle"}
    assert "#0b6e4f" not in {p["fill"] for p in drawn.values()}


def test_greyscale_drops_the_row_colours_of_a_colour_by_series_and_keeps_the_glyphs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = {**CASES["colorBy"]["request"], "greyscale": True}
    drawn = _points(_render(body, monkeypatch))
    want = {p["shape"] for p in CASES["colorBy"]["screen"]["points"]}
    assert {p["shape"] for p in drawn.values()} == want
    assert not {"#0b6e4f", "#c3423f", "#2d3047"} & {p["fill"] for p in drawn.values()}


@pytest.mark.parametrize("fmt", ["svg", "pdf", "png"])
def test_every_format_renders(fmt: str) -> None:
    for case in CASES.values():
        r = client.post("/api/export/figure", json={**case["request"], "fmt": fmt})
        assert r.status_code == 200


def test_a_break_panel_draws_a_colour_by_or_size_by_series_plain() -> None:
    """Neither is drawn in a break panel (screen or paper): no row states for them."""
    from quantized.calc.figure_break_rows import panel_row_states

    cells = {"row_colors": ["#0b6e4f", "#c3423f"]}
    assert panel_row_states(cells, 2) is not None
    assert panel_row_states({**cells, "color_by": [1.0, 2.0]}, 2) is None
    assert panel_row_states({**cells, "size_by": [1.0, 2.0]}, 2) is None
