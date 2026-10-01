"""A 2-D map's explicit colour limits -- screen == export, the BACKEND half.

``frontend/src/components/Stage/mapColorLimitsFixture.test.ts`` pins, per case,
the colour range the canvas paints (``mapRender.effectiveColorLimits``, in the
request's z units) beside the exact ``/api/export/map-figure`` body MapStage's
vector export sends. The rendered colour mapping must span that same range;
for the heatmap the colourbar must read it too.
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "map_color_limits.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _figure(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/map-figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_export_colours_over_the_range_the_canvas_paints(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _figure(monkeypatch, case["request"])
    mappable = fig.axes[0].collections[0]
    lo, hi = case["clim"]
    assert (mappable.norm.vmin, mappable.norm.vmax) == pytest.approx((lo, hi), abs=1e-12)
    if case["request"]["kind"] == "heatmap":
        colorbar_axes = fig.axes[1]
        assert sorted(colorbar_axes.get_ylim()) == pytest.approx([lo, hi], abs=1e-12)
