"""Horizontal bars on export (an Origin bar graph, ``bars: "horizontal"``):
the figure turns on its side like the screen (``frontend/src/lib/uplotOrient``)
— X up the left axis with its own title, limits and scale, the values along
the bottom, each bar running from zero along the value axis."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from matplotlib.colors import to_rgb  # noqa: E402
from matplotlib.container import BarContainer  # noqa: E402

from quantized.calc.figure import draw_series_axes  # noqa: E402
from quantized.calc.figure_bars import BAR_FRACTION  # noqa: E402
from quantized.calc.figure_orient import TransposedAxes, horizontal_bars  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

X = np.array([1.0, 2.0, 3.0])
Y = np.array([4.0, -1.0, 2.0])


def _draw(styles: list[dict[str, object] | None], **kw: object) -> tuple[object, list[object]]:
    fig, ax = plt.subplots()
    artists = draw_series_axes(
        fig, ax, X, [("B", Y)], st=figure_style("default"), ov={},
        x_label="A (s)", y_label="B (V)", series_styles=styles, **kw,  # type: ignore[arg-type]
    )
    return ax, artists


def test_horizontal_bars_run_along_the_bottom_with_x_up_the_side() -> None:
    ax, artists = _draw([{"bars": "horizontal"}], x_scale="log")
    bars = artists[0]
    assert isinstance(bars, BarContainer)
    # each bar: from zero along the horizontal axis, centred on its X vertically
    rects = [(p.get_x(), p.get_y() + p.get_height() / 2, p.get_width(), p.get_height())
             for p in bars.patches]  # fmt: skip
    expected = [(0.0, 1.0, 4.0, BAR_FRACTION), (0.0, 2.0, -1.0, BAR_FRACTION),
                (0.0, 3.0, 2.0, BAR_FRACTION)]  # fmt: skip
    assert [pytest.approx(r) for r in rects] == expected
    assert ax.get_ylabel() == "A (s)"  # X's title goes with X, up the side
    assert ax.get_xlabel() == "B (V)"
    assert ax.get_yscale() == "log" and ax.get_xscale() == "linear"


def test_column_bars_and_plain_series_stay_upright() -> None:
    for styles in ([{"bars": True}], [None], []):
        ax, _ = _draw(styles)
        assert ax.get_xlabel() == "A (s)"
        assert ax.get_ylabel() == "B (V)"


def test_the_proxy_swaps_axis_named_calls_and_coordinates() -> None:
    fig, ax = plt.subplots()
    t = TransposedAxes(ax)
    t.set_xlim(0, 10)
    assert ax.get_ylim() == (0.0, 10.0)
    assert t.xaxis is ax.yaxis and t.get_xlim() == ax.get_ylim()
    (line,) = t.plot([1, 2], [5, 6])
    assert list(line.get_xdata()) == [5, 6] and list(line.get_ydata()) == [1, 2]
    t.axvline(3)
    assert ax.lines[-1].get_ydata()[0] == 3  # an X marker is horizontal now
    t.tick_params(axis="x", labelsize=7)
    t.fill_between([1, 2], [5, 6], 0.0)
    eb = t.errorbar([1, 2], [5, 6], yerr=[0.5, 0.5])
    assert eb.has_xerr and not eb.has_yerr  # a Y error is horizontal now
    assert t.spines["bottom"] is ax.spines["left"]  # the X spine is on the left
    assert t.legend == ax.legend  # pass-through


def test_horizontal_is_any_series_like_the_screen() -> None:
    assert horizontal_bars([None, {"bars": "horizontal"}])
    assert not horizontal_bars([{"bars": True}, None])
    assert not horizontal_bars(None)


def test_a_colour_mapped_series_on_a_turned_plot_exports_turned() -> None:
    fig, ax = plt.subplots()
    styles = [{"bars": "horizontal"}, {"color_by": np.array([1.0, 2.0, 3.0])}]
    artists = draw_series_axes(
        fig, ax, X, [("B", Y), ("C", Y * 2)], st=figure_style("default"), ov={},
        series_styles=styles,
    )
    offsets = artists[1].get_offsets()
    assert [list(p) for p in offsets] == [[8.0, 1.0], [-2.0, 2.0], [4.0, 3.0]]  # (value, X)


def test_a_secondary_axis_on_a_turned_plot_runs_along_the_top() -> None:
    from quantized.calc.figure_y2 import render_with_secondary_axis

    fig, ax = plt.subplots()
    render_with_secondary_axis(
        fig, ax, X, [("B", Y), ("C", Y * 10)], [None, {"bars": "horizontal"}], [False, True],
        st=figure_style("default"), ov={}, x_label="A", y_label="B", y2_label="C",
        x_log=False, y_log=False, x_scale=None, y_scale=None, title="", x_fmt=None,
        y_fmt=None, x_step=None, y_step=None, y2_scale=None, y2_fmt=None, y2_step=None,
    )
    twin = [a for a in fig.axes if a is not ax][0]
    assert ax.get_ylabel() == "A" and ax.get_xlabel() == "B"  # primary turned too
    assert twin.get_xlabel() == "C"  # y2 title on the top axis
    assert twin.xaxis.get_label_position() == "top"
    (line,) = ax.lines
    assert list(line.get_ydata()) == list(X)  # the primary line runs up the side


# ── Decorations on a turned export (the screen's overlays, uplotOrient) ──────


def _turned(ov: dict[str, object]) -> tuple[object, object]:
    fig, ax = plt.subplots()
    draw_series_axes(
        fig, ax, X, [("B", Y)], st=figure_style("default"), ov=ov,
        series_styles=[{"bars": "horizontal"}],
    )
    fig.canvas.draw()
    return fig, ax


def test_reference_lines_turn_with_the_plot() -> None:
    _, ax = _turned({"ref_lines": [{"axis": "x", "value": 2.5}, {"axis": "y", "value": 3.0}]})
    lines = {ln.get_gid(): ln for ln in ax.lines if (ln.get_gid() or "").startswith("refline")}
    across = [ln for ln in lines.values() if list(ln.get_ydata()) == [2.5, 2.5]]
    up = [ln for ln in lines.values() if list(ln.get_xdata()) == [3.0, 3.0]]
    assert across and up  # an X line runs across at X = 2.5, a Y line up at 3


def test_a_stick_reference_and_its_label_turn_with_the_plot() -> None:
    stick = {"intensity": 0.5, "baseline": 0.1, "height": 0.3, "color": "#d97706",
             "visible": True, "show_label": True}  # fmt: skip
    _, ax = _turned({"ref_lines": [{"axis": "x", "value": 2.0, "label": "K", "stick": stick}]})
    (ln,) = [ln for ln in ax.lines if (ln.get_gid() or "").startswith("refline")]
    assert list(ln.get_ydata()) == [2.0, 2.0]  # horizontal at X = 2
    assert list(ln.get_xdata()) == pytest.approx([0.1, 0.25])  # its extent, axes fraction
    (label,) = [t for t in ax.texts if t.get_text() == "K"]
    assert label.get_position() == pytest.approx((0.25, 2.0))


def test_region_shades_turn_with_the_plot() -> None:
    _, ax = _turned({"region_shades": [
        {"x1": 1.5, "x2": 2.5, "y1": 0.0, "y2": 2.0, "fill": "#112233"},
    ]})  # fmt: skip
    fill = to_rgb("#112233")
    (shade,) = [p for p in ax.patches if to_rgb(p.get_facecolor()) == pytest.approx(fill)]
    (x0, y0), w, h = shade.get_xy(), shade.get_width(), shade.get_height()
    assert (x0, w) == pytest.approx((0.0, 2.0))  # its Y band along the bottom
    assert (y0, h) == pytest.approx((1.5, 1.0))  # its X band up the side


def test_annotations_turn_with_the_plot() -> None:
    _, ax = _turned({"annotations": [{"x": 2.0, "y": 4.0, "text": "pk"}]})
    (ann,) = [t for t in ax.texts if t.get_text() == "pk"]
    assert ann.xy == (4.0, 2.0)  # anchored at (value, X)
    (dot,) = [a for a in ax.lines if (a.get_gid() or "").startswith("annotation_dot")]
    assert [list(dot.get_xdata()), list(dot.get_ydata())] == [[4.0], [2.0]]
