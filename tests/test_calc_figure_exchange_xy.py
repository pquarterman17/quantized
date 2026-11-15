"""Plot > Exchange X-Y axes on export (``overrides["exchange_xy"]``): the figure
turns on its side like the screen (``frontend/src/lib/exchangeXY.test.ts``
reads the same table, ``tests/fixtures/wire/exchange_xy.json``). X goes up the
left with its own title, scale, limits, direction and AUTOSCALED RANGE; Y runs
along the bottom. The data must land inside the exported axes."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from quantized.calc.figure import draw_series_axes, render_figure  # noqa: E402
from quantized.calc.figure_orient import validate_exchange  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "exchange_xy.json").read_text()
)
CASES = FIXTURE["cases"]
IDS = [c["name"] for c in CASES]
X = np.array([1.0, 10.0, 100.0])
Y = np.array([20.0, 300.0, 5000.0])


def _draw(case: dict[str, Any], *, exchange: bool) -> Any:
    ov: dict[str, Any] = {"exchange_xy": True} if exchange else {}
    if case["x"]["lim"]:
        ov["x_lim"] = case["x"]["lim"]
    if case["y"]["lim"]:
        ov["y_lim"] = case["y"]["lim"]
    if case["x"]["reversed"]:
        ov["x_reversed"] = True
    fig, ax = plt.subplots()
    draw_series_axes(
        fig, ax, np.array(case["data"]["x"], float), [("S", np.array(case["data"]["y"], float))],
        st=figure_style("default"), ov=ov,
        x_scale=case["x"]["scale"], y_scale=case["y"]["scale"],
        x_label=case["x"]["title"], y_label=case["y"]["title"],
    )
    return ax


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_exchange_keeps_each_quantity_with_its_axis(case: dict[str, Any]) -> None:
    ax = _draw(case, exchange=True)
    assert case["vertical"] == "x"
    # titles, scales and limits move with their quantity
    assert ax.get_ylabel() == case["x"]["title"]
    assert ax.get_xlabel() == case["y"]["title"]
    assert ax.get_yscale() == case["x"]["scale"]
    assert ax.get_xscale() == case["y"]["scale"]
    if case["x"]["lim"]:
        lo, hi = case["x"]["lim"]
        assert ax.get_ylim() == ((hi, lo) if case["x"]["reversed"] else (lo, hi))
    if case["y"]["lim"]:
        assert ax.get_xlim() == tuple(case["y"]["lim"])
    assert ax.yaxis_inverted() == case["x"]["reversed"]
    assert not ax.xaxis_inverted()
    # the data is drawn turned: X values vertical, Y values horizontal
    line = ax.lines[0]
    if case["y"]["scale"] != "log":  # (a log axis gaps its non-positive values)
        assert np.allclose(line.get_xdata(), case["data"]["y"], equal_nan=True)
    assert np.allclose(line.get_ydata(), case["data"]["x"], equal_nan=True)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_the_exchanged_autoscale_is_the_upright_one_swapped(case: dict[str, Any]) -> None:
    """The ranges the screen's rules give each quantity are the SAME turned: the
    vertical axis is the upright X range, the horizontal one the upright Y range."""
    up = _draw(case, exchange=False)
    turned = _draw(case, exchange=True)
    assert turned.get_ylim() == pytest.approx(up.get_xlim())
    assert turned.get_xlim() == pytest.approx(up.get_ylim())


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_the_data_lands_inside_the_exported_axes(case: dict[str, Any]) -> None:
    ax = _draw(case, exchange=True)
    xs, ys = np.array(case["data"]["x"], float), np.array(case["data"]["y"], float)
    (vlo, vhi), (hlo, hhi) = sorted(ax.get_ylim()), sorted(ax.get_xlim())
    if case["x"]["scale"] == "log":
        xs = xs[xs > 0]
    if case["y"]["scale"] == "log":
        ys = ys[ys > 0]
    if not case["x"]["lim"]:
        assert vlo <= xs.min() and xs.max() <= vhi
    if not case["y"]["lim"]:
        assert hlo <= ys.min() and ys.max() <= hhi


def test_a_log_axis_gaps_the_quantity_that_is_log_not_the_other() -> None:
    case = CASES[3]  # zero depth with linear X, zero counts with log Y
    line = _draw(case, exchange=True).lines[0]
    counts, depth = np.asarray(line.get_xdata(), float), np.asarray(line.get_ydata(), float)
    assert np.isnan(counts[0]) and np.isfinite(counts[1:]).all()  # the zero COUNTS gap
    assert np.isfinite(depth).all() and depth[0] == 0  # the zero DEPTH stays


def test_the_secondary_axis_ranges_over_its_own_data_along_the_top() -> None:
    xs = np.array([0.0, 5.0, 10.0])
    p, s = np.array([1.0, 2.0, 3.0]), np.array([100.0, 400.0, 900.0])
    from quantized.calc.figure_y2 import render_with_secondary_axis

    def axes_of(exchange: bool) -> list[Any]:
        fig, ax = plt.subplots()
        render_with_secondary_axis(
            fig, ax, xs, [("P", p), ("S", s)], None, [False, True],
            st=figure_style("default"), ov={"exchange_xy": True} if exchange else {},
            x_log=False, y_log=False, x_scale=None, y_scale=None,
            title="", x_label="T", y_label="P", x_fmt=None, y_fmt=None, x_step=None, y_step=None,
            y2_label="S", y2_scale="linear", y2_fmt=None, y2_step=None, error_spans=None,
            extra_y=(),
        )
        return list(fig.axes)

    up, turned = axes_of(False), axes_of(True)
    ax, ax2 = turned[0], turned[1]
    # primary: X up the side over its own range, P along the bottom
    assert ax.get_ylim() == pytest.approx(up[0].get_xlim())
    assert ax.get_xlim() == pytest.approx(up[0].get_ylim())
    # secondary: S along the TOP over ITS data (not clipped to X's range)
    assert ax2.xaxis.get_ticks_position() == "top"
    assert ax2.get_xlim() == pytest.approx(up[1].get_ylim())
    lo, hi = sorted(ax2.get_xlim())
    assert lo <= s.min() and s.max() <= hi


def _svg_text(svg: str) -> dict[str, tuple[float, float, float]]:
    """``{text: (rotation, x, y)}`` for every ``<text>`` in an SVG."""
    out: dict[str, tuple[float, float, float]] = {}
    pat = (
        r'<text[^>]* x="([\d.]+)" y="([\d.]+)"'
        r' transform="rotate\((-?[\d.]+)[^"]*"[^>]*>([^<]*)</text>'
    )
    for m in re.finditer(pat, svg):
        out[m.group(4)] = (float(m.group(3)), float(m.group(1)), float(m.group(2)))
    return out


def test_exchange_reaches_the_rendered_svg_axis_titles() -> None:
    """In the SVG the X title is the rotated one up the LEFT edge and the Y
    title runs along the BOTTOM (the Playwright check compares the screen)."""
    svg = render_figure(
        X, [("S", Y)], x_label="Depth", y_label="Counts", fmt="svg", overrides={"exchange_xy": True}
    ).decode()
    text = _svg_text(svg)
    depth, counts = text["Depth"], text["Counts"]
    assert depth[0] == -90 and counts[0] == 0
    ticks = [v for k, v in text.items() if k not in ("Depth", "Counts")]
    assert depth[1] < min(t[1] for t in ticks)  # left of every tick label
    assert counts[2] > max(t[2] for t in ticks)  # below every tick label
    upright = render_figure(X, [("S", Y)], x_label="Depth", y_label="Counts", fmt="svg").decode()
    flat = _svg_text(upright)
    assert flat["Depth"][0] == 0 and flat["Counts"][0] == -90


def test_exchange_is_not_applied_twice_with_horizontal_bars() -> None:
    fig, ax = plt.subplots()
    draw_series_axes(
        fig, ax, X, [("S", Y)], st=figure_style("default"), ov={"exchange_xy": True},
        x_label="A", y_label="B", series_styles=[{"bars": "horizontal"}],
    )
    assert ax.get_ylabel() == "A"
    assert ax.get_xlabel() == "B"


def test_lines_beside_horizontal_bars_autoscale_on_the_turned_axes_too() -> None:
    """The same unwrap serves a turned layer that is NOT exchange (bars + a line)."""
    fig, ax = plt.subplots()
    xs = np.array([0.0, 50.0, 100.0])
    draw_series_axes(
        fig, ax, xs,
        [("B", np.array([10.0, 20.0, 30.0])), ("L", np.array([1000.0, 1500.0, 2000.0]))],
        st=figure_style("default"), ov={}, series_styles=[{"bars": "horizontal"}, None],
    )
    assert ax.lines, "the line series is drawn"
    assert max(ax.get_xlim()) >= 2000  # horizontal axis = the line's Y values
    assert 100 <= max(ax.get_ylim()) <= 150  # vertical axis = X (0..100)


def test_exchange_with_axis_breaks_fails_closed() -> None:
    with pytest.raises(ValueError, match="exchange_xy"):
        render_figure(X, [("S", Y)], overrides={"exchange_xy": True, "x_breaks": [[2.0, 50.0]]})


def test_exchange_must_be_boolean() -> None:
    with pytest.raises(ValueError, match="true or false"):
        render_figure(X, [("S", Y)], overrides={"exchange_xy": "yes"})


_INSET = {"x": [1.0, 10.0], "y": [20.0, 300.0], "at": [0.5, 0.1, 0.3, 0.3]}


def _conflict_args(name: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """``(overrides, render kwargs)`` carrying the named conflict."""
    ov: dict[str, Any] = {"exchange_xy": True}
    kw: dict[str, Any] = {}
    if name == "inset":
        ov["inset"] = _INSET
    elif name == "y breaks":
        kw["y_fmt"] = {"breaks": [[30.0, 200.0]]}
    elif name == "y2 breaks":
        kw["y2_fmt"] = {"breaks": [[30.0, 200.0]]}
    elif name == "top x axis":
        kw["x_fmt"] = {"top": {"kind": "reciprocal", "factor": 1.0}}
    elif name == "y3+ axes":
        kw["extra_y"] = [{"mask": [False]}]
    elif name == "x breaks":
        ov["x_breaks"] = [[2.0, 50.0]]
    return ov, kw


@pytest.mark.parametrize("name", FIXTURE["conflicts"])
def test_every_conflict_is_refused_with_exchange(name: str) -> None:
    ov, kw = _conflict_args(name)
    with pytest.raises(ValueError, match="exchange_xy"):
        render_figure(X, [("S", Y)], overrides=ov, **kw)


@pytest.mark.parametrize("name", FIXTURE["conflicts"])
def test_the_same_settings_still_render_without_exchange(name: str) -> None:
    """The refusal is the exchange's, not the other feature's."""
    ov, kw = _conflict_args(name)
    ov.pop("exchange_xy")
    if name == "y3+ axes":
        pytest.skip("extra_y needs a real axis spec (covered by the multi-Y tests)")
    assert render_figure(X, [("S", Y)], overrides=ov, fmt="svg", **kw)


def test_validate_exchange_is_silent_when_not_exchanged() -> None:
    validate_exchange({"inset": _INSET}, x_fmt=None, y_fmt={"breaks": [[1, 2]]}, y2_fmt=None)
