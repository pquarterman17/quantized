"""The export autoscales and gaps a log axis as the screen does
(``calc.figure_autoscale``; screen: ``lib/logGaps.ts``, ``lib/uplotErrorRange.ts``,
uPlot's ``rangeLog``/``rangeNum``)."""

from __future__ import annotations

from collections.abc import Iterator

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pytest

from quantized.calc.figure import draw_series_axes
from quantized.calc.figure_autoscale import log_auto_range
from quantized.calc.figure_styles import figure_style

FigAx = tuple[plt.Figure, plt.Axes]


@pytest.fixture
def fig_ax() -> Iterator[FigAx]:
    fig, ax = plt.subplots()
    try:
        yield fig, ax
    finally:
        plt.close(fig)


def _draw(fig_ax: FigAx, x: list[float], y: list[float], **kw: object) -> plt.Axes:
    fig, ax = fig_ax
    xv = np.asarray(x, dtype=float)
    st = figure_style("default")
    draw_series_axes(fig, ax, xv, [("R", y)], st=st, ov={}, **kw)  # type: ignore[arg-type]
    return ax


def test_log_auto_range_is_uplots_rangelog() -> None:
    # uPlot: min down to a one-digit mantissa, max up to the next decade.
    assert log_auto_range(2.6e-7, 0.0218) == (2e-7, 0.1)
    assert log_auto_range(10.0, 13.0) == (10.0, 100.0)
    assert log_auto_range(0.5, 1.2) == (0.5, 10.0)
    assert log_auto_range(5.0, 5.0) == (0.5, 100.0)


def test_values_at_or_below_zero_break_a_log_line(fig_ax: FigAx) -> None:
    # Spin-flip PNR: R <= 0 where background subtraction overshoots. matplotlib
    # clipped them to the bottom edge, drawing a drop there.
    y = [1e-3, 2e-4, -1e-5, 0.0, 3e-5]
    ax = _draw(fig_ax, [1, 2, 3, 4, 5], y, y_scale="log")
    drawn = np.asarray(ax.lines[0].get_ydata(), dtype=float)
    assert np.isnan(drawn[2]) and np.isnan(drawn[3])
    assert drawn[[0, 1, 4]].tolist() == [1e-3, 2e-4, 3e-5]
    assert y == [1e-3, 2e-4, -1e-5, 0.0, 3e-5]  # the data are untouched
    assert ax.get_ylim() == pytest.approx((3e-5, 1e-3))  # uPlot's rangeLog of the rest


def test_a_linear_axis_keeps_its_values(fig_ax: FigAx) -> None:
    ax = _draw(fig_ax, [1, 2, 3], [1.0, -1.0, 2.0])
    assert ax.lines[0].get_ydata().tolist() == [1.0, -1.0, 2.0]


def test_log_error_bars_reach_two_decades_below_the_data(fig_ax: FigAx) -> None:
    # Low-count reflectivity: sR ~ R leaves a lower end of ~1e-15.
    spans = [{"y": {"plus": [0, 0, 0, 0], "minus": [10 - 1e-15, 0, 0, 0]}}]
    ax = _draw(fig_ax, [0, 1, 2, 3], [10.0, 11.0, 12.0, 13.0], y_scale="log",
               error_spans=spans)
    assert ax.get_ylim() == pytest.approx((10.0, 100.0))


def test_a_log_error_bar_within_two_decades_still_widens(fig_ax: FigAx) -> None:
    spans = [{"y": {"plus": [0, 0, 0, 0], "minus": [9.5, 0, 0, 0]}}]
    ax = _draw(fig_ax, [0, 1, 2, 3], [10.0, 11.0, 12.0, 13.0], y_scale="log",
               error_spans=spans)
    assert ax.get_ylim() == pytest.approx((0.5, 100.0))


def test_non_negative_counts_never_pad_below_zero(fig_ax: FigAx) -> None:
    # Zero-count XRD: matplotlib's 5% margin put the floor at -1e6.
    ax = _draw(fig_ax, [10, 20, 30, 40], [0.0, 5e6, 2e7, 1e6])
    lo, hi = ax.get_ylim()
    assert lo == 0.0 and hi > 2e7
    assert ax.get_xlim()[0] == pytest.approx(10 - 1.5)  # the x margin is untouched


def test_data_across_zero_keep_matplotlibs_margin(fig_ax: FigAx) -> None:
    ax = _draw(fig_ax, [0, 1, 2], [-1.0, 0.0, 1.0])
    assert ax.get_ylim() == pytest.approx((-1.1, 1.1))
