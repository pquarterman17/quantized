"""Analysis overlays never drive the Y autoscale -- the BACKEND half of the
screen == export pin (UX audit 7 #8, lane UX-I).

``frontend/src/lib/overlayAutoscaleFixture.test.ts`` puts an overlay below the
data (a fitted background diving through zero on a log axis, a baseline or a
fit band's lower edge far under a linear trace, the same beside a Y2 channel
and across X-break panels), asserts the canvas draws the data's own view
(``want``, and ``want_y2`` for the secondary axis) and pins the Stage export
request in ``overlay_autoscale.json``. Here the exported axes must land on the
SAME view, and without the overlay marks they would not (the case is live).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "overlay_autoscale.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))
IDS = [c["name"] for c in DATA["cases"]]


def _ylims(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> list[tuple[float, float]]:
    """Every axes' y limits, in figure order (Y1 first; a Y2 twin next; X-break
    panels share one y)."""
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return [(float(ax.get_ylim()[0]), float(ax.get_ylim()[1])) for ax in kept[-1].axes]


@pytest.mark.parametrize("case", DATA["cases"], ids=IDS)
def test_the_export_ranges_y_on_the_data_as_the_canvas(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    lims = _ylims(monkeypatch, case["request"])
    assert lims[0] == pytest.approx(tuple(case["want"]), rel=1e-12)
    if "x_breaks" in (case["request"].get("overrides") or {}):
        assert len(lims) >= 2
        assert all(lim == lims[0] for lim in lims)  # one shared y
    if "want_y2" in case:
        assert lims[1] == pytest.approx(tuple(case["want_y2"]), rel=1e-12)


@pytest.mark.parametrize("case", DATA["cases"], ids=IDS)
def test_unmarked_the_same_series_would_widen_it(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    body = copy.deepcopy(case["request"])
    body["analysis_overlays"] = [False] * len(body["y_keys"])
    lo, _hi = _ylims(monkeypatch, body)[0]
    assert lo < case["want"][0]
