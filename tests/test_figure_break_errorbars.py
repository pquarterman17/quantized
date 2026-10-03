"""Error bars on x-break panels (plot audit leftovers).

A broken x-axis exported with no error bars at all while the unbroken export of
the same view drew them (`calc.figure_errorbars`), so a PDF of a reflectivity
curve broken over a Q gap quietly dropped its uncertainty. Each panel now draws
the bars of the rows it shows, in the series' colour, with the unbroken plot's
log-axis floor rule for the shared y range.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import numpy as np
from matplotlib.collections import LineCollection
from matplotlib.container import ErrorbarContainer
from matplotlib.lines import Line2D

import quantized.calc.figure_break as fb
from quantized.calc.figure import render_figure

X = np.array([1.0, 2.0, 3.0, 10.0, 11.0, 12.0])
Y = np.array([2.0, 4.0, 6.0, 8.0, 10.0, 9.0])
DY = [0.5, 0.5, 1.0, 1.0, 5.0, 1.0]
DX = [0.1, 0.1, 0.1, 0.2, 0.2, 0.2]


def _render(y: np.ndarray, spans: list[Any], **kw: Any) -> Any:
    captured: dict[str, Any] = {}
    real = fb.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    with patch.object(fb, "savefig_bytes", grab):
        render_figure(
            X, [("R", y)], fmt="svg", overrides={"x_breaks": [[3.0, 10.0]]}, error_spans=spans,
            series_styles=[{"color": "#d62728"}], **kw,
        )
    return captured["fig"]


def _bar_segments(ax: Any) -> list[tuple[str, list[list[float]]]]:
    """(direction, [[x0, y0, x1, y1], ...]) for each bar collection on ``ax``."""
    out = []
    for c in ax.containers:
        if not isinstance(c, ErrorbarContainer):
            continue
        for col in c[2]:
            assert isinstance(col, LineCollection)
            segs = [np.asarray(s, dtype=float).ravel().round(6).tolist()
                    for s in col.get_segments()]
            out.append(("y" if segs and segs[0][0] == segs[0][2] else "x", segs))
    return out


def test_each_panel_draws_its_own_rows_bars() -> None:
    fig = _render(Y, [{"y": {"plus": DY, "minus": DY}, "x": {"plus": DX, "minus": DX}}])
    left, right = fig.axes
    bars_l = dict(_bar_segments(left))
    bars_r = dict(_bar_segments(right))
    assert bars_l["y"] == [[1, 1.5, 1, 2.5], [2, 3.5, 2, 4.5], [3, 5, 3, 7]]
    assert bars_r["y"] == [[10, 7, 10, 9], [11, 5, 11, 15], [12, 8, 12, 10]]
    assert bars_r["x"][0] == [9.8, 8, 10.2, 8]


def test_bars_take_the_series_colour() -> None:
    fig = _render(Y, [{"y": {"plus": DY, "minus": DY}}])
    for ax in fig.axes:
        (container,) = [c for c in ax.containers if isinstance(c, ErrorbarContainer)]
        line = next(a for a in ax.lines if isinstance(a, Line2D) and a.get_label() == "R")
        assert tuple(container[2][0].get_colors()[0][:3]) == tuple(
            int("d62728"[i : i + 2], 16) / 255 for i in (0, 2, 4)
        )
        assert line.get_color() == "#d62728"


def test_shared_y_covers_the_bars() -> None:
    fig = _render(Y, [{"y": {"plus": DY, "minus": DY}}])
    for ax in fig.axes:
        lo, hi = ax.get_ylim()
        assert hi >= 15  # 10 + 5 on the right panel reaches every panel's shared y


def test_log_y_bar_floor_does_not_stretch_the_axis() -> None:
    # 2 - 1.999 = 0.001 is more than two decades under the lowest point (2):
    # the bar runs to the floor instead of stretching the view (screen rule).
    dy = [1.999, 0.5, 1.0, 1.0, 5.0, 1.0]
    fig = _render(Y, [{"y": {"plus": dy, "minus": dy}}], y_log=True)
    for ax in fig.axes:
        assert ax.get_ylim()[0] >= 0.1


def test_no_spans_draws_no_bars() -> None:
    fig = _render(Y, None)  # type: ignore[arg-type]
    assert all(not _bar_segments(ax) for ax in fig.axes)
