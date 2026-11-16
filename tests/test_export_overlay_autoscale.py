"""Analysis overlays never drive the Y autoscale -- the BACKEND half of the
screen == export pin (UX audit 7 #8, lane UX-I).

``frontend/src/lib/overlayAutoscaleFixture.test.ts`` puts an overlay below the
data (a fitted background diving through zero on a log axis, a baseline or a
fit band's lower edge far under a linear trace), asserts a real uPlot canvas
draws the data's own view (``want``) and pins the Stage export request in
``overlay_autoscale.json``. Here the exported axes must land on the SAME view,
and without the overlay marks they would not (the case is live).
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


def _ylim(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> tuple[float, float]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    lo, hi = kept[-1].axes[0].get_ylim()
    return float(lo), float(hi)


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_the_export_ranges_y_on_the_data_as_the_canvas(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    assert _ylim(monkeypatch, case["request"]) == pytest.approx(tuple(case["want"]), rel=1e-12)


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_unmarked_the_same_series_would_widen_it(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    body = copy.deepcopy(case["request"])
    body["analysis_overlays"] = [False] * len(body["y_keys"])
    lo, _hi = _ylim(monkeypatch, body)
    assert lo < case["want"][0]
