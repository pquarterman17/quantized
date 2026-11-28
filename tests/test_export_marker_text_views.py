"""Plan item 24 -- per-point text symbols on grouped, encoded, per-series-X and row-windowed views.

``frontend/src/components/Stage/markerTextViewsFixture.test.ts`` records, per case, the export
request the app builds and, per series, the (x, text) pairs the canvas draws (read off the real
``usePlotPayload``). Each request is posted to the real route; the saved matplotlib figure must
draw the same texts at the same x, series by series, and no glyph markers remain.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "marker_text_views.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _fig(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_texts_are_drawn_where_the_canvas_draws_them(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _fig(monkeypatch, case["request"]).axes[0]
    got = [(t.get_position()[0], t.get_text()) for t in ax.texts if t.get_gid() == "text-symbol"]
    want = [(p["x"], p["text"]) for series in case["canvas"] for p in series]
    assert [g[1] for g in got] == [w[1] for w in want]
    assert [g[0] for g in got] == pytest.approx([w[0] for w in want])
    markers = [(ln.get_label(), ln.get_marker()) for ln in ax.lines]
    assert all(m == "" for _, m in markers), markers


COLOURED = [c for c in CASES if "dotsUnderText" in c]


@pytest.mark.parametrize("case", COLOURED, ids=lambda c: c["name"])
def test_a_colour_by_series_draws_its_text_and_no_dots_beneath_it(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    """The canvas paints no colour-layer point under the text (dotsUnderText); nor must the SVG."""
    fig = _fig(monkeypatch, case["request"])
    ax = fig.axes[0]
    assert case["dotsUnderText"] == [False]
    for coll in ax.collections:
        assert all(size == 0 for size in coll.get_sizes()), "a dot is still drawn under the text"
    # the colour bar survives: the mapping stays legible even though the dots are the text
    assert len(fig.axes) == 2
    # and the same export as an SVG really holds the labels (they are what the user opens)
    svg = client.post("/api/export/figure", json=case["request"])
    assert svg.status_code == 200
    body = svg.content.decode("utf-8", "replace")
    assert body.count('id="text-symbol') >= len(case["canvas"][0])
