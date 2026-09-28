"""P2.6 box 1 -- the categorical figure states which error bar it shows.

The Stat Stage shows "Error bars: SD" / "SE of the mean" / "95% CI of the
mean" under the plot (``lib/statMarks.errorBarNote``, decided by
``Stage/statErrorNote.figureErrorNote``) and posts the SAME string as the
export's ``error_note``; ``calc.figure_group_notes.footnote_text`` stacks it
above the caveat and ``add_caveat`` draws each line. The frontend half
(``statMarksParity.test.ts``, ``statLevelsParity.test.ts``) asserts the
request carries exactly the screen's text; this half renders it, on every
categorical route, and checks the footnote lines never overprint each other
or the x title.
"""

from __future__ import annotations

import html
import xml.etree.ElementTree as ET
from collections.abc import Callable
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient
from matplotlib.figure import Figure
from matplotlib.text import Text

from quantized.app import app
from quantized.calc.figure_group_notes import CAVEAT_BAND, add_caveat, footnote_text

client = TestClient(app)
_SVG = "{http://www.w3.org/2000/svg}"
NOTE = "Error bars: SE of the mean"
CAVEAT = (
    "Caveat: n < 3 in 1 group; unbalanced groups (n 1-9) - summaries and intervals are "
    "unreliable"
)

_STAT = {"kind": "box", "data": [[1, 2, 3], [4, 5, 6, 9]], "labels": ["a", "b"],
         "summary": "mean", "error_bars": "se"}
_STAT_FACETS = {**_STAT, "facets": [
    {"label": "f0", "data": [[1, 2, 3], [4, 5]], "labels": ["a", "b"]},
    {"label": "f1", "data": [[1, 3], [4, 6, 8]], "labels": ["a", "b"]},
]}
_BAR = {"groups": ["a", "b"], "series": ["y"], "values": [[1.0], [2.0]],
        "errors": [[0.1], [0.3]]}
_BAR_FACETS = {**_BAR, "facets": [
    {"label": "f0", "groups": ["a", "b"], "series": ["y"], "values": [[1.0], [2.0]],
     "errors": [[0.1], [0.3]]},
]}
ROUTES = [
    ("/api/export/statplot-figure", _STAT),
    ("/api/export/statplot-figure", _STAT_FACETS),
    ("/api/export/categorical-figure", _BAR),
    ("/api/export/categorical-figure", _BAR_FACETS),
]
IDS = ["statplot", "statplot-faceted", "bar", "bar-faceted"]


def _texts(path: str, body: dict[str, Any]) -> list[str]:
    r = client.post(path, json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text
    root = ET.fromstring(r.text)
    return [html.unescape(t.text or "") for t in root.iter(f"{_SVG}text")]


# ── the footnote text and its placement ─────────────────────────────────────


def test_footnote_text_puts_the_note_above_the_caveat() -> None:
    assert footnote_text(None, None) is None
    assert footnote_text("", "") is None
    assert footnote_text(NOTE, None) == NOTE
    # No note: the caveat reaches add_caveat exactly as it always did.
    assert footnote_text(None, CAVEAT) == CAVEAT
    assert footnote_text(NOTE, CAVEAT) == f"{NOTE}\n{CAVEAT}"


def test_a_one_line_footnote_is_the_single_text_add_caveat_always_drew() -> None:
    fig = Figure(figsize=(6.4, 4.8))
    assert add_caveat(fig, CAVEAT) == (0.0, CAVEAT_BAND, 1.0, 1.0)
    [text] = fig.texts
    assert (text.get_text(), text.get_position()) == (CAVEAT, (0.01, 0.01))
    assert add_caveat(Figure(), None) is None


def test_two_lines_are_two_texts_bottom_up_in_a_taller_band() -> None:
    fig = Figure(figsize=(6.4, 4.8))
    rect = add_caveat(fig, footnote_text(NOTE, CAVEAT))
    y = {t.get_text(): t.get_position()[1] for t in fig.texts}
    assert set(y) == {NOTE, CAVEAT}
    assert y[CAVEAT] == pytest.approx(0.01)
    assert y[NOTE] > y[CAVEAT]
    assert rect is not None and rect[1] > CAVEAT_BAND


# ── every categorical route, flat and faceted ───────────────────────────────


@pytest.mark.parametrize(("path", "body"), ROUTES, ids=IDS)
def test_the_error_note_is_drawn_verbatim_with_and_without_a_caveat(
    path: str, body: dict[str, Any],
) -> None:
    texts = _texts(path, {**body, "error_note": NOTE})
    assert NOTE in texts
    both = _texts(path, {**body, "error_note": NOTE, "caveat": CAVEAT})
    assert NOTE in both and CAVEAT in both


@pytest.mark.parametrize(("path", "body"), ROUTES, ids=IDS)
def test_no_error_note_draws_no_line(path: str, body: dict[str, Any]) -> None:
    assert not any(t.startswith("Error bars") for t in _texts(path, body))


@pytest.mark.parametrize("path", ["/api/export/statplot-figure", "/api/export/categorical-figure"])
def test_an_oversized_error_note_is_refused(path: str) -> None:
    body = _STAT if "statplot" in path else _BAR
    r = client.post(path, json={**body, "error_note": "x" * 201})
    assert r.status_code == 422


# ── nothing overprints ──────────────────────────────────────────────────────


def _saved_figure(monkeypatch: pytest.MonkeyPatch, render: Callable[[], Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capture(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capture)
    render()
    monkeypatch.undo()
    assert kept
    return kept[0]


def _assert_stacked(fig: Any, *top_to_bottom: str) -> None:
    """Each text sits wholly ABOVE the next -- a vertical check, not a 2-D
    box overlap: the short note starts at the left edge and a centred x
    title never meets it horizontally, so an overlap test would pass even
    with the title dropped onto the note's line (measured: it did)."""
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    boxes = {
        t.get_text(): t.get_window_extent(renderer)
        for t in fig.findobj(Text) if t.get_text() in top_to_bottom and t.get_visible()
    }
    assert set(boxes) == set(top_to_bottom), boxes
    for upper, lower in zip(top_to_bottom, top_to_bottom[1:], strict=False):
        assert boxes[upper].y0 >= boxes[lower].y1, (upper, lower, boxes[upper], boxes[lower])


@pytest.mark.parametrize("which", ["flat", "facets-stat", "facets-bar"])
def test_x_title_note_and_caveat_stack_without_overprinting(
    monkeypatch: pytest.MonkeyPatch, which: str,
) -> None:
    from quantized.calc.figure_facets import (
        render_categorical_facets_figure,
        render_stat_facets_figure,
    )
    from quantized.calc.figure_statplots import render_statplot_figure

    foot = footnote_text(NOTE, CAVEAT)
    renders: dict[str, Callable[[], Any]] = {
        "flat": lambda: render_statplot_figure(
            "box", [[1, 2, 3], [4, 5, 9]], labels=["a", "b"], x_label="THE X TITLE",
            caveat=foot, fmt="svg", marks={"summary": "mean", "error_bars": "se"},
        ),
        "facets-stat": lambda: render_stat_facets_figure(
            _STAT_FACETS["facets"], default_kind="box", x_label="THE X TITLE", caveat=foot,
            fmt="svg",
        ),
        "facets-bar": lambda: render_categorical_facets_figure(
            _BAR_FACETS["facets"], x_label="THE X TITLE", caveat=foot, fmt="svg",
        ),
    }
    fig = _saved_figure(monkeypatch, renders[which])
    _assert_stacked(fig, "THE X TITLE", NOTE, CAVEAT)
