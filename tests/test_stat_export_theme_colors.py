"""Stat-stage exports draw in the canvas' colours (review finding, pre-existing).

The canvas colours a bar by its series (``seriesColor(si)``), a box / violin /
strip glyph by its position (``glyphColor``: ``seriesColor(levels?.[i] ?? i)``)
and the Q-Q / histogram glyphs in ``seriesColor(0)``. Without a colour factor
the export used to leave all of them to matplotlib -- a blue (``#1f77b4``) bar
under the screen's purple. The client now always sends its palette; these pin
that the export draws with it.
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_stat_colors import bar_colors, position_colors

client = TestClient(app)

PALETTE = ["#a785fc", "#04c5b5", "#eba941", "#f44f62", "#51c672", "#449df0", "#f7758a", "#d2bd70"]
MPL_BLUE = "#1f77b4"


def _svg(route: str, body: dict[str, object]) -> str:
    resp = client.post(f"/api/export/{route}", json={"fmt": "svg", **body})
    assert resp.status_code == 200, resp.text
    return resp.text


def _fills(svg: str) -> set[str]:
    return {m.lower() for m in re.findall(r"fill:\s*(#[0-9a-fA-F]{6})", svg)}


def test_a_bar_without_a_colour_factor_is_drawn_in_its_series_palette_colour() -> None:
    svg = _svg("categorical-figure", {
        "groups": ["A", "B", "C"], "series": ["Value", "Other"],
        "values": [[3.2, 1.0], [4.5, 2.0], [2.1, 3.0]], "palette": PALETTE,
    })
    fills = _fills(svg)
    assert PALETTE[0] in fills and PALETTE[1] in fills
    assert MPL_BLUE not in fills


def test_a_faceted_bar_panel_uses_the_palette_too() -> None:
    panel = {"groups": ["A", "B"], "series": ["Value"], "values": [[1.0], [2.0]]}
    svg = _svg("categorical-figure", {
        **panel, "palette": PALETTE,
        "facets": [{"label": "x", **panel}, {"label": "y", **panel}],
    })
    assert PALETTE[0] in _fills(svg)
    assert MPL_BLUE not in _fills(svg)


@pytest.mark.parametrize("kind", ["box", "violin", "strip"])
def test_grouped_glyphs_are_coloured_by_position(kind: str) -> None:
    svg = _svg("statplot-figure", {
        "kind": kind, "data": [[1, 2, 3, 4], [2, 3, 4, 5]], "labels": ["A", "B"],
        "palette": PALETTE, "show_points": kind == "strip",  # strip always posts its points
    })
    text = svg.lower()
    assert PALETTE[0] in text and PALETTE[1] in text


@pytest.mark.parametrize("kind", ["qq", "histogram"])
def test_qq_and_histogram_glyphs_use_the_first_palette_colour(kind: str) -> None:
    svg = _svg("statplot-figure", {
        "kind": kind, "data": [1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0], "palette": PALETTE,
    })
    assert PALETTE[0] in svg.lower()
    assert MPL_BLUE not in svg.lower()


def test_without_a_palette_nothing_changes() -> None:
    assert bar_colors(None, 0) == {}
    assert position_colors(None, None, 3) is None
    assert position_colors([2, None], PALETTE, 2) == [PALETTE[2], PALETTE[1]]
