"""Gap audit 8 lane SIG -- significance brackets / compact letters in the export.

The client lays the marks out (``Stage/statCompareLayout``) and posts them as
``comparisons``; ``calc.figure_stat_comparisons`` only draws what it is given
and ``footnote_text`` carries the test-and-correction sentence. These tests pin:
the brackets and letters reach the figure (SVG ``gid`` tags), the note is
drawn verbatim, the y-limits grow to hold the marks, an absent payload is the
figure as before, and every ambiguous request is refused (422), never drawn
half-right.
"""

from __future__ import annotations

import html
import xml.etree.ElementTree as ET
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_group_notes import footnote_text
from quantized.calc.figure_stat_comparisons import comparison_note, draw_comparisons

client = TestClient(app)
_SVG = "{http://www.w3.org/2000/svg}"
NOTE = "Tukey HSD (all pairs, p adjusted), familywise alpha = 0.05; * p<0.05"
STAT = {"kind": "box", "data": [[1, 2, 3], [4, 5, 6], [9, 10, 11]], "labels": ["a", "b", "c"]}
BAR = {"groups": ["a", "b", "c"], "series": ["y"], "values": [[1.0], [2.0], [3.0]],
       "errors": [[0.1], [0.1], [0.1]]}
CMP = {
    "note": NOTE,
    "brackets": [{"a": 0, "b": 2, "y": 12.0, "label": "**"},
                 {"a": 0, "b": 1, "y": 7.0, "label": "* p=0.03"}],
    "letters": [], "tick": 0.3, "top": 13.0,
}
LETTERS = {"note": "Tukey HSD, familywise alpha = 0.05; groups sharing a letter do not differ",
           "brackets": [],
           "letters": [{"slot": 0, "y": 4.0, "text": "a"}, {"slot": 1, "y": 7.0, "text": "b"},
                       {"slot": 2, "y": 12.0, "text": "c"}],
           "tick": 0.3, "top": 13.0}


def _svg(path: str, body: dict[str, Any]) -> ET.Element:
    r = client.post(path, json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text
    return ET.fromstring(r.text)


def _texts(root: ET.Element) -> list[str]:
    return [html.unescape(t.text or "") for t in root.iter(f"{_SVG}text")]


def _gids(root: ET.Element) -> list[str]:
    return [g.get("id", "") for g in root.iter(f"{_SVG}g")]


def _count(root: ET.Element, prefix: str) -> int:
    return sum(1 for g in _gids(root) if g.startswith(prefix))


@pytest.mark.parametrize(
    ("path", "body"),
    [("/api/export/statplot-figure", STAT), ("/api/export/categorical-figure", BAR)],
    ids=["statplot", "bar"],
)
def test_brackets_labels_and_the_note_are_drawn(path: str, body: dict[str, Any]) -> None:
    root = _svg(path, {**body, "comparisons": CMP})
    assert _count(root, "significance-bracket") == 2
    texts = _texts(root)
    assert "**" in texts and "* p=0.03" in texts
    assert NOTE in texts  # the footnote names the test and correction


@pytest.mark.parametrize(
    ("path", "body"),
    [("/api/export/statplot-figure", STAT), ("/api/export/categorical-figure", BAR)],
    ids=["statplot", "bar"],
)
def test_letters_are_drawn_and_no_brackets(path: str, body: dict[str, Any]) -> None:
    root = _svg(path, {**body, "comparisons": LETTERS})
    assert _count(root, "significance-letter") == 3
    assert _count(root, "significance-bracket") == 0
    assert "groups sharing a letter do not differ" in " ".join(_texts(root))


@pytest.mark.parametrize(
    ("path", "body"),
    [("/api/export/statplot-figure", STAT), ("/api/export/categorical-figure", BAR)],
    ids=["statplot", "bar"],
)
def test_without_comparisons_the_figure_is_unchanged(path: str, body: dict[str, Any]) -> None:
    root = _svg(path, body)
    assert _count(root, "significance") == 0
    assert NOTE not in _texts(root)


def test_the_note_sits_between_the_error_note_and_the_caveat() -> None:
    assert footnote_text("E", "C", "N") == "E\nN\nC"
    assert footnote_text(None, None, "N") == "N"
    assert footnote_text("E", "C") == "E\nC"  # the two-argument call is unchanged
    assert comparison_note(None) is None and comparison_note({"note": ""}) is None
    assert comparison_note({"note": "x"}) == "x"


def test_the_y_limits_grow_to_hold_the_marks() -> None:
    fig = matplotlib.figure.Figure()
    ax = fig.subplots()
    ax.plot([0, 1], [0, 1])
    draw_comparisons(ax, {"brackets": [{"a": 0, "b": 1, "y": 1.2, "label": "*"}], "tick": 0.1,
                          "top": 5.0, "note": "n"}, [0.0, 1.0])
    assert ax.get_ylim()[1] >= 5.0


def test_an_empty_or_missing_payload_draws_nothing() -> None:
    fig = matplotlib.figure.Figure()
    ax = fig.subplots()
    ax.plot([0, 1], [0, 1])
    before = ax.get_ylim()
    draw_comparisons(ax, None, [0.0, 1.0])
    draw_comparisons(ax, {"brackets": [], "letters": [], "note": "n", "top": 9.0}, [0.0, 1.0])
    assert ax.get_ylim() == before and not ax.texts


@pytest.mark.parametrize("bad_slot", [3, 7])
def test_a_slot_outside_the_axis_is_refused(bad_slot: int) -> None:
    fig = matplotlib.figure.Figure()
    ax = fig.subplots()
    with pytest.raises(ValueError, match="outside"):
        draw_comparisons(ax, {"brackets": [{"a": 0, "b": bad_slot, "y": 1.0, "label": "*"}],
                              "tick": 0.1}, [0.0, 1.0, 2.0])


def test_a_non_finite_height_is_refused() -> None:
    fig = matplotlib.figure.Figure()
    ax = fig.subplots()
    with pytest.raises(ValueError, match="finite"):
        draw_comparisons(ax, {"letters": [{"slot": 0, "y": float(np.nan), "text": "a"}]}, [0.0])


def test_the_route_refuses_a_bad_slot_with_422() -> None:
    bad = {**CMP, "brackets": [{"a": 0, "b": 9, "y": 1.0, "label": "*"}]}
    r = client.post("/api/export/statplot-figure", json={**STAT, "comparisons": bad})
    assert r.status_code == 422


def test_marks_on_a_non_grouped_kind_are_refused() -> None:
    body = {"kind": "histogram", "data": [1.0, 2.0, 3.0, 4.0], "comparisons": CMP}
    assert client.post("/api/export/statplot-figure", json=body).status_code == 422


def test_marks_on_stacked_or_faceted_bars_are_refused() -> None:
    assert client.post(
        "/api/export/categorical-figure", json={**BAR, "stacked": True, "comparisons": CMP},
    ).status_code == 422
    facets = [{"label": "f", "groups": ["a"], "series": ["y"], "values": [[1.0]]}]
    assert client.post(
        "/api/export/categorical-figure", json={**BAR, "facets": facets, "comparisons": CMP},
    ).status_code == 422


def test_marks_on_a_faceted_statplot_are_refused() -> None:
    facets = [{"label": "f", "data": [[1, 2], [3, 4]], "labels": ["a", "b"]}]
    body = {**STAT, "facets": facets, "comparisons": CMP}
    r = client.post("/api/export/statplot-figure", json=body)
    assert r.status_code == 422


def test_an_oversized_note_is_refused() -> None:
    r = client.post("/api/export/statplot-figure",
                    json={**STAT, "comparisons": {**CMP, "note": "x" * 301}})
    assert r.status_code == 422


def test_an_oversized_payload_is_refused() -> None:
    many = [{"a": 0, "b": 1, "y": 1.0, "label": "*"}] * 401
    body = {**STAT, "comparisons": {**CMP, "brackets": many}}
    r = client.post("/api/export/statplot-figure", json=body)
    assert r.status_code == 422
