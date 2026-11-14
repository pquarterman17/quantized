"""A Y axis carrying several series exports the title the screen shows.

The canvas (``frontend/src/lib/sharedAxisTitle.ts``) titles such an axis with
a JOINT title grouped by unit ("R1, R2 (ohm) / V (V)"); "quantity (unit)"
when every series shares both. Both legs read the cases in
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
    # One column per file, one unit.
    assert "a.dat, b.dat (emu)" in _svg(_payload(["emu", "emu"], ["a.dat", "b.dat"]))


def test_series_with_different_units_export_a_joint_y_title() -> None:
    # Origin gap audit 2 #11: a mixed-unit axis used to export no title.
    assert "M (emu) / T (K)" in _svg(_payload(["emu", "K"], ["M", "T"]))


def test_a_user_y_title_still_wins() -> None:
    payload = _payload(["emu", "emu"], ["a.dat", "b.dat"])
    payload["y_label"] = "Signal"
    svg = _svg(payload)
    assert "Signal" in svg
    assert "emu" not in svg
