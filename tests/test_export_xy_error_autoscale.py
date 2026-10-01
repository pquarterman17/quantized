"""Error bars in the XY autoscale -- screen == export, the BACKEND half.

``frontend/src/lib/xyErrorAutoscaleFixture.test.ts`` hand-states, per case, the
data domain an auto-scaled axis must cover (every drawn point and both ends of
every drawn error bar, X and Y alike; a hidden series counts for neither) and
pins it beside the export request in ``xy_error_autoscale.json``; its canvas
half asserts a real uPlot instance ranges that domain. Here matplotlib's
autoscaled limits must be that SAME domain padded by matplotlib's margins, and
an explicit limit must win outright.
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "xy_error_autoscale.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _axes(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
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
    return kept[-1].axes[0]


def _padded(domain: list[float], margin: float) -> tuple[float, float]:
    pad = (domain[1] - domain[0]) * margin
    return (domain[0] - pad, domain[1] + pad)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_autoscale_covers_every_drawn_error_bar(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    mx, my = ax.margins()
    for lim, got, domain, margin in (
        (case["x_lim"], ax.get_xlim(), case["x_domain"], mx),
        (case["y_lim"], ax.get_ylim(), case["y_domain"], my),
    ):
        if lim is not None:
            assert got == pytest.approx(tuple(lim), abs=1e-12)
        else:
            assert got == pytest.approx(_padded(domain, margin), rel=1e-12, abs=1e-12)
