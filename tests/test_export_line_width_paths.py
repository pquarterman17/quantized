"""Widthless lines on the spatial page, the Graph Builder's encoded export and
the polar figure -- screen == export, the BACKEND half.

``frontend/src/lib/lineWidthPathsFixture.test.ts`` pins, per case, the width
each path's canvas draws every series at (a spatial cell at the plot
template's width, the Graph Builder preview and the polar canvas at their own
fixed width) beside the exact request that path sends. matplotlib must draw
each exported series at that width, never the style preset's ``line_width``
(the fixture's ``rule``), on the page route and the figure route alike.
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "line_width_paths.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _lines(monkeypatch: pytest.MonkeyPatch, route: str, body: dict[str, Any]) -> list[Any]:
    """Every drawn series line, axes by axes (page panels in placement order)."""
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post(f"/api/export/{route}", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return [
        ln
        for ax in kept[-1].axes
        if ax.get_visible()
        for ln in ax.get_lines()
        if not str(ln.get_label()).startswith("_")
    ]


def _drawn(ln: Any) -> dict[str, Any]:
    line = ln.get_linestyle() not in ("None", "none", "") and ln.get_linewidth() > 0
    return {"line": line, "width": ln.get_linewidth() if line else None}


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_each_series_is_drawn_at_its_canvas_width(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    lines = _lines(monkeypatch, case["route"], case["body"])
    assert [_drawn(ln) for ln in lines] == case["drawn"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_canvas_width_is_not_the_presets(case: dict[str, Any]) -> None:
    """Not vacuous: every drawn width differs from the case's preset width, so
    a request that lost its widths would fail the test above."""
    body = case["body"]
    preset = figure_style(body.get("style") or "default").line_width
    widths = [d["width"] for d in case["drawn"] if d["line"]]
    assert all(w != preset for w in widths), (widths, preset)
