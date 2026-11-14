"""Open (hollow) symbols and error-bar styling in the export (gap audit 2 #6).

The canvas reads ``SeriesStyle.markerFill`` / ``SeriesStyle.errorBar``; the
request carries them as ``marker_fill`` and ``error_cap`` / ``error_width`` /
``error_color``. These pin that the renderer honours each one, and that an
unstyled series still draws exactly as before (``capsize=2``, ``elinewidth=1``,
the series colour, a filled marker).
"""

from __future__ import annotations

from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from quantized.calc.figure import _plot_kwargs  # noqa: E402
from quantized.calc.figure_colorscatter import draw_color_scatter  # noqa: E402
from quantized.calc.figure_errorbars import apply_error_bars, error_bar_style  # noqa: E402
from quantized.calc.figure_greyscale import apply_greyscale  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402


class FakeAxes:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def errorbar(self, x: Any, y: Any, **kw: Any) -> None:
        self.calls.append(kw)


class FakeArtist:
    def get_color(self) -> str:
        return "#abcdef"


X = np.array([1.0, 2.0, 3.0])
SERIES = [("A", [10.0, 20.0, 30.0])]
SPANS = [{"y": {"plus": [1, 1, 1], "minus": [1, 1, 1]}}]


def test_hollow_marker_has_no_face() -> None:
    kw = _plot_kwargs(1.0, 4.0, {"marker": True, "marker_fill": "hollow"})
    assert kw["markerfacecolor"] == "none"
    assert "markerfacecolor" not in _plot_kwargs(1.0, 4.0, {"marker": True, "marker_fill": "solid"})
    assert "markerfacecolor" not in _plot_kwargs(1.0, 4.0, {"marker": True})
    # No marker drawn: the key is meaningless and not sent to matplotlib.
    assert "markerfacecolor" not in _plot_kwargs(1.0, 4.0, {"marker_fill": "hollow"})


def test_hollow_marker_renders_open_in_matplotlib() -> None:
    fig, ax = plt.subplots()
    kw = _plot_kwargs(1.0, 4.0, {"marker": True, "marker_fill": "hollow", "color": "#ff0000"})
    (line,) = ax.plot(X, X, **kw)
    assert line.get_markerfacecolor() == "none"
    assert matplotlib.colors.to_hex(line.get_markeredgecolor()) == "#ff0000"
    plt.close(fig)


def test_unstyled_error_bars_keep_the_old_defaults() -> None:
    ax = FakeAxes()
    apply_error_bars(ax, X, SERIES, SPANS, [FakeArtist()])
    (call,) = ax.calls
    assert (call["capsize"], call["elinewidth"], call["ecolor"]) == (2.0, 1.0, "#abcdef")


def test_styled_error_bars_use_the_series_style() -> None:
    ax = FakeAxes()
    styles = [{"error_cap": 5, "error_width": 2.5, "error_color": "#112233"}]
    apply_error_bars(ax, X, SERIES, SPANS, [FakeArtist()], styles)
    (call,) = ax.calls
    assert (call["capsize"], call["elinewidth"], call["ecolor"]) == (5.0, 2.5, "#112233")


def test_cap_zero_means_no_caps() -> None:
    assert error_bar_style({"error_cap": 0})[0] == 0.0


@pytest.mark.parametrize(
    "bad",
    [
        {"error_cap": -1},
        {"error_cap": "x"},
        {"error_width": 0},
        {"error_width": True},
        {"error_color": 3},
        None,
    ],
)
def test_bad_error_style_degrades_to_defaults(bad: Any) -> None:
    assert error_bar_style(bad) == (2.0, 1.0, None)


def test_greyscale_drops_a_chromatic_error_colour() -> None:
    (spec,) = apply_greyscale([{"error_color": "#ff0000", "error_cap": 4}], 1)
    assert "error_color" not in spec
    assert spec["error_cap"] == 4


def test_hollow_colour_mapped_scatter_moves_the_colours_to_the_edges() -> None:
    fig, ax = plt.subplots()
    spec = {"color_by": [0.0, 5.0, 10.0], "marker_fill": "hollow"}
    sc = draw_color_scatter(fig, ax, X, X, "s", spec, figure_style("default"))
    fig.canvas.draw()
    assert len(sc.get_facecolors()) == 0
    edges = sc.get_edgecolors()
    assert len(edges) == 3 and not np.allclose(edges[0], edges[2])  # still colour-mapped
    plt.close(fig)
