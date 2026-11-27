"""Plan item 24 -- subgroup increments in the dash / marker cycle, the BACKEND half.

``frontend/src/lib/seriesSubgroupFixture.test.ts`` records, in ``series_subgroup.json``, what the
canvas draws for seven series with a subgroup size of 3 (colour per run of three, dash and
marker per member) and the export request the app builds for the same. The route must draw
the same colour, dash and marker per series.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient
from matplotlib.colors import to_hex

from quantized.app import app

client = TestClient(app)
FIXTURE_FILE = Path(__file__).parent / "fixtures" / "wire" / "series_subgroup.json"
FIXTURE = json.loads(FIXTURE_FILE.read_text(encoding="utf-8"))
_DASH = {None: "-", (8, 4): "--", (2, 4): ":"}
_MARKER = {"circle": "o", "square": "s", "triangle": "^"}


def test_the_export_draws_what_the_canvas_draws(monkeypatch: pytest.MonkeyPatch) -> None:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=FIXTURE["request"])
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    named = [ln for ln in kept[-1].axes[0].lines if not ln.get_label().startswith("_")]
    lines = named
    want = FIXTURE["canvas"]
    assert len(lines) == len(want)
    for line, w in zip(lines, want, strict=True):
        assert to_hex(line.get_color()) == w["color"]
        dash = tuple(w["dash"]) if w["dash"] else None
        assert line.get_linestyle() == _DASH[dash]
        assert line.get_marker() == _MARKER[w["marker_shape"]]


def test_a_run_shares_its_colour_and_a_member_keeps_its_glyph() -> None:
    colours = [w["color"] for w in FIXTURE["canvas"]]
    assert colours[0] == colours[1] == colours[2] != colours[3]
    assert colours[3] == colours[4] == colours[5] != colours[6]
    assert len({w["marker_shape"] for w in FIXTURE["canvas"][:3]}) == 3
