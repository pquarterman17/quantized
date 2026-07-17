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


def test_legend_title_enlarges_the_legend_box() -> None:
    # decode #52: a legend TITLE (Origin's bold header) renders as a real
    # matplotlib legend title -> the legend's laid-out box grows taller to fit
    # the header row (asserted on the actual render's hitmap geometry).
    x = np.linspace(0, 10, 5)
    plain = render_figure_map(
        x, [("a", x), ("b", 2 * x)], overrides={"legend": {"show": True, "loc": "upper right"}}
    )
    titled = render_figure_map(
        x,
        [("a", x), ("b", 2 * x)],
        overrides={"legend": {"show": True, "loc": "upper right", "title": "Nb/Au"}},
    )
    lp, lt = _legend_box(plain), _legend_box(titled)
    assert lp is not None and lt is not None
    assert (lt["y1"] - lt["y0"]) > (lp["y1"] - lp["y0"])  # header row adds height


def test_legend_title_forces_the_legend_on_for_a_single_series() -> None:
    # A title is meaningless without a legend, so it forces the legend on even
    # for a single series (the header is the point) — decode #52.
    x = np.linspace(0, 10, 5)
    assert _legend_box(render_figure_map(x, [("y", x)])) is None
    titled = render_figure_map(x, [("y", x)], overrides={"legend": {"title": "S"}})
    assert _legend_box(titled) is not None


# MAIN #21 (page-anchored annotations): `anchor: "page"` renders an
# annotation's x/y as FIGURE-fraction placement (matplotlib's
# `xycoords="figure fraction"`) instead of axes-data coordinates, so the
# label stays pinned to the same spot on the page independent of the axes'
# data range -- the export-parity counterpart of the screen's canvas-
# fraction anchor (`lib/uplotOverlays.ts`'s `annotationLayout` page branch).


def _page_ann(x: np.ndarray, ann: dict) -> dict:
    return render_figure_map(x, [("y", x)], overrides={"annotations": [ann]})


def test_page_anchor_x_spreads_across_the_figure_unlike_data_coords() -> None:
    # As DATA coords, x=0.05 and x=0.95 both sit within a whisker of the
    # axes' left edge (the series spans x in [0, 10]) -- nearly identical
    # pixel positions. As PAGE (figure) fractions they must spread across
    # nearly the whole image width instead: this is the strongest signal
    # that the "page" branch is actually engaging `xycoords="figure
    # fraction"` rather than silently falling through to axes-data xy.
    x = np.linspace(0, 10, 5)
    left = _page_ann(x, {"x": 0.05, "y": 0.5, "text": "L", "anchor": "page"})
    right = _page_ann(x, {"x": 0.95, "y": 0.5, "text": "R", "anchor": "page"})
    left_box = _ann_box(left)
    right_box = _ann_box(right)
    spread = right_box["x0"] - left_box["x0"]
    assert spread > right["width"] * 0.5  # far more than a data-coord placement could produce


def test_page_anchor_y_is_flipped_relative_to_the_canvas_convention() -> None:
    # Canvas y (what the screen's page anchor stores) grows DOWNWARD; figure
    # fraction y grows UPWARD -- `_apply_overrides` must apply `1 - y`, not
    # `y` directly. A SMALL canvas-y (near the top of the page, y=0.05) must
    # render near the TOP of the image (a SMALL image y0, image rows count
    # from the top); a LARGE canvas-y (y=0.95, near the bottom) must render
    # near the BOTTOM (a LARGE image y0). Without the flip these would swap.
    x = np.linspace(0, 10, 5)
    near_top = _page_ann(x, {"x": 0.5, "y": 0.05, "text": "top", "anchor": "page"})
    near_bottom = _page_ann(x, {"x": 0.5, "y": 0.95, "text": "bot", "anchor": "page"})
    assert _ann_box(near_top)["y0"] < _ann_box(near_bottom)["y0"]


def test_page_anchor_annotation_still_honours_a_per_annotation_size() -> None:
    # The `size` override (MAIN #18) applies the same way regardless of
    # anchor -- page placement only changes WHERE the label sits, not the
    # font-size resolution.
    x = np.linspace(0, 10, 5)
    small = _page_ann(x, {"x": 0.5, "y": 0.5, "text": "pk", "anchor": "page", "size": 8})
    big = _page_ann(x, {"x": 0.5, "y": 0.5, "text": "pk", "anchor": "page", "size": 40})
    small_h = _ann_box(small)["y1"] - _ann_box(small)["y0"]
    big_h = _ann_box(big)["y1"] - _ann_box(big)["y0"]
    assert big_h > small_h


def test_annotation_without_anchor_still_uses_axes_data_coords() -> None:
    # Back-compat regression: an annotation with NO `anchor` key must render
    # identically to the pre-#21 behaviour (plain axes-data xy, no
    # xycoords). Compared against an explicit anchor:"page" at the SAME
    # nominal (x, y) to confirm the two genuinely diverge.
    x = np.linspace(0, 10, 5)
    data = _page_ann(x, {"x": 0.5, "y": 0.5, "text": "pk"})
    page = _page_ann(x, {"x": 0.5, "y": 0.5, "text": "pk", "anchor": "page"})
    assert _ann_box(data) != _ann_box(page)
