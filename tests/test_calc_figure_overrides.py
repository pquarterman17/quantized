"""calc.figure_overrides — MAIN #18 export-parity additions: a per-annotation
`size` override (the pointer tool's corner-handle font-size resize) and the
legend's screen position (a `custom` loc + figure-fraction `anchor`, or a
forced show/hide independent of series count). Exercised through
render_figure_map's hitmap (pixel boxes), the same black-box surface
test_api_export.py's existing annotations-override test already uses --
_apply_overrides mutates a real matplotlib Axes, so asserting on ITS pixel
output is more honest than mocking the Axes.
"""

from __future__ import annotations

import numpy as np

from quantized.calc.figure import render_figure_map


def _ann_box(hitmap: dict, index: int = 0) -> dict:
    return next(e for e in hitmap["elements"] if e["id"] == f"ann:{index}")


def _legend_box(hitmap: dict) -> dict | None:
    return next((e for e in hitmap["elements"] if e["id"] == "legend"), None)


def test_annotation_size_override_increases_label_box_height() -> None:
    x = np.linspace(0, 10, 5)
    small = render_figure_map(
        x, [("y", x)], overrides={"annotations": [{"x": 2.0, "y": 4.0, "text": "pk", "size": 8}]},
    )
    big = render_figure_map(
        x, [("y", x)], overrides={"annotations": [{"x": 2.0, "y": 4.0, "text": "pk", "size": 40}]},
    )
    small_h = _ann_box(small)["y1"] - _ann_box(small)["y0"]
    big_h = _ann_box(big)["y1"] - _ann_box(big)["y0"]
    assert big_h > small_h


def test_annotation_without_size_falls_back_to_the_font_size_override() -> None:
    # No per-annotation `size` -> the property panel's global font_size
    # override still applies (the pre-#18 behaviour, unchanged).
    x = np.linspace(0, 10, 5)
    ann = [{"x": 2.0, "y": 4.0, "text": "pk"}]
    small = render_figure_map(x, [("y", x)], overrides={"font_size": 8, "annotations": ann})
    big = render_figure_map(x, [("y", x)], overrides={"font_size": 40, "annotations": ann})
    small_h = _ann_box(small)["y1"] - _ann_box(small)["y0"]
    big_h = _ann_box(big)["y1"] - _ann_box(big)["y0"]
    assert big_h > small_h


def test_legend_custom_anchor_moves_the_legend_box() -> None:
    x = np.linspace(0, 10, 5)
    top_left = render_figure_map(
        x, [("a", x), ("b", 2 * x)],
        overrides={"legend": {"show": True, "loc": "custom", "anchor": [0.05, 0.95]}},
    )
    bottom_right = render_figure_map(
        x, [("a", x), ("b", 2 * x)],
        overrides={"legend": {"show": True, "loc": "custom", "anchor": [0.95, 0.05]}},
    )
    tl = _legend_box(top_left)
    br = _legend_box(bottom_right)
    assert tl is not None and br is not None
    assert tl["x0"] < br["x0"]  # near the left edge vs near the right edge
    assert tl["y0"] < br["y0"]  # near the top (small image-y) vs near the bottom


def test_legend_show_override_forces_it_on_for_a_single_series() -> None:
    # figure.py's OWN default gate is `len(series) > 1` — an explicit
    # `show: true` override must win regardless (MAIN #18: matches the
    # screen, where showLegend has no series-count gate at all).
    x = np.linspace(0, 10, 5)
    default = render_figure_map(x, [("y", x)])
    forced = render_figure_map(x, [("y", x)], overrides={"legend": {"show": True}})
    assert _legend_box(default) is None
    assert _legend_box(forced) is not None


def test_legend_show_override_forces_it_off_for_multiple_series() -> None:
    x = np.linspace(0, 10, 5)
    default = render_figure_map(x, [("a", x), ("b", 2 * x)])
    hidden = render_figure_map(x, [("a", x), ("b", 2 * x)], overrides={"legend": {"show": False}})
    assert _legend_box(default) is not None
    assert _legend_box(hidden) is None
