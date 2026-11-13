"""A linear axis with a real span autoscales as the canvas -- the BACKEND half
(publication-figures audit #11: the screen read x 0.1..9.9 while the export
padded to 0..10.4, so a text box anchored to the data sat elsewhere).

``frontend/src/lib/linearAutoscaleFixture.test.ts`` states the rule (x exactly
the data; y uPlot's ``rangeNum(min, max, 0.1, true)``; a non-ascending x the
full-scan pads), asserts a real uPlot canvas lands on each hand-stated view and
pins it beside the export request in ``linear_autoscale.json``. Here the
exported axes must land on the SAME view, and ``range_num`` must equal uPlot's
helper bit for bit.
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "linear_autoscale.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))


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
    return kept[-1].axes[0]


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_a_linear_axis_autoscales_as_the_canvas(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    assert ax.get_xlim() == pytest.approx(tuple(case["want"]["x"]), rel=1e-12, abs=1e-12)
    assert ax.get_ylim() == pytest.approx(tuple(case["want"]["y"]), rel=1e-12, abs=1e-12)


def test_range_num_is_uplots_bit_for_bit() -> None:
    for lo, hi, want in DATA["range_num"]:
        assert [v + 0.0 for v in range_num(lo, hi)] == [v + 0.0 for v in want], (lo, hi)
