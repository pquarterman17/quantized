"""A secondary-axis figure's legend -- screen == export, the BACKEND half.

``frontend/src/lib/y2LegendFixture.test.ts`` pins, per case, the legend entries
the canvas shows (every drawn series, in display order, whichever Y axis it is
on) beside the exact request the app sends (which always carries a ``legend``
override). The exported legend must list that same series set, in that order,
with the same title -- and none at all when the view hides it.
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "y2_legend.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _figure(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
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
    return kept[-1]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_exported_legend_lists_what_the_canvas_legend_lists(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _figure(monkeypatch, case["request"])
    assert len(fig.axes) == 2, "the request must draw a real secondary axis"
    legends = [ax.get_legend() for ax in fig.axes if ax.get_legend() is not None]
    if case["legend"] is None:
        assert legends == []
        return
    assert len(legends) == 1, "one combined legend"
    legend = legends[0]
    assert [t.get_text() for t in legend.get_texts()] == case["legend"]
    title = legend.get_title().get_text()
    assert title == (case["legend_title"] or "")


def test_the_override_placement_survives_the_combined_rebuild(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # "nw" on screen -> matplotlib "upper left" (code 2); a free-placed legend
    # keeps its figure-fraction anchor.
    corner = next(c for c in CASES if c["name"] == "y2 series after the primary")
    legend = _figure(monkeypatch, corner["request"]).axes[0].get_legend()
    assert legend._loc == 2  # noqa: SLF001 -- matplotlib keeps the resolved loc here
    free = next(c for c in CASES if c["name"] == "a free-placed legend")
    fig = _figure(monkeypatch, free["request"])
    legend = fig.axes[0].get_legend()
    box = legend.get_bbox_to_anchor().transformed(fig.transFigure.inverted())
    assert (box.x0, box.y0) == pytest.approx((0.3, 0.4))
