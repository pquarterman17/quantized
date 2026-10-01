"""The Preferences default trace (Scatter / Line + markers / Step) -- screen ==
export, the BACKEND half.

``frontend/src/lib/defaultTraceFixture.test.ts`` pins, per case, what every
drawn series looks like on the canvas (connecting line, markers and their
size, step-after) beside the exact request the live Stage export sends -- a
flat, facet-grid or Color-by request. matplotlib must draw each exported
series the same way: a default-trace marker, and any marker with no explicit
size (Inspector, Graph Builder mark), at the canvas' size, not the style
preset's (the fixture's ``marker_size_rule``); and a line with no explicit
width at the canvas' template width, not the preset's ``line_width`` (the
fixture's ``line_width_rule``). A request that names no width keeps the
preset's calibrated value (an API or CLI caller).
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "default_trace.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _lines(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> list[Any]:
    """Every drawn series line, panel by panel (one panel unless faceted)."""
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
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


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_each_exported_series_is_drawn_in_the_canvas_trace(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    lines = _lines(monkeypatch, case["request"])
    drawn = []
    for ln in lines:
        marker = ln.get_marker() not in (None, "None", "none", "")
        line = ln.get_linestyle() not in ("None", "none", "") and ln.get_linewidth() > 0
        drawn.append({
            "line": line,
            "marker": marker,
            "size": ln.get_markersize() if marker else None,
            "step": "post" if ln.get_drawstyle() == "steps-post" else None,
            "width": ln.get_linewidth() if line else None,
        })
    assert drawn == case["drawn"]


@pytest.mark.parametrize("style", ["default", "aps", "nature", "poster"])
def test_a_request_naming_no_width_keeps_the_presets_line_width(
    monkeypatch: pytest.MonkeyPatch, style: str
) -> None:
    body = {**CASES[0]["request"], "style": style}
    body.pop("series_styles", None)
    lines = _lines(monkeypatch, body)
    assert lines
    assert {ln.get_linewidth() for ln in lines} == {figure_style(style).line_width}
