"""Gap audit 4 G17: log2 and probability scales, custom ticks and the axis
crossing reach the matplotlib export (``calc.axis_scales``,
``calc.axis_cross``), and agree with the canvas.

The agreement is pinned by ``tests/fixtures/wire/axis_scales.json``: this
module builds it from the REAL export (each ``export`` case renders through
``apply_axis_scale`` -> ``apply_tick_formats`` -> ``apply_axis_style`` and
reads back the drawn limits, ticks, labels and crossing), and
``frontend/src/lib/axisScalesFixture.test.ts`` asserts the canvas computes
the same from the same JSON. Regenerate (only when the contract is meant to
change) with::

    uv run python -c "import sys; sys.path.insert(0, 'tests'); \\
        import test_axis_scales as t; t.write_fixture()"
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402

from quantized.calc.axis_cross import cross_position  # noqa: E402
from quantized.calc.axis_scales import (  # noqa: E402
    custom_ticks_in,
    drawable_on,
    log2_label,
    log2_ticks,
    plain_label,
    prob_auto_range,
    prob_backward,
    prob_forward,
    prob_ticks,
)
from quantized.calc.axis_style import apply_axis_style  # noqa: E402
from quantized.calc.figure import render_figure  # noqa: E402
from quantized.calc.figure_scale import apply_axis_scale, drawable_lim  # noqa: E402
from quantized.calc.figure_ticks import apply_tick_formats  # noqa: E402
from quantized.routes.export_figures_schema import TickFormatSpec, _tick_fmt  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "axis_scales.json"
REGEN = "regenerate with tests/test_axis_scales.py's write_fixture() (module doc)"
AUTO: dict[str, Any] = {"mode": "auto", "digits": 2}


def _r(v: float) -> float | None:
    return float(f"{v:.10g}") if math.isfinite(v) else None


# Each export case: data drawn on ONE axes, the formats, an optional typed
# view for the axis under test, and which axis is read back.
EXPORT_CASES: list[dict[str, Any]] = [
    {
        "name": "probability (fraction): auto range out to standard majors",
        "x": [1, 2, 3, 4, 5],
        "y": [0.03, 0.2, 0.5, 0.8, 0.93],
        "y_fmt": {**AUTO, "prob": "fraction"},
        "axis": "y",
    },
    {
        "name": "probability (percent): out-of-domain points are not drawn and do not range",
        "x": [1, 2, 3, 4, 5, 6],
        "y": [-5, 0, 2, 45, 97, 100],
        "y_fmt": {**AUTO, "prob": "percent"},
        "axis": "y",
    },
    {
        "name": "probability on X, narrow typed view: even steps",
        "x": [0.41, 0.45, 0.47],
        "y": [1, 2, 3],
        "x_fmt": {**AUTO, "prob": "fraction"},
        "view": [0.42, 0.48],
        "axis": "x",
    },
    {
        "name": "log2 majors and labels",
        "x": [1, 2],
        "y": [0.3, 3000],
        "y_scale": "log",
        "y_fmt": {**AUTO, "base": "2"},
        "view": [0.25, 4096],
        "axis": "y",
    },
    {
        "name": "log2 over a wide view: every third power",
        "x": [1, 2],
        "y": [1e-6, 1e3],
        "y_scale": "log",
        "y_fmt": {**AUTO, "base": "2"},
        "view": [2**-20, 1024],
        "axis": "y",
    },
    {
        "name": "custom ticks with labels, one off the view",
        "x": [0, 10],
        "y": [0, 1],
        "x_fmt": {**AUTO, "custom": {"at": [0, 2.5, 7.5, 12], "labels": ["start", "", "late"]}},
        "view": [0, 10],
        "axis": "x",
    },
    {
        "name": "custom ticks on a log axis drop what it cannot draw",
        "x": [1, 2],
        "y": [1, 1000],
        "y_scale": "log",
        "y_fmt": {**AUTO, "custom": {"at": [-1, 0, 3, 30, 300], "labels": ["a", "b", "c", "", "e"]}},
        "view": [1, 1000],
        "axis": "y",
    },
    {
        "name": "Y crossing at X = 0 on an M-H loop",
        "x": [-5, -2, 0, 2, 5, 2, 0, -2, -5],
        "y": [-1, -0.9, -0.2, 0.8, 1, 0.9, 0.2, -0.8, -1],
        "y_fmt": {**AUTO, "cross": 0},
        "x_view": [-6, 6],
        "view": [-1.5, 1.5],
        "axis": "y",
    },
    {
        "name": "X crossing off the view clamps to the frame edge",
        "x": [0, 10],
        "y": [2, 8],
        "x_fmt": {**AUTO, "cross": -100},
        "y_view": [0, 10],
        "view": [0, 10],
        "axis": "x",
    },
    {
        "name": "Y crossing at 0 on a log X stays at the frame",
        "x": [1, 100],
        "y": [0, 1],
        "x_scale": "log",
        "y_fmt": {**AUTO, "cross": 0},
        "x_view": [1, 100],
        "view": [0, 1],
        "axis": "y",
    },
]


def _export_case(case: dict[str, Any]) -> dict[str, Any]:
    fig, ax = plt.subplots()
    ax.plot(case["x"], case["y"], marker="o")
    apply_axis_scale(ax, "x", case.get("x_scale", "linear"))
    apply_axis_scale(ax, "y", case.get("y_scale", "linear"))
    apply_tick_formats(ax, case.get("x_fmt"), case.get("y_fmt"))
    which = case["axis"]
    for key, other in (("view", which), ("x_view", "x"), ("y_view", "y")):
        lim = case.get(key)
        if lim is not None and (key == "view" or other != which):
            lo, hi = drawable_lim(ax, other, float(lim[0]), float(lim[1]))
            (ax.set_xlim if other == "x" else ax.set_ylim)(lo, hi)
    apply_axis_style(ax, "x", case.get("x_fmt"), side="bottom")
    apply_axis_style(ax, "y", case.get("y_fmt"), side="left")
    fig.canvas.draw()
    axis = ax.xaxis if which == "x" else ax.yaxis
    lo, hi = sorted(axis.get_view_interval())
    tol = (hi - lo) * 1e-9
    locs = [float(v) for v in axis.get_major_locator()() if lo - tol <= v <= hi + tol]
    labels = list(axis.get_major_formatter().format_ticks(locs))
    other = ax.yaxis if which == "x" else ax.xaxis
    fmt = case.get("x_fmt" if which == "x" else "y_fmt") or {}
    out: dict[str, Any] = {
        "lim": [_r(lo), _r(hi)],
        "ticks": [_r(v) for v in locs],
        "labels": labels,
    }
    if "cross" in fmt:
        from quantized.calc.axis_cross import cross_fraction

        out["crossFraction"] = _r(cross_fraction(other, float(fmt["cross"]), 0.0))
    plt.close(fig)
    return out


def _live_fixture() -> dict[str, Any]:
    probs = []
    for unit, data in (
        ("fraction", [0.03, 0.93]),
        ("fraction", [0.5, 0.5]),
        ("fraction", None),
        ("percent", [2, 97]),
        ("percent", [0.005, 99.995]),
    ):
        lo, hi = prob_auto_range(*(data or (None, None)), unit)
        samples = [lo, (lo + hi) / 2, hi, -1.0, 0.0, 100.0 if unit == "percent" else 1.0]
        probs.append({
            "unit": unit,
            "data": data,
            "autoRange": [_r(lo), _r(hi)],
            "ticks": [_r(v) for v in prob_ticks(lo, hi, unit)],
            "labels": [plain_label(v) for v in prob_ticks(lo, hi, unit)],
            "samples": [_r(v) for v in samples],
            "forward": [_r(prob_forward(v, unit)) for v in samples],
            "backward": [_r(prob_backward(prob_forward(v, unit), unit)) for v in samples[:3]],
        })
    log2 = []
    for view in ([0.25, 4096], [3, 5], [2**-20, 1024], [0.5, 0.5]):
        ticks = log2_ticks(*view)
        log2.append({"view": view, "ticks": ticks, "labels": [log2_label(v) for v in ticks]})
    custom = []
    for raw, scale, fmt, view in (
        ({"at": [3, 1, 2], "labels": ["c", "a"]}, "linear", AUTO, [0, 5]),
        ({"at": [0.5, 0, 1, 0.999]}, "linear", {**AUTO, "prob": "fraction"}, [0.001, 0.999]),
        ({"at": [-1, 10]}, "log", AUTO, [1, 100]),
    ):
        at, labels = custom_ticks_in(raw, view[0], view[1], lambda v, s=scale, f=fmt: drawable_on(v, s, f))
        custom.append({"custom": raw, "scale": scale, "fmt": fmt, "view": view, "at": at, "labels": labels})
    crosses = []
    for c, view, drawable in ((0, [-5, 5], True), (-9, [-5, 5], True), (9, [5, -5], True), (0, [1, 10], False)):
        crosses.append({"cross": c, "view": view, "drawable": drawable, "position": cross_position(c, *view, drawable)})
    return {
        "prob": probs,
        "log2": log2,
        "custom": custom,
        "cross": crosses,
        "export": [{**case, **_export_case(case)} for case in EXPORT_CASES],
    }


def write_fixture() -> None:
    """Regenerate the committed fixture (module doc)."""
    live = _live_fixture()
    lines = [f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'), ensure_ascii=False)}" for k, v in live.items()]
    FIXTURE.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")


def test_fixture_matches_the_live_export() -> None:
    assert FIXTURE.exists(), REGEN
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(_live_fixture(), ensure_ascii=False)), REGEN


def test_probability_axis_positions_by_the_normal_quantile() -> None:
    assert prob_forward(0.5, "fraction") == 0
    assert prob_forward(97.5, "percent") == pytest.approx(1.959963985, abs=1e-9)
    assert math.isnan(prob_forward(0, "fraction")) and math.isnan(prob_forward(100, "percent"))
    assert prob_backward(prob_forward(0.123, "fraction"), "fraction") == pytest.approx(0.123, rel=1e-12)


def test_probability_axis_refuses_typed_limits_off_its_domain() -> None:
    fig, ax = plt.subplots()
    ax.plot([1, 2, 3], [0.1, 0.5, 0.9])
    apply_tick_formats(ax, None, {**AUTO, "prob": "fraction"})
    # 0 and 1 cannot be drawn: each side is auto rather than a blank export.
    assert drawable_lim(ax, "y", 0.0, 1.0) == (None, None)
    assert drawable_lim(ax, "y", 0.2, 1.0) == (0.2, None)
    assert ax.get_ylim() == pytest.approx((0.1, 0.9))
    plt.close(fig)


def test_a_probability_axis_drops_its_break_and_minor_ticks() -> None:
    fig, ax = plt.subplots()
    ax.plot([1, 2, 3], [0.1, 0.5, 0.9])
    apply_tick_formats(ax, None, {**AUTO, "prob": "fraction", "minor": 4, "breaks": [[0.3, 0.4]]})
    fig.canvas.draw()
    assert ax.get_yscale() == "function"
    assert list(ax.yaxis.get_minorticklocs()) == []
    plt.close(fig)


def test_crossing_hides_the_frame_ticks_and_keeps_the_title_at_the_frame() -> None:
    fig, ax = plt.subplots()
    ax.plot([-5, 5], [-1, 1])
    ax.set_ylabel("M")
    fig.canvas.draw()
    before = ax.yaxis.label.get_window_extent().x0
    apply_axis_style(ax, "y", {**AUTO, "cross": 0}, side="left")
    fig.canvas.draw()
    assert ax.yaxis.label.get_window_extent().x0 == pytest.approx(before, abs=1)
    assert ax.get_yticklabels()[0].get_color() == (0.0, 0.0, 0.0, 0.0)
    assert ax.spines["left"].get_position() == "outward" or ax.spines["left"].get_visible()
    plt.close(fig)


def test_wire_model_carries_the_g17_fields() -> None:
    raw = {
        **AUTO,
        "base": "2",
        "prob": "percent",
        "custom": {"at": [1, 2], "labels": ["a", ""]},
        "cross": 0,
    }
    out = _tick_fmt(TickFormatSpec.model_validate(raw))
    assert out is not None
    assert out["base"] == "2" and out["prob"] == "percent" and out["cross"] == 0
    assert out["custom"] == {"at": [1.0, 2.0], "labels": ["a", ""]}
    with pytest.raises(ValueError):
        TickFormatSpec.model_validate({**raw, "prob": "odds"})
    with pytest.raises(ValueError):
        TickFormatSpec.model_validate({**raw, "custom": {"at": []}})


@pytest.mark.parametrize("fmt", ["pdf", "svg"])
def test_every_g17_field_renders(fmt: str) -> None:
    x_fmt = {**AUTO, "custom": {"at": [0, 1, 2], "labels": ["lo", "", "hi"]}, "cross": 0.5}
    y_fmt = {**AUTO, "prob": "fraction", "cross": 1}
    data = render_figure([0, 1, 2], [("p", [0.1, 0.5, 0.9])], fmt=fmt, x_fmt=x_fmt, y_fmt=y_fmt)
    assert len(data) > 1000
