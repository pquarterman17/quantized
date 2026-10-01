"""P3.3 print-safe greyscale on an xy FACET grid (U2).

Facets used to be a documented no-op for ``greyscale`` because a facet panel
had no per-series colour to grey; FEATURE-001 (channel-keyed facet styles)
and P1.4's encoded facet grid gave them one. Now every facet panel's series
style goes through the flat figure's own mapping
(``calc.figure_greyscale.apply_greyscale``), keyed ONCE over the whole grid
(``greyscale_facet_panels``) so a series keeps one grey and one dash in every
panel, as it keeps one colour on screen. Covered here: the transform on its
own, and the ``/figure``, ``/figure-hitmap`` and ``/figure-page`` facet paths.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient
from matplotlib.colors import to_hex

from quantized.app import app
from quantized.calc.figure_greyscale import (
    GREY_SLOT_KEY,
    LINE_CYCLE,
    greyscale_facet_panels,
    greyscale_ramp,
)

client = TestClient(app)

ENCODED = Path(__file__).parent / "fixtures" / "wire" / "graph_encoding_facets.json"


def _achromatic(hex_colour: str) -> bool:
    h = hex_colour.lstrip("#").lower()
    return h[0:2] == h[2:4] == h[4:6]


def _post_capturing(monkeypatch: pytest.MonkeyPatch, route: str, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post(route, json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1]


def _panel_lines(fig: Any) -> list[list[tuple[str, str, Any]]]:
    """Each visible facet panel's lines as (label, hex colour, linestyle)."""
    panels = [ax for ax in fig.axes if ax.get_visible() and ax.get_title()]
    return [
        [(ln.get_label(), to_hex(ln.get_color()), ln.get_linestyle()) for ln in ax.get_lines()]
        for ax in panels
    ]


def _two_channel_facets() -> list[dict[str, Any]]:
    # Explicit, saturated channel colours (FEATURE-001) -- what greyscale must replace.
    red, green = {"color": "#d62728"}, {"color": "#2ca02c"}
    return [
        {"label": "level 0", "x": [0.0, 1.0, 2.0], "series": [
            {"label": "a", "y": [0.0, 1.0, 2.0], "style": red},
            {"label": "b", "y": [2.0, 1.0, 0.0], "style": green},
        ]},
        {"label": "level 1", "x": [0.0, 1.0, 2.0], "series": [
            {"label": "a", "y": [1.0, 2.0, 3.0], "style": red},
            {"label": "b", "y": [3.0, 2.0, 1.0], "style": green},
        ]},
    ]


def _dataset() -> dict[str, Any]:
    return {
        "time": [0.0, 1.0, 2.0], "values": [[0.0, 2.0], [1.0, 1.0], [2.0, 0.0]],
        "labels": ["a", "b"], "units": ["", ""], "metadata": {},
    }


# ── the transform ──────────────────────────────────────────────────────────


def test_one_grey_and_dash_per_channel_across_panels() -> None:
    panels = _two_channel_facets()
    before = copy.deepcopy(panels)
    out = greyscale_facet_panels(panels)
    assert panels == before  # never mutates its input
    ramp = greyscale_ramp(2)
    for p in out:
        assert [s["style"]["color"] for s in p["series"]] == ramp
        assert [s["style"]["line"] for s in p["series"]] == list(LINE_CYCLE[:2])
        assert all(GREY_SLOT_KEY not in s["style"] for s in p["series"])


def test_a_channel_keeps_its_grey_when_another_panel_lacks_a_channel() -> None:
    # An unencoded grid resolves its default channels PER PANEL (FEATURE-001),
    # so panels can differ: the key is the channel, never the position.
    panels = [
        {"label": "P", "x": [0], "series": [{"label": "a", "y": [0]}, {"label": "b", "y": [1]}]},
        {"label": "Q", "x": [0], "series": [{"label": "b", "y": [2]}]},
    ]
    out = greyscale_facet_panels(panels)
    b_grey = out[0]["series"][1]["style"]["color"]
    assert out[1]["series"][0]["style"]["color"] == b_grey
    assert out[1]["series"][0]["style"]["line"] == LINE_CYCLE[1]
    assert out[0]["series"][0]["style"]["color"] != b_grey


def test_encoded_grey_slots_rank_over_the_whole_grid() -> None:
    # An encoded grid's series carry their colour level's slot (beside their
    # style): one level greys alike in every panel, even one that lacks the
    # other levels -- and labels, which repeat here, are not the key.
    s = [{"label": "10 K", "y": [0], "style": {"color": c}, GREY_SLOT_KEY: k}
         for c, k in (("#ff0000", 0), ("#00ff00", 1), ("#00ff00", 1), ("#0000ff", 2))]
    panels = [
        {"label": "P", "x": [0], "series": s},
        {"label": "Q", "x": [0], "series": [s[3]]},
    ]
    out = greyscale_facet_panels(panels)
    ramp = greyscale_ramp(3)
    assert [x["style"]["color"] for x in out[0]["series"]] == [ramp[0], ramp[1], ramp[1], ramp[2]]
    assert out[1]["series"][0]["style"]["color"] == ramp[2]
    assert all(GREY_SLOT_KEY not in x for p in out for x in p["series"])


def test_a_colour_mapped_series_passes_through() -> None:
    cb = {"color_by": {"values": [1.0]}, "cmap": "viridis"}
    panels = [{"label": "P", "x": [0], "series": [{"label": "a", "y": [0], "style": cb}]}]
    assert greyscale_facet_panels(panels)[0]["series"][0]["style"] == cb


# ── the routes ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("route", ["/api/export/figure", "/api/export/figure-hitmap"])
def test_greyscale_facets_draw_grey_distinct_strokes(
    monkeypatch: pytest.MonkeyPatch, route: str,
) -> None:
    req = {"dataset": _dataset(), "fmt": "svg", "facets": _two_channel_facets(), "greyscale": True}
    panels = _panel_lines(_post_capturing(monkeypatch, route, req))
    assert len(panels) == 2
    for lines in panels:
        assert all(_achromatic(c) for _, c, _ in lines)
        (_, ca, la), (_, cb, lb) = lines
        assert ca != cb and la != lb  # still tellable apart, by grey AND dash
    assert panels[0] == panels[1]  # a channel draws alike in every panel


def test_without_greyscale_facets_keep_their_colours(monkeypatch: pytest.MonkeyPatch) -> None:
    req = {"dataset": _dataset(), "fmt": "svg", "facets": _two_channel_facets()}
    panels = _panel_lines(_post_capturing(monkeypatch, "/api/export/figure", req))
    assert [[c for _, c, _ in p] for p in panels] == [["#d62728", "#2ca02c"]] * 2


def test_page_facet_panel_honours_greyscale(monkeypatch: pytest.MonkeyPatch) -> None:
    fig_req = {"dataset": _dataset(), "fmt": "svg", "facets": _two_channel_facets()}
    page = {"rows": 1, "cols": 1, "fmt": "svg", "panels": [
        {"figure": {**fig_req, "greyscale": True}, "row": 0, "col": 0},
    ]}
    panels = _panel_lines(_post_capturing(monkeypatch, "/api/export/figure-page", page))
    assert len(panels) == 2
    for lines in panels:
        assert all(_achromatic(c) for _, c, _ in lines)
        assert lines[0][1] != lines[1][1]


def test_encoded_facets_grey_by_colour_level(monkeypatch: pytest.MonkeyPatch) -> None:
    fx = json.loads(ENCODED.read_text(encoding="utf-8"))["facets"]
    req = {**fx["request"], "greyscale": True}
    panels = _panel_lines(_post_capturing(monkeypatch, "/api/export/figure", req))
    screen = [[s["color"] for s in p["series"]] for p in fx["screen"]]
    grey_of: dict[str, str] = {}
    for drawn, colours in zip(panels, screen, strict=True):
        assert len(drawn) == len(colours)
        for (_, grey, _), colour in zip(drawn, colours, strict=True):
            assert _achromatic(grey)
            # One screen colour (a colour LEVEL) -> one grey, in every panel.
            assert grey_of.setdefault(colour, grey) == grey
    assert len(set(grey_of.values())) == len(grey_of)  # distinct levels stay distinct
