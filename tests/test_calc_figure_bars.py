"""Bars in the publication renderer (``SeriesStyle.bars``, an Origin column
graph): export must draw bars, like the interactive plot, never a line."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.container import BarContainer
from matplotlib.lines import Line2D

from quantized.calc.figure_bars import BAR_FRACTION, draw_series


def _ax() -> object:
    fig, ax = plt.subplots()
    return ax


def test_bars_style_draws_bars_from_zero_with_the_screen_width() -> None:
    ax = _ax()
    x = np.array([1.0, 2.0, 4.0, np.nan])
    y = np.array([3.0, -1.0, 2.0, 5.0])
    art, color = draw_series(ax, x, y, "Y", {"color": "#ff0000"}, {"bars": True})
    assert isinstance(art, BarContainer)
    assert len(art.patches) == 3  # the NaN-X row is not a bar
    widths = {round(p.get_width(), 9) for p in art.patches}
    assert widths == {round(1.0 * BAR_FRACTION, 9)}  # 60% of the smallest gap
    neg = art.patches[1]  # a negative bar hangs from 0
    assert (neg.get_y(), neg.get_height()) == (0.0, -1.0)
    assert matplotlib.colors.to_hex(color) == "#ff0000"
    assert not ax.lines


def test_without_bars_it_stays_the_ordinary_line() -> None:
    ax = _ax()
    art, color = draw_series(ax, np.arange(3.0), np.arange(3.0), "Y", {}, {"bars": False})
    assert isinstance(art, Line2D)
    assert color == art.get_color()
    art2, _ = draw_series(ax, np.arange(3.0), np.arange(3.0), "Y", {}, None)
    assert isinstance(art2, Line2D)


def test_a_single_bar_gets_a_unit_width() -> None:
    art, _ = draw_series(_ax(), np.array([5.0]), np.array([2.0]), "Y", {}, {"bars": True})
    assert art.patches[0].get_width() == 1.0
