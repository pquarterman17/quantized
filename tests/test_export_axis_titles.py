"""The axis titles' right-click Format (size / bold / italic) and dragged
offsets -- screen == export, the BACKEND half.

``frontend/src/lib/axisTitlesFixture.test.ts`` pins, per case, how every axis
title is drawn on the canvas (size in CSS px, null = the template's; bold;
italic; offset ``[dx, dy]`` in CSS px, y DOWN) beside the exact request the
live Stage export sends. matplotlib must draw each title the same way, px
read as points (``calc.figure_axis_titles``): a moved title sits exactly
``offset`` points from where the same request without offsets puts it,
measured against its own axes so a ``tight_layout`` reflow cannot hide it.
A page panel embedding the same request draws the same titles.

An x-axis BREAK case draws plain titles on both sides: the canvas' break
panels build without the Format/drag bridge, and ``calc.figure_break`` skips
the fields like the other single-axes overrides. A figure page rejects
``x_breaks``, so that case has no page half.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_styles import figure_style

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "axis_titles.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _broken(case: dict[str, Any]) -> bool:
    return bool((case["request"].get("overrides") or {}).get("x_breaks"))


FLAT = [c for c in CASES if not _broken(c)]
BROKEN = [c for c in CASES if _broken(c)]


def _figure(monkeypatch: pytest.MonkeyPatch, url: str, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post(url, json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1]


def _titles(fig: Any) -> dict[str, Any]:
    """The x / y / y2 title artists with the axes each belongs to."""
    ax = fig.axes[0]
    out = {"x": (ax.xaxis.label, ax), "y": (ax.yaxis.label, ax)}
    if len(fig.axes) > 1:
        out["y2"] = (fig.axes[1].yaxis.label, fig.axes[1])
    return out


def _anchor_pt(fig: Any, axis: str, label: Any, ax: Any) -> tuple[float, float]:
    """The title's centre in points, relative to its axes: ALONG the axis from
    the axes' centre (where an unmoved title is centred), ACROSS it from the
    axis' own edge -- so a ``tight_layout`` reflow cannot pass for a move."""
    fig.canvas.draw()  # lay the labels out at fig.dpi (savefig left them at its own)
    r = fig.canvas.get_renderer()
    box = label.get_window_extent(r)
    axb = ax.get_window_extent(r)
    cx, cy = (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2
    k = 72.0 / fig.dpi
    if axis == "x":
        return (cx - (axb.x0 + axb.x1) / 2) * k, (cy - axb.y0) * k
    edge = axb.x0 if axis == "y" else axb.x1
    return (cx - edge) * k, (cy - (axb.y0 + axb.y1) / 2) * k


def _check(fig: Any, home: Any, drawn: dict[str, Any], style: str) -> None:
    preset = figure_style(style)
    titles = _titles(fig)
    home_titles = _titles(home)
    assert set(drawn) <= set(titles)
    for axis, want in drawn.items():
        label, ax = titles[axis]
        size = want["size"] if want["size"] is not None else preset.font_size
        assert label.get_fontsize() == pytest.approx(size), axis
        assert (label.get_fontweight() == "bold") is want["bold"], axis
        assert (label.get_fontstyle() == "italic") is want["italic"], axis
        x, y = _anchor_pt(fig, axis, label, ax)
        hx, hy = _anchor_pt(home, axis, *home_titles[axis])
        dx, dy = want["offset"]
        # Screen y runs DOWN, matplotlib's up: a title dragged down sits lower.
        assert (x - hx, y - hy) == pytest.approx((dx, -dy), abs=0.05), axis


@pytest.mark.parametrize("case", FLAT, ids=[c["name"] for c in FLAT])
def test_each_axis_title_is_drawn_as_the_canvas_draws_it(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    body = case["request"]
    home_body = {k: v for k, v in body.items() if k != "axis_label_offsets"}
    fig = _figure(monkeypatch, "/api/export/figure", body)
    home = _figure(monkeypatch, "/api/export/figure", home_body)
    _check(fig, home, case["drawn"], body["style"])


@pytest.mark.parametrize("case", FLAT, ids=[c["name"] for c in FLAT])
def test_a_page_panel_draws_the_same_titles(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    def page(figure: dict[str, Any]) -> dict[str, Any]:
        panel = {"figure": figure, "row": 0, "col": 0}
        return {"rows": 1, "cols": 1, "panels": [panel], "fmt": "svg"}

    body = case["request"]
    home_body = {k: v for k, v in body.items() if k != "axis_label_offsets"}
    fig = _figure(monkeypatch, "/api/export/figure-page", page(body))
    home = _figure(monkeypatch, "/api/export/figure-page", page(home_body))
    _check(fig, home, case["drawn"], "default")


def _break_titles(fig: Any) -> dict[str, Any]:
    """A broken figure's titles: the x title is the figure's own (``supxlabel``)
    under every panel, the y title the first panel's."""
    supx = [t for t in fig.texts if t.get_text() == fig.get_supxlabel()]
    assert len(supx) == 1, "the break figure has one x title"
    return {"x": (supx[0], fig.axes[0]), "y": (fig.axes[0].yaxis.label, fig.axes[0])}


@pytest.mark.parametrize("case", BROKEN, ids=[c["name"] for c in BROKEN])
def test_a_break_figure_draws_each_title_as_its_panels_do(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    body = case["request"]
    assert body.get("axis_label_styles") or body.get("axis_label_offsets"), "non-vacuous"
    title_fields = ("axis_label_styles", "axis_label_offsets")
    plain_body = {k: v for k, v in body.items() if k not in title_fields}
    fig = _figure(monkeypatch, "/api/export/figure", body)
    plain = _figure(monkeypatch, "/api/export/figure", plain_body)
    assert len(fig.axes) >= 2, "the break renderer drew it"
    titles, plain_titles = _break_titles(fig), _break_titles(plain)
    assert set(case["drawn"]) == set(titles)
    for axis, want in case["drawn"].items():
        label, ax = titles[axis]
        home = plain_titles[axis][0]
        size = want["size"] if want["size"] is not None else home.get_fontsize()
        assert label.get_fontsize() == pytest.approx(size), axis
        assert (label.get_fontweight() == "bold") is want["bold"], axis
        assert (label.get_fontstyle() == "italic") is want["italic"], axis
        x, y = _anchor_pt(fig, axis, label, ax)
        hx, hy = _anchor_pt(plain, axis, home, plain_titles[axis][1])
        dx, dy = want["offset"]
        assert (x - hx, y - hy) == pytest.approx((dx, -dy), abs=0.05), axis


def test_a_malformed_title_size_is_refused() -> None:
    body = dict(CASES[0]["request"], axis_label_styles={"x": {"size": -3}})
    assert client.post("/api/export/figure", json=body).status_code == 422
