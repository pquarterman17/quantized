"""A flat (zero-span) channel's autoscale -- screen == export, the BACKEND half.

``frontend/src/lib/flatAutoscaleFixture.test.ts`` states the rule (uPlot's
own ``rangeNum`` / ``rangeLog`` on a zero span: a flat 1000 reads 0..2000 on a
linear axis, 100..10000 on a log one), hand-states per case the view of each
flat axis, asserts a real uPlot canvas lands on it, and pins it beside the
export request in ``flat_autoscale.json``. Here the exported axes must land
on the SAME view -- x, y and y2, linear and log.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_autoscale import flat_auto_range

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "flat_autoscale.json"
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
def test_a_flat_axis_autoscales_as_the_canvas(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    axes = _figure(monkeypatch, case["request"]).axes
    ax = axes[0]
    want = case["want"]
    got = {"x": ax.get_xlim(), "y": ax.get_ylim()}
    if "y2" in want:
        twins = [a for a in axes[1:] if a.bbox.bounds == ax.bbox.bounds]
        assert twins, "no secondary axis was drawn"
        got["y2"] = twins[0].get_ylim()
    for key, lim in want.items():
        assert got[key] == pytest.approx(tuple(lim), rel=1e-12, abs=1e-12), key


RANGE_NUM = json.loads(FIXTURE.read_text(encoding="utf-8"))["range_num"]


def test_the_flat_rule_is_uplots_rangenum_bit_for_bit() -> None:
    """``flat_auto_range`` against uPlot's own ``rangeNum`` outputs, written by
    the canvas half: exact, so the export's snapped ends equal the screen's."""
    for lo, hi, want in RANGE_NUM:
        got = flat_auto_range(lo, hi)
        assert got is not None, (lo, hi)
        assert [v + 0.0 for v in got] == [v + 0.0 for v in want], (lo, hi)


def test_a_span_is_flat_only_by_uplots_test() -> None:
    assert flat_auto_range(1.0, 2.0) is None
    assert flat_auto_range(1000.0, 1000.0 + 1e-6) is None  # 9 decades: a real span
    assert flat_auto_range(1000.0, 1000.0 + 1e-8) == (0.0, 2000.0)  # 11 decades: flat
