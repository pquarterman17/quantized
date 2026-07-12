"""calc.figure_shapes (MAIN #27) -- export parity for drawn shapes
(arrow/line/rect/ellipse) + calc.figure_overrides' annotation `frame`
("text box"). Exercised against a REAL matplotlib Axes (draw_series_axes,
the same per-axes render body render_figure/render_figure_page share) so
assertions read the actual mutated artists (extent, alpha, xy) -- the house
standard (see test_calc_figure_overrides.py's header for the same
reasoning) -- plus one genuine rendered-PNG pixel-sample test for the
translucent-fill claim.
"""

from __future__ import annotations

from io import BytesIO

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pytest
from matplotlib.lines import Line2D
from matplotlib.patches import Ellipse, FancyArrowPatch, Rectangle
from PIL import Image

from quantized.calc.figure import draw_series_axes, render_figure, render_figure_map
from quantized.calc.figure_overrides import _validate_overrides
from quantized.calc.figure_styles import figure_style

X = np.linspace(0, 10, 5)


def _draw(overrides: dict):
    """Render a real Axes through the SAME per-axes body render_figure uses
    (draw_series_axes -> ..._apply_overrides -> _apply_shapes), returning
    (fig, ax) for direct artist inspection. Caller must close `fig`."""
    st = figure_style("default")
    fig, ax = plt.subplots()
    draw_series_axes(fig, ax, X, [("y", X)], st=st, ov=overrides)
    fig.canvas.draw()
    return fig, ax


def _shape_patches(ax, cls):
    # ax.patch (the axes' own background rect) is itself a Rectangle --
    # excluded by identity so it never masquerades as a drawn shape.
    return [p for p in ax.patches if isinstance(p, cls) and p is not ax.patch]


# ── Validation ───────────────────────────────────────────────────────────


def test_validate_overrides_rejects_an_unknown_shape_kind() -> None:
    with pytest.raises(ValueError, match="shape kind"):
        _validate_overrides({"shapes": [{"kind": "triangle", "x1": 0, "y1": 0, "x2": 1, "y2": 1}]})


def test_validate_overrides_rejects_a_non_numeric_coordinate() -> None:
    with pytest.raises(ValueError, match="shape x1"):
        _validate_overrides({"shapes": [{"kind": "line", "x1": "nope", "y1": 0, "x2": 1, "y2": 1}]})


def test_validate_overrides_accepts_a_well_formed_shape_list() -> None:
    # no raise
    _validate_overrides({"shapes": [{"kind": "arrow", "x1": 0, "y1": 0, "x2": 1, "y2": 1}]})


def test_validate_overrides_tolerates_absent_shapes_key() -> None:
    _validate_overrides({})  # no raise -- unknown/absent keys are ignored


# ── Arrow / line endpoints (data anchor, the default) ───────────────────


def test_arrow_bbox_spans_its_two_data_coordinate_endpoints() -> None:
    fig, ax = _draw({"shapes": [{"kind": "arrow", "x1": 1, "y1": 2, "x2": 4, "y2": 8}]})
    arrows = _shape_patches(ax, FancyArrowPatch)
    assert len(arrows) == 1
    bbox = arrows[0].get_window_extent(fig.canvas.get_renderer())
    p1_px = ax.transData.transform((1, 2))
    p2_px = ax.transData.transform((4, 8))
    lo = np.minimum(p1_px, p2_px)
    hi = np.maximum(p1_px, p2_px)
    # A little slack for the arrowhead's own overshoot past p2.
    assert bbox.x0 <= lo[0] + 2 and bbox.x1 >= hi[0] - 2
    assert bbox.y0 <= lo[1] + 2 and bbox.y1 >= hi[1] - 2
    plt.close(fig)


def test_line_endpoints_land_at_the_data_coordinates() -> None:
    fig, ax = _draw({"shapes": [{"kind": "line", "x1": 1, "y1": 2, "x2": 4, "y2": 8}]})
    # The series itself also draws a Line2D -- the shape's line is the one
    # whose xdata matches the SHAPE's endpoints, not the plotted series x.
    shape_line = next(ln for ln in ax.lines if list(ln.get_xdata()) == [1.0, 4.0])
    assert list(shape_line.get_ydata()) == [2.0, 8.0]
    assert isinstance(shape_line, Line2D)
    plt.close(fig)


def test_arrow_defaults_to_full_opacity_line_to_full_opacity() -> None:
    fig, ax = _draw({
        "shapes": [
            {"kind": "arrow", "x1": 0, "y1": 0, "x2": 1, "y2": 1},
            {"kind": "line", "x1": 0, "y1": 1, "x2": 1, "y2": 0},
        ]
    })
    assert _shape_patches(ax, FancyArrowPatch)[0].get_alpha() == pytest.approx(1.0)

    def _is_shape_line(ln: Line2D) -> bool:
        return list(ln.get_xdata()) == [0.0, 1.0] and list(ln.get_ydata()) == [1.0, 0.0]

    shape_line = next(ln for ln in ax.lines if _is_shape_line(ln))
    assert shape_line.get_alpha() == pytest.approx(1.0)
    plt.close(fig)


# ── Rect / ellipse geometry + translucent default opacity ───────────────


def test_rect_geometry_matches_its_data_coordinate_bounds() -> None:
    # Drawn "backwards" (x1 > x2, y1 > y2) -- Rectangle still normalizes to
    # the min corner + positive width/height, matching the screen's own
    # Math.min/max bbox convention (lib/uplotShapes.ts's drawOneShape).
    fig, ax = _draw({"shapes": [{"kind": "rect", "x1": 8, "y1": 6, "x2": 2, "y2": 1}]})
    rects = _shape_patches(ax, Rectangle)
    assert len(rects) == 1
    r = rects[0]
    assert r.get_x() == pytest.approx(2.0)
    assert r.get_y() == pytest.approx(1.0)
    assert r.get_width() == pytest.approx(6.0)
    assert r.get_height() == pytest.approx(5.0)
    plt.close(fig)


def test_rect_and_ellipse_default_to_35_percent_opacity() -> None:
    fig, ax = _draw({
        "shapes": [
            {"kind": "rect", "x1": 0, "y1": 0, "x2": 1, "y2": 1},
            {"kind": "ellipse", "x1": 2, "y1": 2, "x2": 3, "y2": 3},
        ]
    })
    assert _shape_patches(ax, Rectangle)[0].get_alpha() == pytest.approx(0.35)
    assert _shape_patches(ax, Ellipse)[0].get_alpha() == pytest.approx(0.35)
    plt.close(fig)


def test_ellipse_center_and_extents_match_its_bounding_box() -> None:
    fig, ax = _draw({"shapes": [{"kind": "ellipse", "x1": 2, "y1": 4, "x2": 6, "y2": 10}]})
    e = _shape_patches(ax, Ellipse)[0]
    assert e.center == pytest.approx((4.0, 7.0))
    assert e.width == pytest.approx(4.0)
    assert e.height == pytest.approx(6.0)
    plt.close(fig)


def test_explicit_opacity_overrides_the_kind_default() -> None:
    shape = {"kind": "rect", "x1": 0, "y1": 0, "x2": 1, "y2": 1, "opacity": 0.9}
    fig, ax = _draw({"shapes": [shape]})
    assert _shape_patches(ax, Rectangle)[0].get_alpha() == pytest.approx(0.9)
    plt.close(fig)


def test_fill_defaults_to_the_shapes_own_resolved_stroke() -> None:
    shape = {"kind": "rect", "x1": 0, "y1": 0, "x2": 1, "y2": 1, "stroke": "#123456"}
    fig, ax = _draw({"shapes": [shape]})
    r = _shape_patches(ax, Rectangle)[0]
    assert r.get_edgecolor()[:3] == pytest.approx(r.get_facecolor()[:3])
    plt.close(fig)


# ── Page anchor (figure-fraction, y-flipped) ─────────────────────────────


def test_page_anchored_line_uses_figure_fraction_coordinates() -> None:
    fig, ax = _draw({
        "shapes": [{"kind": "line", "x1": 0.1, "y1": 0.2, "x2": 0.9, "y2": 0.2, "anchor": "page"}],
    })
    shape_line = next(ln for ln in ax.lines if list(ln.get_xdata()) == [0.1, 0.9])
    assert shape_line.get_transform() == fig.transFigure
    plt.close(fig)


def test_page_anchor_y_is_flipped_relative_to_the_canvas_convention() -> None:
    # Same flip direction as the annotation page-anchor test
    # (test_calc_figure_overrides.py): a SMALL canvas-y (near the top, 0.05)
    # must land near the TOP of the figure (a LARGE matplotlib y, since
    # figure-fraction y grows upward); a LARGE canvas-y (0.95) near the
    # BOTTOM (a SMALL matplotlib y). Distinguished by xdata (not ydata,
    # which loses exact equality through the `1 - y` float subtraction).
    fig, ax = _draw({
        "shapes": [
            {"kind": "line", "x1": 0.0, "y1": 0.05, "x2": 0.1, "y2": 0.05, "anchor": "page"},
            {"kind": "line", "x1": 0.5, "y1": 0.95, "x2": 0.6, "y2": 0.95, "anchor": "page"},
        ],
    })
    near_top = next(ln for ln in ax.lines if ln.get_xdata()[0] == pytest.approx(0.5))
    near_bottom = next(ln for ln in ax.lines if ln.get_xdata()[0] == pytest.approx(0.0))
    assert near_top.get_ydata()[0] > near_bottom.get_ydata()[0]
    plt.close(fig)


# ── Annotation frame ("text box") ─────────────────────────────────────────


def test_framed_annotation_gets_a_bbox_patch_unframed_does_not() -> None:
    fig, ax = _draw({
        "annotations": [
            {"x": 1, "y": 1, "text": "framed", "frame": {"fill": "#ffffff", "stroke": "#000000"}},
            {"x": 2, "y": 2, "text": "plain"},
        ]
    })
    framed = next(t for t in ax.texts if t.get_text() == "framed")
    plain = next(t for t in ax.texts if t.get_text() == "plain")
    assert framed.get_bbox_patch() is not None
    assert plain.get_bbox_patch() is None
    plt.close(fig)


def test_framed_annotation_bbox_uses_the_given_colors_and_opacity() -> None:
    frame = {"fill": "#ff00ff", "stroke": "#00ffff", "opacity": 0.5}
    fig, ax = _draw({"annotations": [{"x": 1, "y": 1, "text": "framed", "frame": frame}]})
    framed = next(t for t in ax.texts if t.get_text() == "framed")
    bp = framed.get_bbox_patch()
    assert bp is not None
    assert bp.get_facecolor()[:3] == pytest.approx((1.0, 0.0, 1.0), abs=1e-2)
    assert bp.get_edgecolor()[:3] == pytest.approx((0.0, 1.0, 1.0), abs=1e-2)
    assert bp.get_alpha() == pytest.approx(0.5)
    plt.close(fig)


# ── Real-rendered pixel sample (translucent vs opaque) ────────────────────


def _center_pixel(hitmap: dict, x: float, y: float) -> tuple[int, int, int]:
    """Map a DATA coordinate to its image pixel via the hitmap's own axes
    bbox + xlim/ylim (the same linear-interpolation the client's own
    lib/previewmap.ts pxToData inverts) and sample it from the returned
    base64 PNG -- a genuine rendered-pixel check, not a property read.
    Computed as a FRACTION of `hitmap["width"/"height"]` (`fig.canvas`'s own
    reported size) then rescaled to the DECODED image's actual pixel
    dimensions, rather than assumed equal -- a stray global
    `rcParams["savefig.dpi"]` mutation elsewhere in the test session can
    make the saved PNG a different physical size than `fig.canvas` reports;
    the FRACTIONAL position stays correct either way."""
    import base64

    ax = hitmap["axes"]
    x0, x1 = ax["xlim"]
    y0, y1 = ax["ylim"]
    fx = (ax["x0"] + (x - x0) / (x1 - x0) * (ax["x1"] - ax["x0"])) / hitmap["width"]
    # Image y grows downward; ylim is bottom-to-top data order (y0=bottom).
    fy = (ax["y1"] - (y - y0) / (y1 - y0) * (ax["y1"] - ax["y0"])) / hitmap["height"]
    img = Image.open(BytesIO(base64.b64decode(hitmap["image"]))).convert("RGB")
    px = min(img.width - 1, max(0, int(fx * img.width)))
    py = min(img.height - 1, max(0, int(fy * img.height)))
    return img.getpixel((px, py))


def test_translucent_rect_pixel_is_visibly_blended_with_the_background() -> None:
    ov_common = {"x_lim": [0, 10], "y_lim": [0, 10]}
    rect = {"kind": "rect", "x1": 2, "y1": 2, "x2": 8, "y2": 8, "fill": "#00ff00"}

    def _render(opacity: float) -> dict:
        ov = {**ov_common, "shapes": [{**rect, "opacity": opacity}]}
        return render_figure_map(X, [("y", X)], overrides=ov)

    opaque = _render(1.0)
    translucent = _render(0.3)
    # Sampled OFF the plotted y=x series line (which also passes through
    # the rect) -- (3, 7) sits well inside the rect but away from the
    # diagonal, so the sample reads the rect's own fill, not the line's
    # antialiased stroke.
    opaque_px = _center_pixel(opaque, 3, 7)
    translucent_px = _center_pixel(translucent, 3, 7)
    # Opaque green sits alone; translucent blends with the white axes
    # background, so its red/blue channels must read visibly HIGHER (mixed
    # toward white) than the opaque sample's near-zero red/blue.
    assert translucent_px != opaque_px
    assert translucent_px[0] > opaque_px[0] + 20
    assert translucent_px[2] > opaque_px[2] + 20


def test_render_figure_with_shapes_and_a_framed_annotation_does_not_raise() -> None:
    # End-to-end smoke test through the real public entry point (not
    # draw_series_axes directly) -- every kind + both anchors + a frame,
    # together, on the SAME figure.
    overrides = {
        "shapes": [
            {"kind": "arrow", "x1": 1, "y1": 0, "x2": 4, "y2": 8, "stroke": "#ff0000", "width": 2},
            {"kind": "rect", "x1": 5, "y1": 1, "x2": 8, "y2": 5, "fill": "#00ff00", "opacity": 0.3},
            {"kind": "ellipse", "x1": 2, "y1": -1, "x2": 3, "y2": -3},
            {
                "kind": "line",
                "x1": 0.1,
                "y1": 0.9,
                "x2": 0.9,
                "y2": 0.9,
                "anchor": "page",
                "dash": True,
            },
        ],
        "annotations": [
            {
                "x": 5,
                "y": 9,
                "text": "Hc2",
                "frame": {"fill": "#ffffff", "stroke": "#000000", "opacity": 0.8, "pad": 6},
            },
        ],
    }
    data = render_figure(X, [("y", X)], overrides=overrides, fmt="png", dpi=80)
    assert len(data) > 0
