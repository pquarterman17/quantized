"""A Y axis carrying several series exports the title the screen shows.

The canvas (``frontend/src/lib/sharedAxisTitle.ts``) titles such an axis with
what its series share: "quantity (unit)" when both are common, "(unit)" when
only the unit is, nothing when the units differ. Both legs read the cases in
``tests/fixtures/wire/shared_axis_title.json``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_labels import shared_axis_title
from quantized.calc.plotting import PlotSeries

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "shared_axis_title.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]

client = TestClient(app)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_axis_title_matches_the_screen_rule(case: dict[str, Any]) -> None:
    series = [PlotSeries(label, unit, np.zeros(2)) for label, unit in case["series"]]
    assert shared_axis_title(series) == case["title"]


def _payload(units: list[str], labels: list[str]) -> dict[str, Any]:
    return {
        "dataset": {
            "time": [0.0, 1.0, 2.0],
            "values": [[1.0, 2.0], [2.0, 3.0], [3.0, 5.0]],
            "labels": labels,
            "units": units,
            "metadata": {},
        },
        "y_keys": [0, 1],
        "fmt": "svg",
        # Legend renames, so any data-derived text in the SVG is the axis title.
        "series_styles": [{"legend": "Loop 1"}, {"legend": "Loop 2"}],
        "overrides": {"legend": {"show": True, "loc": "upper right"}},
        "filename": "shared",
    }


def _svg(payload: dict[str, Any]) -> str:
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.content.decode("utf-8", "ignore")


def test_two_series_sharing_a_unit_export_it_as_the_y_title() -> None:
    # A "Plot selected together" overlay: one column per file, one unit.
    assert "(emu)" in _svg(_payload(["emu", "emu"], ["a.dat", "b.dat"]))


def test_series_with_different_units_export_no_y_title() -> None:
    svg = _svg(_payload(["emu", "K"], ["M", "T"]))
    assert "emu" not in svg
    assert "(K)" not in svg


def test_a_user_y_title_still_wins() -> None:
    payload = _payload(["emu", "emu"], ["a.dat", "b.dat"])
    payload["y_label"] = "Signal"
    svg = _svg(payload)
    assert "Signal" in svg
    assert "emu" not in svg
