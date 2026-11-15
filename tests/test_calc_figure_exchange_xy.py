"""Plot > Exchange X-Y axes on export (``overrides["exchange_xy"]``): the figure
turns on its side like the screen (``frontend/src/lib/exchangeXY.test.ts``
reads the same table, ``tests/fixtures/wire/exchange_xy.json``). X goes up the
left with its own title, scale, limits and direction; Y runs along the bottom."""

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
from quantized.calc.figure_styles import figure_style  # noqa: E402

CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "exchange_xy.json").read_text()
)["cases"]
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
        fig, ax, X, [("S", Y)], st=figure_style("default"), ov=ov,
        x_scale=case["x"]["scale"], y_scale=case["y"]["scale"],
        x_label=case["x"]["title"], y_label=case["y"]["title"],
    )
    return ax


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
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
    assert np.allclose(line.get_xdata(), Y)
    assert np.allclose(line.get_ydata(), X)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_without_exchange_the_figure_is_upright(case: dict[str, Any]) -> None:
    ax = _draw(case, exchange=False)
    assert ax.get_xlabel() == case["x"]["title"]
    assert ax.get_yscale() == case["y"]["scale"]
    assert np.allclose(ax.lines[0].get_xdata(), X)


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


def test_exchange_with_axis_breaks_fails_closed() -> None:
    with pytest.raises(ValueError, match="exchange_xy"):
        render_figure(X, [("S", Y)], overrides={"exchange_xy": True, "x_breaks": [[2.0, 50.0]]})


def test_exchange_must_be_boolean() -> None:
    with pytest.raises(ValueError, match="true or false"):
        render_figure(X, [("S", Y)], overrides={"exchange_xy": "yes"})


def test_exchange_with_a_secondary_axis_puts_it_along_the_top() -> None:
    svg_turned = render_figure(
        X, [("A", Y), ("B", Y * 2)], y2_mask=[False, True], fmt="svg",
        overrides={"exchange_xy": True},
    ).decode()
    svg_flat = render_figure(X, [("A", Y), ("B", Y * 2)], y2_mask=[False, True], fmt="svg").decode()
    assert svg_turned != svg_flat
