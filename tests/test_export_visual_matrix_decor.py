"""P4.2 rendered-output regression matrix, decorated/paneled fixtures
(PRIMARY_SOFTWARE_AUDIT_PLAN, ~line 9519): "break", "waterfall", "decor" of
the nine canonical figures (``frontend/src/lib/regressionMatrixFixtures
.testkit.ts``'s ``MATRIX_FIXTURES``). See ``test_export_visual_matrix_flat
.py``'s module docstring for the shared rationale and
``tests/_regression_matrix_wire.py`` for the shared dataset + SVG helpers.
"""

from __future__ import annotations

import re
from typing import Any

import pytest
from fastapi.testclient import TestClient

from _regression_matrix_wire import (
    DASHED_LINE_RE,
    axes_bbox_px,
    axes_minus_legend,
    extract_group,
    flatten,
    matrix_dataset,
    square_marker_glyph,
)
from quantized.app import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixture 6/9: "break" -- one manually-broken x-axis range ([2, 3]) over the
# Signal channel: a real ``calc.figure_break`` paneled render (two side-by-
# side axes sharing the y scale), not a discontinuous-tick trick.
# ---------------------------------------------------------------------------


def _break_payload(x_breaks: list[list[float]] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "dataset": matrix_dataset(), "y_keys": [0], "fmt": "svg", "title": "Matrix fixture",
    }
    if x_breaks is not None:
        payload["overrides"] = {"x_breaks": x_breaks}
    return payload


def test_break_fixture_renders_two_panels_tiled_left_to_right() -> None:
    resp = client.post("/api/export/figure", json=_break_payload([[2, 3]]))
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    axes_ids = re.findall(r'<g id="(axes_\d+)"', svg)
    assert axes_ids == ["axes_1", "axes_2"]

    box1 = axes_bbox_px(extract_group(svg, "axes_1"))
    box2 = axes_bbox_px(extract_group(svg, "axes_2"))
    assert box1[2] <= box2[0] + 1e-6  # panel 1 sits strictly left of panel 2
    assert box1[1] == box2[1] and box1[3] == box2[3]  # shared y-extent
    assert "Matrix fixture" in svg  # the suptitle, still present on a break


def test_break_fixture_is_a_single_panel_without_an_explicit_break() -> None:
    # Negative control, same dataset/channel: omitting `x_breaks` renders the
    # ordinary single-axes figure -- proof the two-panel result above comes
    # from the break specifically, and pins the realistic regression of a
    # break request silently collapsing back to one panel (e.g. a dropped
    # `overrides["x_breaks"]` read, or `_visible_bounds` always returning one
    # span).
    resp = client.post("/api/export/figure", json=_break_payload(None))
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    assert re.findall(r'<g id="(axes_\d+)"', svg) == ["axes_1"]


# ---------------------------------------------------------------------------
# Fixture 7/9: "waterfall" -- Signal/Reference staggered by an explicit
# per-series offset (BUG-013's export parity), read back from the SAME
# figure-hitmap pixel geometry test_export_vector_structure.py's own
# waterfall tests use (the hit-map harvests ax.get_ylim()/pixel boxes off
# the SAME rendered Axes the SVG/PDF export draws).
# ---------------------------------------------------------------------------


def _waterfall_payload(offsets: list[float] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "dataset": matrix_dataset(), "y_keys": [0, 1], "fmt": "png",
        "overrides": {"y_lim": [-2.0, 5.0]},
    }
    if offsets is not None:
        payload["waterfall_offsets"] = offsets
    return payload


def _series_span(hitmap: dict[str, Any], index: int) -> tuple[float, float]:
    axes = hitmap["axes"]
    box = next(e for e in hitmap["elements"] if e["id"] == f"series:{index}")
    lo, hi = axes["ylim"]
    span_px = axes["y1"] - axes["y0"]

    def to_data(py: float) -> float:
        return hi - (py - axes["y0"]) / span_px * (hi - lo)

    return to_data(box["y1"]), to_data(box["y0"])


def _hitmap(payload: dict[str, Any]) -> dict[str, Any]:
    resp = client.post("/api/export/figure-hitmap", json=payload)
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


def test_waterfall_fixture_shifts_each_series_by_its_own_offset() -> None:
    plain = _hitmap(_waterfall_payload(None))
    staggered = _hitmap(_waterfall_payload([0.0, 1.0]))
    for index, want_shift in ((0, 0.0), (1, 1.0)):
        before = _series_span(plain, index)
        after = _series_span(staggered, index)
        assert after[0] - before[0] == pytest.approx(want_shift, abs=0.05)
        assert after[1] - before[1] == pytest.approx(want_shift, abs=0.05)


# ---------------------------------------------------------------------------
# Fixture 8/9: "decor" -- the full per-series style vocabulary (colour,
# width, dash/dotted line, marker shape+size, fill-under, step) plus
# annotations, arrow + rect shapes, x/y reference lines, a region shade, and
# a titled legend -- one figure exercising nearly every override key
# ``calc.figure_overrides``/``figure_decor``/``figure_shapes`` own.
# ---------------------------------------------------------------------------


def _decor_payload() -> dict[str, Any]:
    return {
        "dataset": matrix_dataset(),
        "y_keys": [0, 1],
        "fmt": "svg",
        "series_styles": [
            {
                "color": "#ffe066", "width": 2, "line": "dashed",
                "marker": True, "marker_shape": "square", "marker_size": 7,
                "fill": "under",
            },
            {"color": "#66ffd9", "width": 1, "line": "dotted", "step": "post"},
        ],
        "overrides": {
            "legend": {"show": True, "loc": "lower right", "title": "Runs"},
            "annotations": [
                {"x": 1, "y": 0.5, "text": "onset"},
                {"x": 4, "y": 2.5, "text": "plateau"},
            ],
            "shapes": [
                {"kind": "arrow", "x1": 1, "y1": 1, "x2": 3, "y2": 2},
                {"kind": "rect", "x1": 2, "y1": 0, "x2": 4, "y2": 1},
            ],
            "ref_lines": [{"axis": "x", "value": 2.5}, {"axis": "y", "value": 1.5}],
            "region_shades": [{"x1": 0.5, "x2": 1.5, "y1": 0, "y2": 3, "fill": "#334455"}],
        },
    }


def test_decor_fixture_renders_every_style_and_overlay_kind() -> None:
    resp = client.post("/api/export/figure", json=_decor_payload())
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    flat = flatten(svg)

    # Per-series style vocabulary.
    assert "FillBetweenPolyCollection" in svg  # series 0's fill: "under"
    assert square_marker_glyph(3.5) in flat  # series 0's marker_shape: "square"
    # Dashed vs dotted are both dash-pattern draws (`stroke-dasharray`) --
    # matched on the drawn CURVE only (axes minus its own legend swatch copy,
    # `DASHED_LINE_RE` requiring the exact one-attribute style matplotlib
    # emits) so a missing `line` mapping for either series is caught, not
    # papered over by a loose "this colour appears somewhere near a dash
    # pattern" match.
    dash_lines = DASHED_LINE_RE.findall(axes_minus_legend(svg))
    dashed = {(color, width) for _dash, color, width in dash_lines}
    assert ("#ffe066", "2") in dashed  # series 0: dashed, width 2
    assert ("#66ffd9", "") in dashed  # series 1: dotted, width 1 (mpl default, omitted)

    # Overlays, each tagged with its own stable gid.
    assert re.findall(r'<g id="(refline:\d+)"', svg) == ["refline:0", "refline:1"]
    assert re.findall(r'<g id="(shape:\d+)"', svg) == ["shape:0", "shape:1"]
    assert "#334455" in svg  # the region shade's fill colour

    # Annotations: present, exactly once each, outside the legend.
    legend = extract_group(svg, "legend_1")
    for text in ("onset", "plateau"):
        assert svg.count(text) == 1
        assert text not in legend

    # The legend TITLE (forces/labels the legend even though this figure has
    # 2 series already) -- Origin-parity decode-plan #52's bold header.
    assert "Runs" in legend
