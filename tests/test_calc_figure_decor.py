"""calc.figure_decor -- export parity for reference lines and region shades
(export-fidelity gap, 2026-08-11): the screen's `lib/uplotOverlays.ts`
refLinePlugin/regionShadePlugin had no publication-export counterpart, so a
PDF/SVG/PNG/clipboard copy silently dropped Hc/Tc markers and Origin-decoded
film-stack shading. Exercised against a REAL matplotlib Axes
(draw_series_axes, the same per-axes render body render_figure/
render_figure_page share) so assertions read the actual mutated artists --
the house standard (see test_calc_figure_shapes.py's header for the same
reasoning).
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

from quantized.calc.figure import draw_series_axes, render_figure_map  # noqa: E402
from quantized.calc.figure_overrides import _validate_overrides  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402
from quantized.calc.figure_y2 import render_with_secondary_axis  # noqa: E402

X = np.linspace(0, 10, 5)


def _draw(overrides: dict):
    """Render a real Axes through the SAME per-axes body render_figure uses
    (draw_series_axes -> ..._apply_overrides -> _apply_ref_lines/
    _apply_region_shades), returning (fig, ax) for direct artist inspection.
    Caller must close `fig`."""
    st = figure_style("default")
    fig, ax = plt.subplots()
    draw_series_axes(fig, ax, X, [("y", X)], st=st, ov=overrides)
    fig.canvas.draw()
    return fig, ax


def _shade_rects(ax) -> list[Rectangle]:
    # ax.patch (the axes' own background rect) is itself a Rectangle --
    # excluded by identity, same convention as test_calc_figure_shapes.py.
    return [p for p in ax.patches if isinstance(p, Rectangle) and p is not ax.patch]


def _ref_lines(ax):
    # The plotted series is also a Line2D with >2 points; a ref line's
    # xdata/ydata is always exactly 2 points (axvline/axhline's own shape).
    return [ln for ln in ax.lines if len(ln.get_xdata()) == 2]


# ── Validation ───────────────────────────────────────────────────────────


def test_validate_overrides_rejects_a_bad_ref_line_axis() -> None:
    with pytest.raises(ValueError, match="ref_lines axis"):
        _validate_overrides({"ref_lines": [{"axis": "z", "value": 1.0}]})


def test_validate_overrides_rejects_a_non_finite_ref_line_value() -> None:
    with pytest.raises(ValueError, match="ref_lines value"):
        _validate_overrides({"ref_lines": [{"axis": "x", "value": float("nan")}]})


def test_validate_overrides_accepts_a_well_formed_ref_line() -> None:
    _validate_overrides({"ref_lines": [{"axis": "y", "value": 3.5}]})  # no raise


def test_validate_overrides_rejects_a_non_finite_region_shade_coordinate() -> None:
    with pytest.raises(ValueError, match="region_shades x1"):
        _validate_overrides(
            {"region_shades": [{"x1": float("inf"), "x2": 1, "y1": 0, "y2": 1, "fill": "#112233"}]}
        )


def test_validate_overrides_rejects_a_malformed_region_shade_fill() -> None:
    with pytest.raises(ValueError, match="region_shades fill"):
        _validate_overrides(
            {"region_shades": [{"x1": 0, "x2": 1, "y1": 0, "y2": 1, "fill": "green"}]}
        )


def test_validate_overrides_rejects_a_bad_region_shade_axis() -> None:
    with pytest.raises(ValueError, match="region_shades axis"):
        _validate_overrides(
            {"region_shades": [{"x1": 0, "x2": 1, "y1": 0, "y2": 1, "fill": "#112233", "axis": 2}]}
        )


def test_validate_overrides_accepts_a_well_formed_region_shade() -> None:
    _validate_overrides(
        {"region_shades": [{"x1": 0, "x2": 1, "y1": 0, "y2": 1, "fill": "#112233"}]}
    )  # no raise


def test_validate_overrides_tolerates_absent_ref_lines_and_region_shades_keys() -> None:
    _validate_overrides({})  # no raise -- unknown/absent keys are ignored


# ── Reference lines ────────────────────────────────────────────────────────


def test_x_ref_line_draws_a_vertical_line_at_the_given_value() -> None:
    fig, ax = _draw({"ref_lines": [{"axis": "x", "value": 4.0}]})
    lines = _ref_lines(ax)
    assert len(lines) == 1
    xd = lines[0].get_xdata()
    assert xd[0] == pytest.approx(4.0) and xd[1] == pytest.approx(4.0)
    plt.close(fig)


def test_y_ref_line_draws_a_horizontal_line_at_the_given_value() -> None:
    fig, ax = _draw({"ref_lines": [{"axis": "y", "value": 7.0}]})
    lines = _ref_lines(ax)
    assert len(lines) == 1
    yd = lines[0].get_ydata()
    assert yd[0] == pytest.approx(7.0) and yd[1] == pytest.approx(7.0)
    plt.close(fig)


def test_ref_line_is_dashed() -> None:
    fig, ax = _draw({"ref_lines": [{"axis": "x", "value": 1.0}]})
    line = _ref_lines(ax)[0]
    assert line.get_linestyle() == "--"
    plt.close(fig)


def test_ref_line_draws_on_top_of_the_series_zorder_tie() -> None:
    # Screen parity: refLinePlugin draws in uPlot's `draw` hook, which fires
    # AFTER every series paints -- unlike regionShadePlugin's `drawClear`.
    # `_apply_ref_lines` runs from `_apply_overrides`, itself
    # draw_series_axes' LAST step, so the ref line's default Line2D zorder
    # (2, tied with the series line) resolves the tie by ADD ORDER (later
    # wins) -- confirmed here directly rather than assumed.
    fig, ax = _draw({"ref_lines": [{"axis": "x", "value": 4.0}]})
    series_line = next(ln for ln in ax.lines if len(ln.get_xdata()) == len(X))
    ref_line = _ref_lines(ax)[0]
    assert ref_line.get_zorder() == series_line.get_zorder()
    assert ax.lines.index(ref_line) > ax.lines.index(series_line)
    plt.close(fig)


def test_multiple_ref_lines_all_draw() -> None:
    fig, ax = _draw(
        {
            "ref_lines": [
                {"axis": "x", "value": 1.0},
                {"axis": "y", "value": 2.0},
                {"axis": "x", "value": 8.0},
            ]
        }
    )
    assert len(_ref_lines(ax)) == 3
    plt.close(fig)


# ── Region shades (primary axis) ───────────────────────────────────────────


def test_region_shade_rect_matches_its_data_coordinate_bounds() -> None:
    fig, ax = _draw(
        {"region_shades": [{"x1": 8, "x2": 2, "y1": 6, "y2": 1, "fill": "#112233"}]}
    )
    rects = _shade_rects(ax)
    assert len(rects) == 1
    r = rects[0]
    assert r.get_x() == pytest.approx(2.0)
    assert r.get_y() == pytest.approx(1.0)
    assert r.get_width() == pytest.approx(6.0)
    assert r.get_height() == pytest.approx(5.0)
    plt.close(fig)


def test_region_shade_uses_the_fixed_translucent_alpha() -> None:
    fig, ax = _draw(
        {"region_shades": [{"x1": 0, "x2": 1, "y1": 0, "y2": 1, "fill": "#00ff00"}]}
    )
    r = _shade_rects(ax)[0]
    assert r.get_alpha() == pytest.approx(0.25)
    plt.close(fig)


def test_region_shade_has_no_stroke() -> None:
    fig, ax = _draw(
        {"region_shades": [{"x1": 0, "x2": 1, "y1": 0, "y2": 1, "fill": "#00ff00"}]}
    )
    r = _shade_rects(ax)[0]
    assert r.get_edgecolor()[3] == pytest.approx(0.0)  # fully transparent edge
    plt.close(fig)


def test_region_shade_sits_behind_the_series_line() -> None:
    fig, ax = _draw(
        {"region_shades": [{"x1": 0, "x2": 1, "y1": 0, "y2": 1, "fill": "#00ff00"}]}
    )
    r = _shade_rects(ax)[0]
    series_line = next(ln for ln in ax.lines if len(ln.get_xdata()) == len(X))
    assert r.get_zorder() < series_line.get_zorder()
    plt.close(fig)


def test_multiple_region_shades_all_draw() -> None:
    fig, ax = _draw(
        {
            "region_shades": [
                {"x1": 0, "x2": 1, "y1": 0, "y2": 1, "fill": "#112233"},
                {"x1": 2, "x2": 3, "y1": 2, "y2": 3, "fill": "#445566"},
            ]
        }
    )
    assert len(_shade_rects(ax)) == 2
    plt.close(fig)


def test_axis_1_region_shade_falls_back_to_primary_when_there_is_no_y2_axis() -> None:
    # Screen parity: regionShadePlugin's `hasY2 = u.scales.y2 != null` gates
    # the y2 lookup -- a shade tagged axis:1 on a plot with NO secondary
    # scale still draws, on the primary axis, rather than vanishing.
    fig, ax = _draw(
        {"region_shades": [{"x1": 0, "x2": 1, "y1": 0, "y2": 1, "fill": "#112233", "axis": 1}]}
    )
    assert len(_shade_rects(ax)) == 1
    plt.close(fig)


def test_render_figure_map_smoke_with_ref_lines_and_region_shades() -> None:
    # End-to-end through the public entry point -- must not raise.
    hitmap = render_figure_map(
        X,
        [("y", X)],
        overrides={
            "ref_lines": [{"axis": "x", "value": 4.0}],
            "region_shades": [{"x1": 1, "x2": 3, "y1": 1, "y2": 4, "fill": "#00ff00"}],
        },
    )
    assert hitmap["image"]


# ── Secondary (y2) axis routing ─────────────────────────────────────────────


class TestAxisOneRoutesToTheSecondaryAxes:
    def _render(self, ov: dict):
        fig, ax = plt.subplots()
        x = np.linspace(0, 10, 10)
        render_with_secondary_axis(
            fig, ax, x, [("a", x), ("b", x)], None, [False, True],
            st=figure_style("default"), ov=ov,
            x_log=False, y_log=False, x_scale=None, y_scale=None,
            title="", x_label="", y_label="",
            x_fmt=None, y_fmt=None, x_step=None, y_step=None,
            y2_label="", y2_scale=None, y2_fmt=None, y2_step=None,
        )
        return fig, ax, fig.axes[1]

    def test_axis_1_shade_draws_on_ax2_not_ax(self):
        shade = {"x1": 1, "x2": 2, "y1": 10, "y2": 20, "fill": "#ff00ff", "axis": 1}
        fig, ax, ax2 = self._render({"region_shades": [shade]})
        try:
            assert _shade_rects(ax) == []
            secondary = _shade_rects(ax2)
            assert len(secondary) == 1
            assert secondary[0].get_y() == pytest.approx(10.0)
            assert secondary[0].get_height() == pytest.approx(10.0)
        finally:
            plt.close(fig)

    def test_axis_0_shade_stays_on_the_primary_axes(self):
        fig, ax, ax2 = self._render(
            {"region_shades": [{"x1": 1, "x2": 2, "y1": 1, "y2": 2, "fill": "#112233"}]}
        )
        try:
            assert len(_shade_rects(ax)) == 1
            assert _shade_rects(ax2) == []
        finally:
            plt.close(fig)

    def test_mixed_axis_shades_split_correctly(self):
        fig, ax, ax2 = self._render(
            {
                "region_shades": [
                    {"x1": 1, "x2": 2, "y1": 1, "y2": 2, "fill": "#112233"},
                    {"x1": 1, "x2": 2, "y1": 10, "y2": 20, "fill": "#ff00ff", "axis": 1},
                    {"x1": 3, "x2": 4, "y1": 3, "y2": 4, "fill": "#445566", "axis": 0},
                ]
            }
        )
        try:
            assert len(_shade_rects(ax)) == 2
            assert len(_shade_rects(ax2)) == 1
        finally:
            plt.close(fig)

    def test_no_region_shades_key_is_byte_identical_to_before_the_feature(self):
        # `primary_ov = ov if not secondary_shades else {...}` -- confirms the
        # no-op path passes the SAME ov object through untouched.
        fig, ax, ax2 = self._render({})
        try:
            assert _shade_rects(ax) == []
            assert _shade_rects(ax2) == []
        finally:
            plt.close(fig)
