"""Decade offsets reach the vector export (audit P2.3, box 3).

The canvas draws series i at ``y * 10**k_i`` with a ``" ×10^k"`` legend
suffix (``frontend/src/lib/logOffset.ts``); the export route must render the
same thing from the ``log_offsets`` wire field. Read STRUCTURALLY: the legend
text from the SVG, and where each series lands on the log axis from the
hit-map's pixel boxes and the axis limits the renderer reported.
"""

from __future__ import annotations

import math
import re
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

_N = 20
_YLIM = [1e-1, 1e6]


def _payload(offsets: list[float] | None, fmt: str = "png") -> dict[str, Any]:
    xs = [float(i) for i in range(_N)]
    body: dict[str, Any] = {
        "dataset": {
            "time": xs,
            # Both species live between 1 and 10: one decade, fully overlapping.
            "values": [[1.0 + 9.0 * i / (_N - 1), 2.0] for i in range(_N)],
            "labels": ["B", "P"],
            "units": ["atoms/cm3", "atoms/cm3"],
            "metadata": {},
        },
        "y_keys": [0, 1],
        "y_scale": "log",
        "fmt": fmt,
        "filename": "sims",
        "overrides": {"y_lim": _YLIM},
    }
    if offsets is not None:
        body["log_offsets"] = offsets
    return body


def _log_span(payload: dict[str, Any], index: int) -> tuple[float, float]:
    """(log10 y_min, log10 y_max) of series ``index``, from its pixel box."""
    res = client.post("/api/export/figure-hitmap", json=payload)
    assert res.status_code == 200, res.text
    hm = res.json()
    axes = hm["axes"]
    box = next(e for e in hm["elements"] if e["id"] == f"series:{index}")
    lo, hi = (math.log10(v) for v in axes["ylim"])
    span_px = axes["y1"] - axes["y0"]

    def to_log(py: float) -> float:
        return hi - (py - axes["y0"]) / span_px * (hi - lo)

    return to_log(box["y1"]), to_log(box["y0"])


def test_offsets_shift_each_series_by_whole_decades_on_the_log_axis() -> None:
    for index, decades in ((0, 0.0), (1, 3.0)):
        before = _log_span(_payload(None), index)
        after = _log_span(_payload([0, 3]), index)
        assert after[0] - before[0] == pytest.approx(decades, abs=0.05)
        assert after[1] - before[1] == pytest.approx(decades, abs=0.05)


def test_the_legend_states_the_offset_like_the_canvas() -> None:
    res = client.post("/api/export/figure", json=_payload([0, 3], fmt="svg"))
    assert res.status_code == 200, res.text
    svg = res.content.decode()
    legend = re.search(r'<g id="legend_1">(.*?)</svg>', svg, re.S)
    assert legend is not None
    text = legend.group(1)
    # Canvas rule: suffix BEFORE the unit; an un-offset series is unchanged.
    assert "P ×10^3 (atoms/cm3)" in text
    assert "B (atoms/cm3)" in text and "B ×10" not in text


def test_absent_or_zero_offsets_render_as_before() -> None:
    assert _log_span(_payload([0, 0]), 1) == pytest.approx(_log_span(_payload(None), 1))
