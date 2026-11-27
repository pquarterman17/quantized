"""#1075: the canvas draws a point label at the export's size relative to its ticks.

The export's label is matplotlib "x-small" (0.69 of the tick size) and its offsets are points;
the canvas used one flat 11 px for ticks and labels. ``point_label_avoid_cluster.json``
``screen_vs_export`` is shared with ``frontend/src/lib/pointLabelMetrics.test.ts``, which scales
the same crowded run by the canvas px per pt and must land every label in the export's slot.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from matplotlib.font_manager import FontProperties

from quantized.calc import figure_point_label_place as place_mod
from quantized.calc.figure_point_labels import apply_point_labels
from quantized.calc.label_placement import PlaceItem, PlaceOpts, Rect, place_labels

FIX = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "point_label_avoid_cluster.json").read_text(
        encoding="utf-8"
    )
)["screen_vs_export"]
EXPORT = FIX["export_pt"]


def test_the_export_draws_labels_at_the_fixtures_size_and_offsets() -> None:
    """What the canvas mirrors is what the export really does (matplotlib and the module)."""
    label = FontProperties(size="x-small").get_size_in_points()
    tick = FontProperties(size="medium").get_size_in_points()
    assert tick == pytest.approx(EXPORT["tick"])
    assert label == pytest.approx(EXPORT["label"], abs=1e-3)
    assert label / tick == pytest.approx(0.694, abs=1e-4)
    assert (place_mod._GAP_PT, place_mod._PAD_PT, place_mod._MARKER_PT) == (
        EXPORT["gap"],
        EXPORT["pad"],
        EXPORT["marker"],
    )


def test_the_real_export_draws_a_non_avoid_label_at_x_small() -> None:
    fig = Figure()
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    line = ax.plot([0, 1], [0, 1])[0]
    pts = [{"x": 0.5, "y": 0.5, "text": "peak", "s": 0}]
    apply_point_labels(ax, {"point_labels": {"points": pts}}, [line])
    (ann,) = [t for t in ax.texts if t.get_text() == "peak"]
    assert ann.get_fontsize() == pytest.approx(EXPORT["label"], abs=1e-3)
    assert ann.xyann == (3, 3)  # the offset the canvas's default slot mirrors, in points


def test_the_crowded_run_is_placed_where_the_fixture_says() -> None:
    crowd: dict[str, Any] = FIX["crowd"]
    got = place_labels(
        [PlaceItem(**i) for i in crowd["items"]], Rect(**crowd["rect"]), PlaceOpts(**crowd["opts"])
    )
    assert any(g.leader for g in got)  # genuinely crowded: some labels moved off the default slot
    for g, want in zip(got, crowd["placed"], strict=True):
        assert g.left == pytest.approx(want["left"], abs=0.01)
        assert g.top == pytest.approx(want["top"], abs=0.01)
        assert g.overlap is want["overlap"]
        assert (g.leader is None) is (want["leader"] is None)


def test_the_fixtures_opts_are_the_exports_own_in_points() -> None:
    o = FIX["crowd"]["opts"]
    assert o["gap"] == EXPORT["gap"]
    assert o["pad"] == EXPORT["pad"]
    assert o["marker_r"] == EXPORT["marker"]
    assert o["step"] == pytest.approx(EXPORT["label"] * EXPORT["line_height"], abs=1e-3)
