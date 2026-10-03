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
import pytest

from quantized.calc.figure import render_figure, render_figure_map


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


def test_legend_axes_anchor_places_the_frame_anchored_legend_with_the_screen_y_flip() -> None:
    # decode #52: loc "axes" anchors the legend at a FRAME (== axes) fraction,
    # exact via ax.transAxes. The anchor is the box TOP-LEFT with fy measured
    # DOWN from the top (screen `legendFrameXY`), so the backend flips to
    # matplotlib's bottom-origin axes fraction: a SMALL fy must sit HIGH on the
    # page (small image-y), a large fy low; a small fx sits left.
    x = np.linspace(0, 10, 5)
    top_left = render_figure_map(
        x, [("a", x), ("b", 2 * x)],
        overrides={"legend": {"show": True, "loc": "axes", "anchor": [0.02, 0.02]}},
    )
    bottom_right = render_figure_map(
        x, [("a", x), ("b", 2 * x)],
        overrides={"legend": {"show": True, "loc": "axes", "anchor": [0.98, 0.98]}},
    )
    tl = _legend_box(top_left)
    br = _legend_box(bottom_right)
    assert tl is not None and br is not None
    assert tl["x0"] < br["x0"]  # fx 0.02 (left) vs 0.98 (right)
    assert tl["y0"] < br["y0"]  # fy 0.02 (top -> small image-y) vs 0.98 (bottom)


def test_legend_axes_anchor_with_a_title_forces_the_legend_on_for_a_single_series() -> None:
    # The NbAuRocking shape: one series, a frame anchor, and a bold title. The
    # title forces the legend on and loc "axes" places it (decode #52).
    x = np.linspace(0, 10, 5)
    framed = render_figure_map(
        x, [("Nb/Au", x)],
        overrides={"legend": {"loc": "axes", "anchor": [0.1, 0.1], "title": "Nb/Au"}},
    )
    assert _legend_box(framed) is not None


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


# ── Half-open limits (P2.8 residual (b)) ────────────────────────────────────
# A blank min/max field in the GUI is "auto for that side": the wire carries
# a null member, the typed side is honoured and matplotlib's own autoscale
# keeps the other. A typed side that would cross the auto side falls back to
# full autoscale, the canvas' rule (frontend `lib/canvasLims.ts`).


def _plotted_axes():  # type: ignore[no-untyped-def]
    from matplotlib.figure import Figure

    ax = Figure().add_subplot()
    ax.plot([0.0, 1.0, 2.0, 3.0], [10.0, 20.0, 30.0, 40.0])
    return ax


def _apply_lims(ax, ov: dict) -> None:  # type: ignore[no-untyped-def]
    from types import SimpleNamespace

    from quantized.calc.figure_overrides import apply_axis_shape_overrides

    st = SimpleNamespace(grid_alpha=None)
    apply_axis_shape_overrides(ax, st, ov, lim_keys=("x_lim", "y_lim"))


def test_half_open_lim_honours_the_typed_side_and_autoscales_the_other() -> None:
    ax = _plotted_axes()
    auto_lo = ax.get_ylim()[0]
    _apply_lims(ax, {"y_lim": [None, 25.0], "x_lim": [1.5, None]})
    assert ax.get_ylim() == (auto_lo, 25.0)
    assert ax.get_xlim()[0] == 1.5 and ax.get_xlim()[1] > 3.0


def test_half_open_lim_crossing_the_data_falls_back_to_full_autoscale() -> None:
    ax = _plotted_axes()
    auto = ax.get_ylim()
    _apply_lims(ax, {"y_lim": [50.0, None]})
    assert ax.get_ylim() == auto  # not an inverted (50, 41.5) axis


# ── A limit side <= 0 on a reciprocal axis ──────────────────────────────────
# matplotlib's FuncScale keeps a typed 0 (a log axis' set_ylim ignores it), and
# 1/x then maps every point to NaN: the export drew empty axes with no ticks.
# Such a side is auto, as on a log axis (frontend `lib/canvasLims.drawableLim`).

_RX = np.linspace(1.0, 10.0, 20)


def _recip_axes(**kw):  # type: ignore[no-untyped-def]
    return render_figure_map(_RX, [("y", _RX)], dpi=50, **kw)["axes"]


@pytest.mark.parametrize("lim", [[0, None], [-5.0, None], [None, 0], [0, 0]])
def test_reciprocal_y_lim_non_positive_side_is_auto_in_the_export(lim) -> None:  # type: ignore[no-untyped-def]
    auto = _recip_axes(y_scale="reciprocal")["ylim"]
    assert _recip_axes(y_scale="reciprocal", overrides={"y_lim": lim})["ylim"] == auto


def test_reciprocal_lim_keeps_its_positive_side_on_both_axes() -> None:
    axes = _recip_axes(
        x_scale="reciprocal", y_scale="reciprocal",
        overrides={"x_lim": [0, 20.0], "y_lim": [-5.0, 50.0]},
    )
    assert axes["xlim"][1] == 20.0 and axes["xlim"][0] > 0
    assert axes["ylim"][1] == 50.0 and axes["ylim"][0] > 0


def test_reciprocal_axis_with_a_zero_limit_still_has_ticks() -> None:
    from quantized.calc.figure_scale import apply_axis_scale

    ax = _plotted_axes()
    apply_axis_scale(ax, "y", "reciprocal")
    _apply_lims(ax, {"y_lim": [0.0, None]})
    assert ax.get_ylim()[0] > 0
    assert len(ax.yaxis.get_majorticklocs()) > 0


def test_reciprocal_y2_lim_non_positive_side_is_auto() -> None:
    def png(**ov):  # type: ignore[no-untyped-def]
        return render_figure(
            _RX, [("a", _RX), ("b", _RX)], fmt="png", dpi=50,
            y2_mask=[False, True], y2_scale="reciprocal", overrides=ov or None,
        )

    assert png(y2_lim=[0, None]) == png()


# ── x_reversed (IR wavenumber convention): the screen's reversed x axis ────


def test_x_reversed_inverts_the_x_axis_with_or_without_limits() -> None:
    ax = _plotted_axes()
    _apply_lims(ax, {"x_reversed": True})
    assert ax.xaxis_inverted()
    ax = _plotted_axes()
    _apply_lims(ax, {"x_reversed": True, "x_lim": [0.5, 2.5]})
    assert ax.get_xlim() == (2.5, 0.5)
    ax = _plotted_axes()
    _apply_lims(ax, {"x_reversed": False})
    assert not ax.xaxis_inverted()


def test_x_reversed_never_double_flips_a_descending_limit() -> None:
    ax = _plotted_axes()
    _apply_lims(ax, {"x_reversed": True, "x_lim": [2.5, 0.5]})
    assert ax.get_xlim() == (2.5, 0.5)


def test_x_reversed_reaches_a_rendered_figure() -> None:
    lo, hi = _recip_axes(overrides={"x_reversed": True})["xlim"]
    assert lo > hi
    lo, hi = _recip_axes()["xlim"]
    assert lo < hi
