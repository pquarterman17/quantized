"""P4.2 rendered-output regression matrix, split-axes fixtures
(PRIMARY_SOFTWARE_AUDIT_PLAN, ~line 9519): "group", "facet", "y2" of the nine
canonical figures (``frontend/src/lib/regressionMatrixFixtures.testkit.ts``'s
``MATRIX_FIXTURES``). See ``test_export_visual_matrix_flat.py``'s module
docstring for the shared rationale (real ``/api/export/figure`` route via
``TestClient``, structural-not-pixel comparison) and
``tests/_regression_matrix_wire.py`` for the shared dataset + SVG helpers.

These three all draw onto MORE than one axes-worth of geometry per figure --
group (one categorical column expands into several drawn series sharing one
axes), facet (a small-multiples grid), y2 (a real ``twinx()`` second axes) --
which is what sets them apart from test_export_visual_matrix_flat.py's
single-axes, single-series-list fixtures.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi.testclient import TestClient

from _regression_matrix_wire import (
    DASHED_LINE_RE,
    axes_minus_legend,
    extract_group,
    legend_entries,
    matrix_dataset,
)
from quantized.app import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixture 3/9: "group" -- one channel (Signal) split by the categorical
# "Batch" column (codes 0/1/2) into three drawn series, all sharing the
# channel's ONE style entry (BUG-016) -- width 2, dashed, cycling colour
# (no explicit `color`, so each level takes the matplotlib property cycle).
# ---------------------------------------------------------------------------


def _group_payload() -> dict[str, Any]:
    return {
        "dataset": matrix_dataset(),
        "y_keys": [0],
        "fmt": "svg",
        "group_col": 6,
        "series_styles": [{"width": 2, "line": "dashed"}],
    }


def test_group_fixture_expands_one_style_onto_every_level() -> None:
    # Sabotage-verified: disabling `_plot_kwargs`'s `line in _LINESTYLE`
    # branch in calc.figure (the realistic "drop per-series dash"
    # regression -- BUG-016's original failure mode, one layer down) drops
    # this to 0 dashed lines and fails the assertion below; reverted after.
    resp = client.post("/api/export/figure", json=_group_payload())
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    lines = DASHED_LINE_RE.findall(axes_minus_legend(svg))
    assert len(lines) == 3  # Batch has 3 levels (codes 0, 1, 2)
    assert {w for _d, _c, w in lines} == {"2"}  # every level: width 2
    assert len({d for d, _c, _w in lines}) == 1  # every level: same dash pattern
    assert len({c for _d, c, _w in lines}) == 3  # cycling colour, one per level


# ---------------------------------------------------------------------------
# Fixture 4/9: "facet" -- two xy small-multiples panels, one per "Site"
# level (north = rows 0-2, south = rows 3-5), each drawing BOTH plotted
# channels with its own resolved slice -- a mismatch here (wrong row range,
# panels swapped, or one dataset copied into both) is the realistic
# regression this fixture exists to catch.
# ---------------------------------------------------------------------------


def _facet_payload() -> dict[str, Any]:
    return {
        "dataset": matrix_dataset(),
        "y_keys": [0, 1],
        "fmt": "svg",
        "facets": [
            {
                "label": "north",
                "x": [0, 1, 2],
                "series": [
                    {"label": "Signal (au)", "y": [0.0, 0.5, 1.0]},
                    {"label": "Reference (au)", "y": [2.0, 2.25, 2.5]},
                ],
            },
            {
                "label": "south",
                "x": [3, 4, 5],
                "series": [
                    {"label": "Signal (au)", "y": [1.5, 2.0, 2.5]},
                    {"label": "Reference (au)", "y": [2.75, 3.0, 3.25]},
                ],
            },
        ],
    }


def test_facet_fixture_renders_one_panel_per_level_with_its_own_data() -> None:
    resp = client.post("/api/export/figure", json=_facet_payload())
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")

    assert re.findall(r'<g id="(axes_\d+)"', svg) == ["axes_1", "axes_2"]
    panel1 = extract_group(svg, "axes_1")
    panel2 = extract_group(svg, "axes_2")
    assert "north" in panel1 and "south" not in panel1
    assert "south" in panel2 and "north" not in panel2
    # Both channels drew into EACH panel -- a 2-entry legend per panel, not a
    # single line whose second series silently landed in the wrong panel.
    assert legend_entries(svg, "legend_1") == ["Signal (au)", "Reference (au)"]
    assert legend_entries(svg, "legend_2") == ["Signal (au)", "Reference (au)"]


# ---------------------------------------------------------------------------
# Fixture 5/9: "y2" -- Signal on the primary axis, Temp on a real
# ``twinx()`` secondary axis with its own explicit range/step/format and
# label, combined into ONE legend (primary series first, then y2's).
# ---------------------------------------------------------------------------


def _y2_payload() -> dict[str, Any]:
    return {
        "dataset": matrix_dataset(),
        "y_keys": [0, 8],
        "y2_keys": [8],
        "fmt": "svg",
        "y2_label": "Temperature (K)",
        "overrides": {"y2_lim": [270, 310]},
        "y2_step": 10.0,
        "y2_fmt": {"mode": "fixed", "digits": 0},
        "series_styles": [{"width": 2}, {"width": 1}],
    }


def test_y2_fixture_draws_a_real_secondary_axes_with_its_own_range() -> None:
    resp = client.post("/api/export/figure", json=_y2_payload())
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")

    assert re.findall(r'<g id="(axes_\d+)"', svg) == ["axes_1", "axes_2"]
    # ONE combined legend, primary series first, then the y2 series.
    assert legend_entries(svg) == ["Signal (au)", "Temp (K)"]
    # The explicit y2 axis label, present exactly once (not folded into the
    # legend's "Temp (K)", a different string).
    assert svg.count("Temperature") == 1
    # y2_lim=[270, 310] + y2_step=10 + digits=0 -> exactly these five ticks.
    for tick in ("270", "280", "290", "300", "310"):
        assert tick in svg
