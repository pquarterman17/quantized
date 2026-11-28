"""A statistics-view plot with ONE group exports (acceptance 9, W1).

Toggling statistics view and unticking all but one channel left a one-group box plot, and the
export answered 422 "color_levels must have one entry per group (1), got 2": the route asked
``position_colors`` for ``max(len(data), 2)`` colours for every listed kind, although only the
split violin colours by side. The screen draws that single group in ``glyphColor(levels, 0)`` =
``seriesColor(0)``, the palette's first colour; the export must draw the same.
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from quantized.app import app
from quantized.calc.figure_stat_colors import position_colors

client = TestClient(app)

PALETTE = ["#a785fc", "#04c5b5", "#eba941", "#f44f62", "#51c672", "#449df0", "#f7758a", "#d2bd70"]
GROUP = [1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0]


def _post(body: dict[str, object]) -> Response:
    payload = {"fmt": "svg", "palette": PALETTE, **body}
    return client.post("/api/export/statplot-figure", json=payload)


def _fills(svg: str) -> set[str]:
    return {m.lower() for m in re.findall(r"(?:fill|stroke):\s*(#[0-9a-fA-F]{6})", svg)}


@pytest.mark.parametrize("kind", ["box", "violin", "strip", "cdf", "ridgeline"])
def test_a_one_group_plot_exports_in_the_first_palette_colour(kind: str) -> None:
    extra: dict[str, object] = {"show_points": True} if kind == "strip" else {}
    resp = _post({"kind": kind, "data": [GROUP], "labels": ["A"], **extra})
    assert resp.status_code == 200, resp.text
    colours = _fills(resp.text)
    assert PALETTE[0] in colours  # what the screen draws: seriesColor(0)
    assert PALETTE[1] not in colours  # no second group, so no second colour


def test_a_one_group_box_with_explicit_levels_keeps_its_colour() -> None:
    resp = _post({"kind": "box", "data": [GROUP], "labels": ["A"], "color_levels": [2]})
    assert resp.status_code == 200, resp.text
    assert PALETTE[2] in _fills(resp.text)


@pytest.mark.parametrize("style", ["half", "split"])
def test_a_one_group_side_violin_still_exports(style: str) -> None:
    resp = _post({
        "kind": "sideviolin", "data": [GROUP], "labels": ["A"],
        "dist3": {"type": "sideviolin", "style": style, "slots": [0], "sides": ["right"],
                  "slot_labels": ["A"], "levels": ["lo", "hi"] if style == "split" else []},
    })
    assert resp.status_code == 200, resp.text


def test_a_one_group_lollipop_exports() -> None:
    body = {"kind": "lollipop", "data": [GROUP], "labels": ["A"], "dist3": {"type": "lollipop"}}
    resp = _post(body)
    assert resp.status_code == 200, resp.text


def test_position_colors_gives_one_colour_per_group_unless_asked_for_more() -> None:
    assert position_colors(None, PALETTE, 1) == [PALETTE[0]]
    assert position_colors(None, PALETTE, 2) == [PALETTE[0], PALETTE[1]]
