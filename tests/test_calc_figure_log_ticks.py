"""Export log-axis tick LABELS match the screen's (``frontend/src/lib/logTicks.ts``).

The screen labels only the decade anchors on a view spanning at least a decade
(1, 10, 10^2, 10^-3) and falls back to ordinary numbers (0.8/0.9) on a
sub-decade view. The export used to null every minor label, so a zoomed
sub-decade log view exported with no y tick labels at all.
"""

from __future__ import annotations

from collections.abc import Iterator

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pytest

from quantized.calc.figure_scale import apply_axis_scale
from quantized.calc.figure_ticks import apply_tick_formats


@pytest.fixture
def ax() -> Iterator[plt.Axes]:
    fig, axes = plt.subplots()
    try:
        yield axes
    finally:
        plt.close(fig)


def _labels(ax: plt.Axes, lo: float, hi: float) -> list[str]:
    """Visible, non-blank y tick labels (major then minor) once drawn."""
    ax.figure.canvas.draw()
    out: list[str] = []
    for tick in [*ax.yaxis.get_major_ticks(), *ax.yaxis.get_minor_ticks()]:
        text = tick.label1.get_text()
        inside = lo * (1 - 1e-9) <= tick.get_loc() <= hi * (1 + 1e-9)
        if text and tick.label1.get_visible() and inside:
            out.append(text)
    return out


def _view(ax: plt.Axes, lo: float, hi: float) -> None:
    ax.plot([0, 1], [lo, hi])
    apply_axis_scale(ax, "y", "log")
    ax.set_ylim(lo, hi)


@pytest.mark.parametrize(
    ("lo", "hi", "expected"),
    [
        (0.8, 0.95, ["0.8", "0.9"]),
        (2.0, 8.0, ["2", "3", "4", "5", "6", "7", "8"]),
        (0.5, 3.0, ["1", "0.5", "0.6", "0.7", "0.8", "0.9", "2", "3"]),
    ],
)
def test_a_sub_decade_log_view_labels_every_tick(
    ax: plt.Axes, lo: float, hi: float, expected: list[str]
) -> None:
    _view(ax, lo, hi)
    assert _labels(ax, lo, hi) == expected


def test_a_multi_decade_log_view_labels_decades_only_as_the_screen_does(ax: plt.Axes) -> None:
    _view(ax, 1e-3, 100.0)
    assert _labels(ax, 1e-3, 100.0) == [
        r"$\mathdefault{10^{-3}}$",
        r"$\mathdefault{10^{-2}}$",
        r"$\mathdefault{10^{-1}}$",
        r"$\mathdefault{1}$",
        r"$\mathdefault{10}$",
        r"$\mathdefault{10^{2}}$",
    ]


def test_an_explicit_format_still_labels_a_sub_decade_log_view(ax: plt.Axes) -> None:
    _view(ax, 2.0, 8.0)
    apply_tick_formats(ax, None, {"mode": "fixed", "digits": 1})
    assert _labels(ax, 2.0, 8.0) == ["2.0", "3.0", "4.0", "5.0", "6.0", "7.0", "8.0"]


def test_an_explicit_format_keeps_decade_only_labels_on_a_multi_decade_view(ax: plt.Axes) -> None:
    _view(ax, 1e-2, 10.0)
    apply_tick_formats(ax, None, {"mode": "sci", "digits": 0})
    # Mantissa digits are the tick formatter's own business; only which ticks
    # carry text is pinned here.
    assert [float(t) for t in _labels(ax, 1e-2, 10.0)] == [1e-2, 1e-1, 1.0, 10.0]
