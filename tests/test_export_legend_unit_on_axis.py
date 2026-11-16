"""UX8-C: a shared-unit overlay graph's EXPORTED legend omits the unit, as on screen.

The linked graph keeps its columns' units (worksheet, CSV, fits); only its
legend reads "MH_010K" instead of "MH_010K (emu)", because the Y title carries
the unit. The flag is the dataset's ``metadata["legend_unit_on_axis"]``. A
legend rename (``series_styles[i].legend``) still wins verbatim. Both legs read
``tests/fixtures/wire/legend_unit_on_axis.json``; the screen leg is
``frontend/src/lib/legendUnitOnAxis.test.ts``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.plotting import PlotSeries
from quantized.routes.export_figures_labels import legend_unit_on_axis, series_names

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "legend_unit_on_axis.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]

client = TestClient(app)


def _legend_entries(svg: str) -> list[str]:
    start = svg.index('<g id="legend_1">')
    return re.findall(r"<text[^>]*>([^<]*)</text>", svg[start:])


def _payload(case: dict[str, Any]) -> dict[str, Any]:
    series = case["series"]
    n = 5
    meta: dict[str, Any] = {"legend_unit_on_axis": True} if case["flag"] else {}
    return {
        "dataset": {
            "time": [float(i) for i in range(n)],
            "values": [[float(i + k) for k in range(len(series))] for i in range(n)],
            "labels": [s[0] for s in series],
            "units": [s[1] for s in series],
            "metadata": meta,
        },
        "y_keys": list(range(len(series))),
        "fmt": "svg",
        "y_label": "Moment (emu)",
        "series_styles": [None if s[2] is None else {"legend": s[2]} for s in series],
        "overrides": {"legend": {"show": True, "loc": "upper right"}},
        "filename": "legend_unit_on_axis",
    }


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_series_names_follow_the_flag(case: dict[str, Any]) -> None:
    series = [PlotSeries(label=s[0], unit=s[1], values=np.zeros(2)) for s in case["series"]]
    legends = [s[2] for s in case["series"]]
    flag = legend_unit_on_axis({"legend_unit_on_axis": True} if case["flag"] else {})
    assert series_names(series, legends, unit_on_axis=flag) == case["legend"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_exported_legend_matches_the_screen(case: dict[str, Any]) -> None:
    resp = client.post("/api/export/figure", json=_payload(case))
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    entries = [e for e in _legend_entries(svg) if e.strip()]
    for want in case["legend"]:
        assert want in entries
    if case["flag"]:
        assert "MH_040K (emu)" not in svg  # the derived "label (unit)" never appears
    assert "Moment (emu)" in svg  # the unit stays on the Y title


def test_only_a_literal_true_counts() -> None:
    assert legend_unit_on_axis({"legend_unit_on_axis": True})
    assert not legend_unit_on_axis({"legend_unit_on_axis": "true"})
    assert not legend_unit_on_axis({})
    assert not legend_unit_on_axis(None)
