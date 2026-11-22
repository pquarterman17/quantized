"""Stacking in the publication renderer (``SeriesStyle.stack``: stacked column /
bar / area), matching the interactive plot (frontend ``lib/uplotStack.ts``)."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np

from quantized.calc.figure import render_figure
from quantized.calc.figure_bars import draw_series, stacked_series
from quantized.calc.figure_orient import TransposedAxes


def test_stacked_series_sits_on_the_running_total() -> None:
    x = np.array([1.0, 2.0, 3.0])
    series = [
        ("A", np.array([1.0, 2.0, 3.0])),
        ("L", np.array([9.0, 9.0, 9.0])),
        ("B", np.array([np.nan, 1.0, 1.0])),
        ("C", np.array([1.0, 1.0, 1.0])),
    ]
    styles = [{"stack": True}, None, {"stack": True}, {"stack": True}]
    out, st = stacked_series(x, series, styles)
    assert out[0][1].tolist() == [1.0, 2.0, 3.0]  # first of the stack: its own values
    assert out[1][1].tolist() == [9.0, 9.0, 9.0]  # an unstacked series is untouched
    assert np.isnan(out[2][1][0]) and out[2][1][1:].tolist() == [3.0, 4.0]
    assert out[3][1].tolist() == [2.0, 4.0, 5.0]  # a missing value adds nothing
    assert st is not None and st[3]["stack_base"].tolist() == [1.0, 3.0, 4.0]
    same, same_st = stacked_series(x, series, [None] * 4)
    assert same is series and same_st == [None] * 4


def test_stacked_bars_start_at_the_total_below_and_horizontal_uses_left() -> None:
    x = np.array([1.0, 2.0])
    series = [("A", np.array([1.0, 2.0])), ("B", np.array([3.0, 1.0]))]
    out, st = stacked_series(x, series, [{"bars": True, "stack": True}] * 2)
    assert st is not None
    _, ax = plt.subplots()
    art, _ = draw_series(ax, x, np.asarray(out[1][1]), "B", {}, st[1])
    assert [(p.get_y(), p.get_height()) for p in art.patches] == [(1.0, 3.0), (2.0, 1.0)]
    assert ax.dataLim.y1 == 4.0  # the autoscale covers the total
    _, ax2 = plt.subplots()
    art2, _ = draw_series(TransposedAxes(ax2), x, np.asarray(out[1][1]), "B", {}, st[1])
    assert [(p.get_x(), p.get_width()) for p in art2.patches] == [(1.0, 3.0), (2.0, 1.0)]


def test_stacked_area_renders_through_the_figure_path() -> None:
    out = render_figure(
        [0.0, 1.0, 2.0],
        [("A", [1.0, 2.0, 1.0]), ("B", [1.0, 1.0, 1.0])],
        fmt="svg",
        series_styles=[{"fill": "under", "stack": True}] * 2,
    )
    assert isinstance(out, bytes) and b"<svg" in out
