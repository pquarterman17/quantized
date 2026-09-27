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


def test_a_renamed_legend_still_states_the_offset() -> None:
    # P2.3 review finding 6: `series_display_name` uses a legend rename
    # verbatim, so the offset disclosure `apply_log_offsets` appends to the
    # AUTO-derived label never reached a renamed one -- hiding the offset on
    # exactly the series a user cared enough about to rename.
    body = _payload([0, 3], fmt="svg")
    body["series_styles"] = [None, {"legend": "Renamed P"}]
    res = client.post("/api/export/figure", json=body)
    assert res.status_code == 200, res.text
    svg = res.content.decode()
    legend = re.search(r'<g id="legend_1">(.*?)</svg>', svg, re.S)
    assert legend is not None
    text = legend.group(1)
    assert "Renamed P ×10^3" in text
    assert "B (atoms/cm3)" in text and "B ×10" not in text


def test_absent_or_zero_offsets_render_as_before() -> None:
    assert _log_span(_payload([0, 0]), 1) == pytest.approx(_log_span(_payload(None), 1))


def test_error_spans_scale_with_the_offset_at_the_shared_figure_series_seam() -> None:
    # P2.3 review finding 3 (export half): `_figure_series` is the ONE seam
    # every figure-export route shares (`export_figures.FigureRequest` ->
    # `_figure_series` -> the renderer) -- assert directly on its resolved
    # output rather than re-deriving pixel geometry from an SVG, since that
    # is exactly where the fix lives (`calc.plot_log_offsets.scale_error_spans`).
    from quantized.routes.export_figures import FigureRequest, _figure_series

    req = FigureRequest(
        dataset={
            "time": [0.0, 1.0],
            "values": [[1.0, 2.0], [2.0, 4.0]],
            "labels": ["B", "P"],
            "units": ["atoms/cm3", "atoms/cm3"],
            "metadata": {},
        },
        y_keys=[0, 1],
        log_offsets=[2, 0],
        error_spans=[{"y": {"plus": [0.1, 0.2], "minus": [0.1, 0.2]}}, None],
    )
    resolved = _figure_series(req)
    assert resolved.error_spans == [
        {"y": {"plus": [10.0, 20.0], "minus": [10.0, 20.0]}},  # B: ×10^2, same as its series
        None,
    ]


def test_error_spans_are_forwarded_unscaled_on_the_grouped_branch() -> None:
    # log_offsets are refused together with group_col on the canvas, so
    # nothing scales error_spans there either -- forwarded verbatim.
    from quantized.routes.export_figures import FigureRequest, _figure_series

    req = FigureRequest(
        dataset={
            "time": [0.0, 1.0],
            "values": [[1.0, 0.0], [2.0, 1.0]],
            "labels": ["y", "grp"],
            "units": ["c/s", ""],
            "metadata": {},
            "cat_levels": {1: ["a", "b"]},
        },
        y_keys=[0],
        group_col=1,
        error_spans=[{"y": {"plus": [0.1], "minus": [0.1]}}],
    )
    resolved = _figure_series(req)
    assert resolved.error_spans == [{"y": {"plus": [0.1], "minus": [0.1]}}]
