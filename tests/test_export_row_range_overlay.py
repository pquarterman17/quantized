"""A row-windowed overlay (a fit or a baseline) -- screen == export, the BACKEND half.

``frontend/src/lib/rowRangeOverlayFixture.test.ts`` states the rule (an overlay is drawn
only over the plot's row window, from the same rows as the data, and never drives the Y
autoscale), asserts the canvas, and pins the Stage export request in
``row_range_overlay.json``. Here the exported figure must land on the same x and y view,
hold the data line at exactly the window's rows, and draw the overlay line at exactly
those rows with the values the canvas stroked.
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "row_range_overlay.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
IDS = [c["name"] for c in CASES]


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


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_the_export_ranges_on_the_data_inside_the_window(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    want = case["want"]
    assert ax.get_xlim() == pytest.approx(tuple(want["x"]), rel=1e-9, abs=1e-6)
    assert ax.get_ylim() == pytest.approx(tuple(want["y"]), rel=1e-9, abs=1e-6)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_the_overlay_line_holds_exactly_the_window_rows_at_their_values(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    want = case["want"]
    rows = np.asarray(want["rows"])
    # Two lines: the data, then the overlay; the expected rows are an independent numpy selection.
    data_line, overlay_line = (np.asarray(line.get_xydata(), dtype=float) for line in ax.lines[:2])
    assert len(ax.lines) == 2
    for xy in (data_line, overlay_line):
        assert xy[:, 0] == pytest.approx(0.5 * rows)  # the x of exactly those source rows
    assert overlay_line[:, 1] == pytest.approx(want["overlay_y"])
    assert data_line[:, 1] == pytest.approx(50 + (rows % 7) * 3)  # the data, from the same rows
    # Nothing from outside the window (the sheet holds 9000+ there).
    assert max(overlay_line[:, 1].max(), data_line[:, 1].max()) < 1000
