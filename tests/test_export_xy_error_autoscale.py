"""Error bars in the XY autoscale -- screen == export, the BACKEND half.

``frontend/src/lib/xyErrorAutoscaleFixture.test.ts`` hand-states, per case, the
data domain an auto-scaled axis must cover (every drawn point and both ends of
every drawn error bar, X and Y alike; a hidden series counts for neither) and
pins it beside the export request in ``xy_error_autoscale.json``; its canvas
half asserts a real uPlot instance ranges that domain. Here the exported
limits must be that SAME domain viewed by the canvas' own rule (audit #11:
x exactly the data, y uPlot's ``rangeNum``), and an explicit limit must win
outright.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_autoscale import range_num

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


def _canvas_view(domain: list[float], axis: str, scanned: bool) -> tuple[float, float]:
    """The canvas' view of ``domain`` (audit #11, ``calc.figure_autoscale``):
    x is exactly the data, y uPlot's ``rangeNum``; a non-ascending x takes
    the full-scan rule (x 2%, y 10% soft at zero, no snap). ``range_num``
    itself is pinned bit for bit against uPlot by
    ``tests/test_export_linear_autoscale.py``."""
    lo, hi = domain
    if not scanned:
        return (lo, hi) if axis == "x" else range_num(lo, hi)
    pad = (hi - lo) * (0.02 if axis == "x" else 0.1)
    if axis == "x":
        return (lo - pad, hi + pad)
    return (lo - pad if lo < 0 else max(0.0, lo - pad), hi + pad if hi >= 0 else min(0.0, hi + pad))


def _ascending(request: dict[str, Any]) -> bool:
    xs = request["dataset"]["time"]
    return all(b >= a for a, b in zip(xs, xs[1:], strict=False))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_autoscale_covers_every_drawn_error_bar(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    scanned = not _ascending(case["request"])
    for lim, got, domain, axis in (
        (case["x_lim"], ax.get_xlim(), case["x_domain"], "x"),
        (case["y_lim"], ax.get_ylim(), case["y_domain"], "y"),
    ):
        if lim is not None:
            assert got == pytest.approx(tuple(lim), abs=1e-12)
        else:
            assert got == pytest.approx(_canvas_view(domain, axis, scanned), rel=1e-12, abs=1e-12)
