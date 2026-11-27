"""A plot's row window -- screen == export, the BACKEND half.

``frontend/src/lib/rowRangeFigureFixture.test.ts`` states the rule (rows outside
``PlotView.rowRange`` are not drawn and range neither axis) and pins, per case,
the view and the source rows drawn in ``row_range_figure.json``. The request in
the fixture holds exactly the window's rows; the exported figure must land on the
same x range, y range and drawn points as the canvas.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "row_range_figure.json"
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
def test_the_export_ranges_and_draws_only_the_window(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _figure(monkeypatch, case["request"]).axes[0]
    want = case["want"]
    assert ax.get_xlim() == pytest.approx(tuple(want["x"]), rel=1e-9, abs=1e-6)
    assert ax.get_ylim() == pytest.approx(tuple(want["y"]), rel=1e-9, abs=1e-6)
    xy = np.asarray(ax.lines[0].get_xydata(), dtype=float)
    # Exactly the drawn rows: the figure holds the window, nothing hidden rides along.
    assert len(xy) == len(want["rows"]) == len(case["request"]["dataset"]["time"])
    assert xy[:, 0] == pytest.approx([0.5 * r for r in want["rows"]])
