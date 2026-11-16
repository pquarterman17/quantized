"""The export's overlay autoscale rule (calc/figure_overlay_scale.py), the
mirror of ``frontend/src/lib/overlayAutoscale.ts``: an analysis overlay is
left out of the scan when a data series is drawn on the same axes, an overlay
alone still ranges them, and the Y-break sizing reads the same scan. The
screen == export pin is ``test_export_overlay_autoscale.py``."""

from __future__ import annotations

from typing import Any

import numpy as np
from matplotlib.figure import Figure

from quantized.calc.axis_breaks import _series_values
from quantized.calc.figure_autoscale import _values, shared_autoscale
from quantized.calc.figure_marks import draw_marked_series
from quantized.calc.figure_overlay_scale import (
    OVERLAY_STYLE_KEY,
    is_overlay,
    mark_overlay_styles,
)

X = np.array([1.0, 2.0, 3.0, 4.0])
DATA = np.array([60.0, 80.0, 95.0, 70.0])
DIVE = np.array([30.0, 10.0, -5.0, -20.0])
OVERLAY = {OVERLAY_STYLE_KEY: True}


def _axes(*series: tuple[np.ndarray, dict[str, object] | None]) -> Any:
    ax = Figure().subplots()
    for k, (y, spec) in enumerate(series):
        draw_marked_series(ax, X, y, f"s{k}", {"linewidth": 1.0}, spec)
    return ax


def test_mark_overlay_styles_marks_only_flagged_series() -> None:
    styles: list[dict[str, object] | None] = [{"color": "#111111"}, None, {"color": "#222222"}]
    assert mark_overlay_styles(styles, [False, False, False]) is styles
    assert mark_overlay_styles(styles, None) is styles
    out = mark_overlay_styles(styles, [False, True, True])
    assert out == [{"color": "#111111"}, OVERLAY, {"color": "#222222", **OVERLAY}]
    assert styles[2] == {"color": "#222222"}  # the input is not mutated


def test_the_drawn_overlay_artist_is_tagged() -> None:
    ax = _axes((DATA, {"color": "#111111"}), (DIVE, OVERLAY))
    assert [is_overlay(line) for line in ax.lines] == [False, True]


def test_an_overlay_beside_data_is_not_scanned_and_does_not_range() -> None:
    ax = _axes((DATA, None), (DIVE, OVERLAY))
    pts, _ends = _values([ax], 1, value_axis=True)
    assert sorted(pts.tolist()) == sorted(DATA.tolist())
    shared_autoscale(ax, "y", "linear")
    assert ax.get_ylim()[0] > DATA.min() - 10


def test_an_overlay_alone_on_its_axes_still_ranges_them() -> None:
    ax = _axes((DIVE, OVERLAY))
    pts, _ends = _values([ax], 1, value_axis=True)
    assert sorted(pts.tolist()) == sorted(DIVE.tolist())


def test_the_y_break_extent_leaves_the_overlay_out_too() -> None:
    ax = _axes((DATA, None), (DIVE, OVERLAY))
    pts = _series_values(ax)
    assert (float(pts.min()), float(pts.max())) == (60.0, 95.0)


def test_x_is_never_ruled_by_overlays() -> None:
    """The canvas rule is for Y scales; the X scan keeps every series."""
    ax = Figure().subplots()
    draw_marked_series(ax, X, DATA, "data", {"linewidth": 1.0}, None)
    draw_marked_series(ax, X + 10.0, DIVE, "fit", {"linewidth": 1.0}, OVERLAY)
    pts, _ends = _values([ax], 0)
    assert pts.max() == 14.0
    pts_y, _ = _values([ax], 1, value_axis=True)
    assert pts_y.min() == 60.0


def test_a_size_by_overlay_scatter_is_tagged_too() -> None:
    ax = Figure().subplots()
    draw_marked_series(ax, X, DATA, "data", {"linewidth": 1.0}, None)
    spec = {**OVERLAY, "marker": True, "size_by": [1.0, 2.0, 3.0, 4.0]}
    draw_marked_series(ax, X, DIVE, "peaks", {"linewidth": 1.0, "marker": "o"}, spec)
    assert ax.collections and all(is_overlay(c) for c in ax.collections)
    pts, _ends = _values([ax], 1, value_axis=True)
    assert pts.min() == 60.0
