"""G24 "Use row states" -- canvas <-> export parity, BACKEND half.

``frontend/src/lib/rowStyleExport.test.ts`` builds, from ONE row style, both what
the canvas paints (``colorScatterFill`` / ``ColorScatterSpec.shapes``) and the
real export request (``figureSpec.buildFigureSpec``, excluded row pruned), and
pins the pair as ``tests/fixtures/wire/row_states.json`` (``{"request",
"screen"}``). This file posts that request to the real ``/api/export/figure``
route and reads every drawn point's fill and glyph back out of the SVG:

* the multiset of (glyph, fill) over the drawn points is exactly the screen's;
* the series' own line is still drawn, with the series colour;
* greyscale drops the row COLOURS (print-safe) and keeps the glyphs;
* an array whose length is not the row count fails closed: the series draws as
  if it had no row states, and the export still succeeds.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_row_states import row_states

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "row_states.json"
_COLLECTION = re.compile(r'<g id="(PathCollection_\d+)">')
_POINT = re.compile(
    r'<use xlink:href="#(?P<ref>[A-Za-z0-9_]+)"[^>]*style="fill: (?P<fill_use>#[0-9a-f]{6})'
    r'|<path d="(?P<d>[^"]*)"[^>]*style="fill: (?P<fill_path>#[0-9a-f]{6})'
)


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _svg(body: dict[str, Any]) -> str:
    r = client.post("/api/export/figure", json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text
    return r.text


def _group(svg: str, gid: str) -> str:
    m = re.search(rf'<g id="{re.escape(gid)}">', svg)
    assert m, gid
    depth, pos = 1, m.end()
    for tm in re.finditer(r"<g\b[^>]*?(/?)>|</g>", svg[pos:]):
        if tm.group() == "</g>":
            depth -= 1
            if depth == 0:
                return svg[m.start() : pos + tm.end()]
        elif not tm.group(1):
            depth += 1
    raise AssertionError(f"unbalanced <g> nesting for {gid!r}")


def _shape(d: str) -> str:
    """Circle = cubic Beziers; square = four straight corners; triangle = three."""
    d = " ".join(d.split())
    if " C " in d:
        return "circle"
    corners = len(re.findall(r" L ", d)) + 1
    return {4: "square", 3: "triangle"}.get(corners, f"other:{d}")


def _drawn(svg: str) -> list[tuple[str, str]]:
    """(glyph, fill) of every scatter point in the plot (a collection per glyph)."""
    out: list[tuple[str, str]] = []
    for gid in _COLLECTION.findall(svg):
        for m in _POINT.finditer(_group(svg, gid)):
            if m.group("ref"):
                d = re.search(rf'<path id="{m.group("ref")}" d="([^"]*)"', svg)
                assert d, m.group("ref")
                out.append((_shape(d.group(1)), m.group("fill_use")))
            else:
                out.append((_shape(m.group("d")), m.group("fill_path")))
    return out


def test_export_draws_every_point_in_the_screen_colour_and_glyph() -> None:
    fixture = _fixture()
    screen = [(p["shape"], p["fill"]) for p in fixture["screen"]["points"]]
    drawn = _drawn(_svg(fixture["request"]))
    assert len(drawn) == len(screen) == 7
    assert Counter(drawn) == Counter(screen)


def test_the_series_line_is_still_drawn_in_the_series_colour() -> None:
    svg = _svg(_fixture()["request"])
    assert "stroke: #336699" in svg


def test_without_the_row_arrays_the_same_request_draws_no_scatter_points() -> None:
    # Negative control: the per-point fills come from the row arrays alone.
    body = _fixture()["request"]
    plain = {**body, "series_styles": [{"color": "#336699", "width": 1.5}]}
    assert _drawn(_svg(plain)) == []


def test_greyscale_drops_row_colours_and_keeps_the_glyphs() -> None:
    body = _fixture()["request"]
    drawn = _drawn(_svg({**body, "greyscale": True}))
    screen = [p["shape"] for p in _fixture()["screen"]["points"]]
    assert Counter(g for g, _ in drawn) == Counter(screen)
    assert not {"#0b6e4f", "#c3423f", "#2d3047"} & {f for _, f in drawn}


def test_a_wrong_length_array_fails_closed() -> None:
    body = _fixture()["request"]
    style = {**body["series_styles"][0], "row_colors": ["#0b6e4f"], "row_markers": ["square"]}
    assert _drawn(_svg({**body, "series_styles": [style]})) == []


def test_calc_validation() -> None:
    assert row_states(None, 3) is None
    assert row_states({"row_colors": ["#00ff00", "x", None]}, 3) == (["#00ff00", None, None], None)
    assert row_states({"row_markers": ["star", "blob", None]}, 3) == (None, ["star", None, None])
    assert row_states({"row_colors": ["#00ff00"]}, 3) is None  # wrong length
    assert row_states({"row_colors": "#00ff00"}, 1) is None  # a bare string is not a list
    assert row_states({"row_colors": [None, None]}, 2) is None  # nothing usable


def test_hollow_symbols_keep_the_row_colour_on_the_edge() -> None:
    body = _fixture()["request"]
    style = {**body["series_styles"][0], "marker_fill": "hollow"}
    svg = _svg({**body, "series_styles": [style]})
    assert _drawn(svg) == []  # no filled points: the interiors are empty
    for colour in ("#0b6e4f", "#c3423f", "#2d3047"):
        assert f"stroke: {colour}" in svg


@pytest.mark.parametrize("fmt", ["svg", "pdf", "png"])
def test_every_format_renders(fmt: str) -> None:
    r = client.post("/api/export/figure", json={**_fixture()["request"], "fmt": fmt})
    assert r.status_code == 200
