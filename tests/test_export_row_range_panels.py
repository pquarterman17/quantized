"""A row window on a facet grid and an axis break -- screen == export, the BACKEND half.

``frontend/src/lib/rowRangePanelsFixture.test.ts`` pins the Stage export request in
``row_range_panels.json`` and hand-states, per panel, the x and y of the window's rows.
The exported figure must draw exactly those rows in each panel; the expected rows are an
independent numpy selection of the sheet (x = row, with the gap after row 29; y = 2 * row
+ 1; facet level = row % 3; row 25 excluded; window rows 20-43).
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "row_range_panels.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _drawn_panels(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> list[np.ndarray]:
    """The (x, y) of the first line of every axes that draws one, in figure order."""
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return [np.asarray(ax.lines[0].get_xydata(), dtype=float) for ax in kept[-1].axes if ax.lines]


def _numpy_window() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    row = np.arange(200)
    x = np.where(row < 30, row, row + 100)
    keep = (row >= 20) & (row <= 43) & (row != 25)
    return row[keep], x[keep], 2.0 * row[keep] + 1


def test_the_facet_panels_hold_the_window_rows_of_their_level(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = CASES[0]
    panels = _drawn_panels(monkeypatch, case["request"])
    row, x, y = _numpy_window()
    assert len(panels) == 3
    for level, xy in enumerate(panels):
        sel = row % 3 == level
        assert xy[:, 0] == pytest.approx(x[sel])
        assert xy[:, 1] == pytest.approx(y[sel])
        assert xy[:, 0] == pytest.approx(case["want"]["panels"][level]["x"])


def test_the_axis_break_panels_hold_the_window_rows_of_their_segment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = CASES[1]
    panels = _drawn_panels(monkeypatch, case["request"])
    row, x, y = _numpy_window()
    assert len(panels) == 2
    for side, xy in zip((row < 30, row >= 30), panels, strict=True):
        assert xy[:, 0] == pytest.approx(x[side])
        assert xy[:, 1] == pytest.approx(y[side])
    # Nothing outside the window: the sheet has 200 rows, the panels hold only the window's.
    assert sum(len(p) for p in panels) == len(row)
