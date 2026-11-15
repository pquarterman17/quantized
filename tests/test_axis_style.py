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
    ({"kind": "reciprocal"}, (2, 10), ["0.50", "0.35", "0.25", "0.20", "0.15", "0.10"]),
    (
        {"kind": "dspacing", "wavelength": 1.5406},
        (20, 80),
        ["4.0", "3.0", "2.5", "2.0", "1.5"],
    ),
    (
        {"kind": "linear", "factor": 2, "shift": 1},
        (0, 10),
        ["2.5", "5.0", "7.5", "10.0", "12.5", "15.0", "17.5", "20.0"],
    ),
    ({"kind": "linear", "factor": -1}, (-5, 5), ["4", "2", "0", "-2", "-4"]),
    # the common magnetometry 1000/T axis: bunched nice ticks get finer ones, nicest first
    ({"kind": "reciprocal", "factor": 1000}, (10, 300), ["100", "30", "20", "15", "10", "5"]),
    # N8: arbitrary expressions of the bottom axis (same rows in axisTop.test.ts).
    ({"kind": "expr", "expr": "1240/x"}, (200, 800), ["6", "5", "4", "3", "2"]),
    (
        {"kind": "expr", "expr": "1/x"},
        (2, 10),
        ["0.50", "0.35", "0.25", "0.20", "0.15", "0.10"],
    ),
    ({"kind": "expr", "expr": "sqrt(x)"}, (1, 100), ["2", "4", "6", "8", "10"]),
    # a range through the pole: the end next to it is cut back to a 20x change
    ({"kind": "expr", "expr": "1240/x"}, (0, 20), ["1200", "400", "250", "200", "150", "100"]),
]


@pytest.mark.parametrize(("top", "rng", "labels"), TOP_TABLE)
def test_top_ticks_match_the_shared_table(
    top: dict[str, object], rng: tuple[float, float], labels: list[str]
) -> None:
    ticks = top_ticks(top, *rng)
    assert [label for _pos, _value, label in ticks] == labels
    for pos, value, _label in ticks:  # each tick sits where x maps to its value
        assert top_forward(top, pos) == pytest.approx(value)
        assert top_inverse(top, value, rng) == pytest.approx(pos)


def test_top_ticks_use_only_the_valid_part_of_a_range() -> None:
    # 1/x across 0: ticks come from the positive part only, never past it.
    ticks = top_ticks({"kind": "reciprocal", "factor": 1000}, 0, 10)
    assert ticks
    assert all(0 < pos <= 10 for pos, _v, _l in ticks)
    assert top_ticks({"kind": "reciprocal"}, -1, 1)
    assert all(pos > 0 for pos, _v, _l in top_ticks({"kind": "reciprocal"}, -1, 1))
    # d-spacing is only defined for 0 < 2theta < 180.
    d = top_ticks({"kind": "dspacing", "wavelength": 1.54}, -5, 30)
    assert d
    assert all(0 < pos <= 30 for pos, _v, _l in d)
    assert nice_ticks(1, 1) == ([], 0)


def test_top_ticks_draw_nothing_when_no_part_is_valid() -> None:
    assert top_ticks({"kind": "reciprocal"}, -10, -1) == []
    assert top_ticks({"kind": "reciprocal"}, -10, 0) == []
    assert top_ticks({"kind": "dspacing", "wavelength": 1.54}, -20, -1) == []


@pytest.mark.parametrize("rng", [(0, 10), (-5, 10), (-10, -1), (-10, 0)])
def test_reciprocal_top_axis_never_fails_the_render(rng: tuple[float, float]) -> None:
    lo, hi = rng
    render_figure_map(
        [lo, (lo + hi) / 2, hi],
        [("a", [1, 2, 3])],
        x_fmt={"mode": "auto", "digits": 2, "top": {"kind": "reciprocal", "factor": 1000}},
    )


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


def test_expr_top_axis_labels_in_the_export_match_the_screen_ticks() -> None:
    fig, ax = plt.subplots()
    ax.plot([200, 800], [0, 1])
    ax.set_xlim(200, 800)
    top = {"kind": "expr", "expr": "1240/x", "title": "E (eV)"}
    apply_axis_style(ax, "x", {"mode": "auto", "digits": 2, "top": top}, side="bottom")
    _drawn(ax)
    (sec,) = ax.child_axes
    shown = sorted(t.get_text() for t in sec.get_xticklabels() if t.get_text())
    assert shown == sorted(label for _p, _v, label in top_ticks(top, 200, 800))
    assert sec.get_xlabel() == "E (eV)"
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
    assert (
        TickFormatSpec(
            top={"kind": "expr", "expr": "1240/x"}  # type: ignore[arg-type]
        ).top.expr
        == "1240/x"
    )  # type: ignore[union-attr]
    assert out["grid"]["color"] == "#336699" and out["top"]["wavelength"] == 1.5406
    for fmt in ("pdf", "svg"):
        data = render_figure([20, 50, 80], [("I", [1, 3, 2])], fmt=fmt, x_fmt=out, y_fmt=out)
        assert len(data) > 1000
    with pytest.raises(ValueError):
        TickFormatSpec.model_validate({**raw, "grid": {"major": True, "color": "red"}})
    assert math.isfinite(top_forward(raw["top"], 30))


@pytest.mark.parametrize(
    "top",
    [{"kind": "reciprocal", "factor": 1000}, {"kind": "expr", "expr": "1000/x"}],
)
def test_one_over_t_keeps_a_useful_tick_count(top: dict[str, object]) -> None:
    ticks = top_ticks(top, 10, 300)
    assert len(ticks) >= 5
    fractions = [round((p - 10) / 290, 3) for p, _v, _l in ticks]
    at = {label: frac for frac, (_p, _v, label) in zip(fractions, ticks, strict=True)}
    # the pole end of an expr axis is cut back (20x rule), so its "100" tick is not drawn
    assert {"20": 0.138, "10": 0.31, "5": 0.655}.items() <= at.items()
    if top["kind"] == "reciprocal":
        assert at["100"] == 0.0


def test_top_ticks_keep_reciprocal_labels_apart() -> None:
    from quantized.calc.axis_top import TOP_MIN_GAP

    ticks = top_ticks({"kind": "reciprocal", "factor": 1000}, 10, 300)
    assert len(ticks) >= 2
    for a, b in zip(ticks, ticks[1:], strict=False):
        assert b[0] - a[0] >= 290 * TOP_MIN_GAP - 1e-6


@pytest.mark.parametrize(("top", "rng", "labels"), TOP_TABLE)
def test_top_label_gap_scales_with_label_width(
    top: dict[str, object], rng: tuple[float, float], labels: list[str]
) -> None:
    """Wide labels need a wider gap (shared rule with axisTop.ts), so the
    export's labels never touch: 1200/600/400 over 0-20 keeps only 1200, 400, 200."""
    from quantized.calc.axis_top import TOP_GAP_PER_CHAR, TOP_MIN_GAP

    ticks = top_ticks(top, *rng)
    span = rng[1] - rng[0]
    for a, b in zip(ticks, ticks[1:], strict=False):
        gap = max(TOP_MIN_GAP, TOP_GAP_PER_CHAR * (max(len(a[2]), len(b[2])) + 1))
        assert b[0] - a[0] >= span * gap - 1e-6


def test_expr_top_axis_labels_the_valid_side_of_a_pole() -> None:
    top = {"kind": "expr", "expr": "1240/x"}
    for lo, hi in [(-5, 5), (0, 10), (-1, 300)]:
        ticks = top_ticks(top, lo, hi)
        assert ticks, (lo, hi)
        assert all(pos > 0 and math.isfinite(v) and "nan" not in lbl for pos, v, lbl in ticks)
    assert top_ticks(top, -10, -1) != []  # the negative side is itself monotonic
    assert top_ticks({"kind": "expr", "expr": "sqrt(x)"}, -9, -1) == []  # nothing valid
    assert top_ticks({"kind": "expr", "expr": "x^2"}, -3, 3)  # turning point: one side
    assert all(pos >= 0 for pos, _v, _l in top_ticks({"kind": "expr", "expr": "x^2"}, -3, 3))
    assert top_ticks({"kind": "expr", "expr": "5"}, 0, 10) == []  # constant: not monotonic


def test_expr_is_parsed_without_eval() -> None:
    from quantized.calc.axis_expr import compile_expr, expr_problem

    assert compile_expr("-x^2")(3) == 9  # worksheet rule: ^ is looser than a unary sign
    assert compile_expr("-x**2")(3) == -9
    assert compile_expr("2*pi*x")(1) == pytest.approx(2 * math.pi)
    assert math.isnan(compile_expr("sqrt(x)")(-1))
    assert compile_expr("1/x")(0) == math.inf
    for bad in ("__import__('os')", "x.real", "open(x)", "x;1", "foo(x)", "", "1+", "(x"):
        assert expr_problem(bad) is not None, bad


@pytest.mark.parametrize("rng", [(0, 10), (-5, 10), (-10, -1), (-10, 0)])
@pytest.mark.parametrize("expr", ["1240/x", "sqrt(x)", "ln(x)", "nonsense("])
def test_expr_top_axis_never_fails_the_render(expr: str, rng: tuple[float, float]) -> None:
    lo, hi = rng
    render_figure_map(
        [lo, (lo + hi) / 2, hi],
        [("a", [1, 2, 3])],
        x_fmt={"mode": "auto", "digits": 2, "top": {"kind": "expr", "expr": expr}},
    )
