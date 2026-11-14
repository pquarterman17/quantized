"""Gap-audit-2 #5: the Axis dialog's axis-look fields (reverse, grid style,
X label rotation, offset, top X axis) reach the matplotlib export
(``calc.axis_style``, ``calc.axis_top``), and the top axis picks the SAME
ticks and labels as the screen (``frontend/src/lib/axisTop.test.ts`` shares
``TOP_TABLE``)."""

from __future__ import annotations

import math

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402
from matplotlib.colors import to_hex  # noqa: E402

from quantized.calc.axis_style import apply_axis_style  # noqa: E402
from quantized.calc.axis_top import nice_ticks, top_forward, top_inverse, top_ticks  # noqa: E402
from quantized.calc.figure import render_figure, render_figure_map  # noqa: E402
from quantized.routes.export_figures_schema import TickFormatSpec, _tick_fmt  # noqa: E402

# (top spec, bottom-axis range) -> labels: the SAME rows as axisTop.test.ts.
TOP_TABLE = [
    ({"kind": "reciprocal", "factor": 1000}, (100, 300), ["10", "9", "8", "7", "6", "5", "4"]),
    (
        {"kind": "reciprocal"},
        (2, 10),
        ["0.50", "0.45", "0.40", "0.35", "0.30", "0.25", "0.20", "0.15", "0.10"],
    ),
    (
        {"kind": "dspacing", "wavelength": 1.5406},
        (20, 80),
        ["4.0", "3.5", "3.0", "2.5", "2.0", "1.5"],
    ),
    (
        {"kind": "linear", "factor": 2, "shift": 1},
        (0, 10),
        ["2.5", "5.0", "7.5", "10.0", "12.5", "15.0", "17.5", "20.0"],
    ),
    ({"kind": "linear", "factor": -1}, (-5, 5), ["4", "2", "0", "-2", "-4"]),
]


@pytest.mark.parametrize(("top", "rng", "labels"), TOP_TABLE)
def test_top_ticks_match_the_shared_table(
    top: dict[str, object], rng: tuple[float, float], labels: list[str]
) -> None:
    ticks = top_ticks(top, *rng)
    assert [label for _pos, _value, label in ticks] == labels
    for pos, value, _label in ticks:  # each tick sits where x maps to its value
        assert top_forward(top, pos) == pytest.approx(value)
        assert top_inverse(top, value) == pytest.approx(pos)


def test_top_ticks_refuse_a_reciprocal_axis_across_zero() -> None:
    assert top_ticks({"kind": "reciprocal"}, -1, 1) == []
    assert top_ticks({"kind": "dspacing", "wavelength": 1.54}, -5, 30) == []
    assert nice_ticks(1, 1) == ([], 0)


def _drawn(ax: object) -> None:
    ax.figure.canvas.draw()  # type: ignore[attr-defined]


def test_reverse_y_survives_the_whole_render() -> None:
    m = render_figure_map(
        [0, 1, 2], [("a", [0, 1, 4])], y_fmt={"mode": "auto", "digits": 2, "reverse": True}
    )
    lo, hi = m["axes"]["ylim"]
    assert lo > hi


def test_reverse_y2_reverses_only_the_secondary_axis() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 1], [0, 1])
    ax2 = ax.twinx()
    ax2.plot([0, 1], [5, 9])
    apply_axis_style(ax2, "y", {"mode": "auto", "digits": 2, "reverse": True}, side="right")
    assert ax2.yaxis_inverted() and not ax.yaxis_inverted()
    plt.close(fig)


def test_grid_style_replaces_the_plot_grid_for_one_axis() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 10], [0, 1])
    ax.grid(True)  # the plot-wide grid
    fmt = {
        "mode": "auto",
        "digits": 2,
        "grid": {"major": True, "minor": True, "color": "#ff0000", "dash": "dash"},
    }
    apply_axis_style(ax, "x", fmt, side="bottom")
    apply_axis_style(
        ax,
        "y",
        {"mode": "auto", "digits": 2, "grid": {"major": False, "minor": False}},
        side="left",
    )
    _drawn(ax)
    xs = [g for g in ax.get_xgridlines() if g.get_visible()]
    assert xs and all(to_hex(g.get_color()) == "#ff0000" and g.get_linestyle() == "--" for g in xs)
    minor = [t.gridline for t in ax.xaxis.get_minor_ticks() if t.gridline.get_visible()]
    assert minor, "a minor grid with no minor ticks asked for still draws midway lines"
    assert not any(g.get_visible() for g in ax.get_ygridlines())
    plt.close(fig)


def test_rotation_anchors_labels_at_their_end() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 100], [0, 1])
    apply_axis_style(ax, "x", {"mode": "auto", "digits": 2, "rotate": 45}, side="bottom")
    _drawn(ax)
    labels = ax.get_xticklabels()
    assert labels and all(
        t.get_rotation() == 45 and t.get_rotation_mode() == "xtick" for t in labels
    )
    plt.close(fig)


def test_offset_moves_the_spine_and_keeps_the_frame_line() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 1], [0, 1])
    n = len(ax.lines)
    apply_axis_style(ax, "y", {"mode": "auto", "digits": 2, "offset": 12}, side="left")
    assert ax.spines["left"].get_position() == ("outward", 12.0)
    assert len(ax.lines) == n + 1  # the frame edge the axis moved off
    plt.close(fig)


def test_top_axis_labels_in_the_export() -> None:
    fig, ax = plt.subplots()
    ax.plot([100, 300], [0, 1])
    ax.set_xlim(100, 300)
    top = {"kind": "reciprocal", "factor": 1000, "title": "1000/T (K⁻¹)"}
    apply_axis_style(ax, "x", {"mode": "auto", "digits": 2, "top": top}, side="bottom")
    _drawn(ax)
    (sec,) = ax.child_axes
    shown = [t.get_text() for t in sec.get_xticklabels() if t.get_text()]
    assert shown == [label for _p, _v, label in top_ticks(top, 100, 300)][::-1] or shown == [
        label for _p, _v, label in top_ticks(top, 100, 300)
    ]
    assert sec.get_xlabel() == "1000/T (K⁻¹)"
    plt.close(fig)


def test_wire_model_carries_the_look_fields_and_renders_vector() -> None:
    raw = {
        "mode": "auto",
        "digits": 2,
        "reverse": True,
        "rotate": -30,
        "offset": 6,
        "grid": {"major": True, "minor": False, "color": "#336699", "dash": "dot"},
        "top": {"kind": "dspacing", "wavelength": 1.5406, "title": "d (Å)"},
    }
    out = _tick_fmt(TickFormatSpec.model_validate(raw))
    assert out is not None
    assert out["reverse"] is True and out["rotate"] == -30 and out["offset"] == 6
    assert out["grid"]["color"] == "#336699" and out["top"]["wavelength"] == 1.5406
    for fmt in ("pdf", "svg"):
        data = render_figure([20, 50, 80], [("I", [1, 3, 2])], fmt=fmt, x_fmt=out, y_fmt=out)
        assert len(data) > 1000
    with pytest.raises(ValueError):
        TickFormatSpec.model_validate({**raw, "grid": {"major": True, "color": "red"}})
    assert math.isfinite(top_forward(raw["top"], 30))
