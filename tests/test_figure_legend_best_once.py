"""Perf audit 2026-10-01: a ``loc="best"`` legend is scored once per layout.

matplotlib scores every candidate legend box against every plotted vertex
(9 boxes x every series, O(n) each) EACH time the legend is placed, and one
export placed it 5 times: ``tight_layout`` once, then ``savefig``'s layout and
draw passes four more times at the same layout. At 1M rows x 5 series that
was 9.5 s of a 10.2 s SVG render. The count of real scorings is the
load-invariant signal: it must not exceed the number of distinct layouts (2:
the ``tight_layout`` pass and the save pass), whatever the row count.
"""

from __future__ import annotations

from contextlib import nullcontext

import numpy as np
import pytest
from matplotlib.legend import Legend

from quantized.calc import figure_render
from quantized.calc.figure import render_figure
from quantized.calc.figure_render import new_figure, render_scope


def _count_scorings(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    calls: list[int] = []
    original = Legend._find_best_position

    def counting(self: Legend, *args: object, **kwargs: object) -> object:
        calls.append(1)
        return original(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Legend, "_find_best_position", counting)
    return calls


def _series(n: int) -> tuple[np.ndarray, list[tuple[str, np.ndarray]]]:
    x = np.arange(float(n))
    return x, [(f"s{i}", np.sin(x / 50.0 + i)) for i in range(3)]


@pytest.mark.parametrize("fmt", ["svg", "png"])
@pytest.mark.parametrize("n", [500, 5000])
def test_best_legend_scored_once_per_layout(
    monkeypatch: pytest.MonkeyPatch, fmt: str, n: int
) -> None:
    calls = _count_scorings(monkeypatch)
    x, series = _series(n)
    render_figure(x, series, fmt=fmt, style="default")
    # >= 1 keeps the test honest: the default style really does use "best".
    assert 1 <= len(calls) <= 2


def test_memo_does_not_change_the_png(monkeypatch: pytest.MonkeyPatch) -> None:
    x, series = _series(3000)
    memoized = render_figure(x, series, fmt="png")
    monkeypatch.setattr(figure_render, "memoize_best_legends", nullcontext)
    assert render_figure(x, series, fmt="png") == memoized


def test_changed_data_is_rescored() -> None:
    """The memo is keyed on the plotted display coordinates, so moving the
    data between two draws moves the legend, exactly as without the memo."""
    x = np.linspace(0.0, 1.0, 200)
    with render_scope():
        fig = new_figure(figsize=(4, 3))
        ax = fig.add_subplot()
        ax.set_xlim(0.0, 1.0)
        ax.set_ylim(0.0, 1.0)
        (line,) = ax.plot(x, np.full_like(x, 0.9), label="a")
        ax.plot(x, np.full_like(x, 0.9), label="b")
        leg = ax.legend(loc="best")
        fig.canvas.draw()
        top_data = leg.get_window_extent().bounds
        line.set_ydata(np.full_like(x, 0.1))
        ax.lines[1].set_ydata(np.full_like(x, 0.1))
        fig.canvas.draw()
        bottom_data = leg.get_window_extent().bounds
    # Data along the top pushes the legend down, and vice versa.
    assert bottom_data[1] > top_data[1]
