"""Plan item 24 -- per-point text symbols on a facet grid, the BACKEND half.

``frontend/src/components/Stage/markerTextFacetsFixture.test.ts`` records, per case, the export
request the app builds and, per panel, the (x, text) pairs the canvas draws. Each request is
posted to the real route; every saved panel must draw the same texts at the same x.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_text_symbols import apply_text_symbols

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "marker_text_facets.json"
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
def test_each_panel_draws_the_canvas_texts(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _fig(monkeypatch, case["request"])
    panels = [ax for ax in fig.axes if ax.get_visible() and ax.lines]
    assert len(panels) == len(case["canvas"])
    for ax, want_series in zip(panels, case["canvas"], strict=True):
        drawn = [t for t in ax.texts if t.get_gid() == "text-symbol"]
        got = [(t.get_position()[0], t.get_text()) for t in drawn]
        want = [(p["x"], p["text"]) for series in want_series for p in series]
        assert [g[1] for g in got] == [w[1] for w in want]
        assert [g[0] for g in got] == pytest.approx([w[0] for w in want])
        assert all(ln.get_marker() == "" for ln in ax.lines)


def test_a_list_that_does_not_fit_is_said(monkeypatch: pytest.MonkeyPatch) -> None:
    from quantized.calc.figure_warnings import collect_figure_warnings

    fig = matplotlib.figure.Figure()
    (line,) = fig.subplots().plot([0, 1, 2], [1, 2, 3], marker="o")
    with collect_figure_warnings() as notes:
        apply_text_symbols(line, {"marker_texts": ["a", "b"]})
    assert line.get_marker() == "o"
    assert notes and "do not fit" in notes[0]
