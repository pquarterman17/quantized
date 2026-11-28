"""Plan item 24 -- per-point text symbols (column, letters, source rows), the BACKEND half.

``frontend/src/lib/markerTextRowsFixture.test.ts`` records, per case, the export request the
app builds and the (x, text) pairs the canvas draws, in ``marker_text_rows.json``. Each request
is posted to the real route and the saved matplotlib figure must draw the same texts at the
same x; the legend swatch shows the first character instead of a marker.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_text_symbols import apply_text_symbols, row_texts

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "marker_text_rows.json"
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
def test_per_point_texts_are_drawn_where_the_canvas_draws_them(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _fig(monkeypatch, case["request"])
    ax = fig.axes[0]
    got = [(t.get_position()[0], t.get_text()) for t in ax.texts if t.get_gid() == "text-symbol"]
    want = [(p["x"], p["text"]) for p in case["canvas"]]
    assert [g[1] for g in got] == [w[1] for w in want]
    assert [g[0] for g in got] == pytest.approx([w[0] for w in want])
    assert all(line.get_marker() in ("", "None", None) for line in ax.lines)


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_a_text_symbol_on_the_plot_edge_is_drawn_whole_as_on_screen(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    """Acceptance 13 U7: every case's first row sits on the axis minimum. The canvas draws such a
    point whole (``uplotTextSymbols.edge.test.ts``); the figure used to clip its text."""
    fig = _fig(monkeypatch, case["request"])
    ax = fig.axes[0]
    texts = [t for t in ax.texts if t.get_gid() == "text-symbol"]
    assert texts
    assert all(not t.get_clip_on() for t in texts)


def test_the_legend_swatch_is_the_first_character(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = dict(CASES[3]["request"])
    body["series_styles"] = [{**body["series_styles"][0], "legend": "Tags"}]
    fig = _fig(monkeypatch, body)
    handles = fig.axes[0].get_legend().legend_handles if fig.axes[0].get_legend() else []
    assert handles, "the figure has a legend"
    assert handles[0].get_marker() == "$F$"


def test_row_texts_must_fit_the_rows_and_blank_means_none() -> None:
    rows = {"marker_texts": ["a", "", None, "  ", "b"]}
    assert row_texts(rows, 5) == ["a", None, None, None, "b"]
    assert row_texts({"marker_texts": ["a"]}, 2) is None
    assert row_texts({}, 2) is None
    assert row_texts({"marker_texts": ["x" * 80]}, 1) == ["x" * 32]


def test_a_list_that_does_not_fit_leaves_the_glyphs_alone() -> None:
    fig = matplotlib.figure.Figure()
    ax = fig.subplots()
    (line,) = ax.plot([0, 1, 2], [1, 2, 3], marker="o")
    apply_text_symbols(line, {"marker_texts": ["a", "b"]})
    assert line.get_marker() == "o"
    assert not ax.texts
