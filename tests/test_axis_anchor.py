"""Plan item 24 -- anchored major ticks, the BACKEND half.

``frontend/src/lib/axisAnchorFixture.test.ts`` records the pure rule's cases, the ticks the canvas
axis draws and the export request for the same typed axis in ``axis_anchor.json``. Here
``anchor_ticks`` must agree with the canvas, and the real route must draw the same major ticks.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.axis_anchor import MAX_ANCHOR_TICKS, anchor_ticks, apply_anchor_ticks

client = TestClient(app)
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "axis_anchor.json").read_text(encoding="utf-8")
)


def _id(c: dict[str, Any]) -> str:
    return f"{c['min']}..{c['max']}/{c['step']}@{c['anchor']}"


@pytest.mark.parametrize("case", FIXTURE["pure"], ids=_id)
def test_the_pure_rule_matches_the_canvas(case: dict[str, Any]) -> None:
    got = anchor_ticks(case["min"], case["max"], case["step"], case["anchor"])
    assert got == pytest.approx(case["ticks"], abs=1e-12)
    assert len(got) == len(case["ticks"])


def test_the_cap() -> None:
    assert anchor_ticks(0, MAX_ANCHOR_TICKS * 2, 1, 0) == []


def test_the_export_draws_the_canvas_ticks(monkeypatch: pytest.MonkeyPatch) -> None:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=FIXTURE["request"])
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    ax = kept[-1].axes[0]
    lo, hi = ax.get_xlim()
    drawn = [t for t in ax.get_xticks() if lo - 1e-9 <= t <= hi + 1e-9]
    assert drawn == pytest.approx(FIXTURE["typed"]["ticks"])
    assert len(drawn) == len(FIXTURE["typed"]["ticks"])


def test_the_auto_step_is_anchored_too() -> None:
    fig = matplotlib.figure.Figure()
    ax = fig.subplots()
    ax.plot([0, 9], [0, 1])
    ax.set_xlim(0, 9)
    ax.set_xticks([0, 3, 6, 9])  # a fixed locator: step 3
    apply_anchor_ticks(ax.xaxis, {"anchor": 1}, "linear")
    fig.canvas.draw()
    assert list(ax.get_xticks()) == pytest.approx([1, 4, 7])


@pytest.mark.parametrize(
    ("scale", "fmt", "broken"),
    [("log", {"anchor": 1}, False), ("linear", {"anchor": 1, "custom": {"at": [1]}}, False),
     ("linear", {"anchor": 1}, True), ("linear", {"anchor": "x"}, False), ("linear", {}, False)],
)
def test_it_refuses_what_it_cannot_anchor(scale: str, fmt: dict[str, Any], broken: bool) -> None:
    fig = matplotlib.figure.Figure()
    ax = fig.subplots()
    before = ax.xaxis.get_major_locator()
    apply_anchor_ticks(ax.xaxis, fmt, scale, broken=broken)
    assert ax.xaxis.get_major_locator() is before
