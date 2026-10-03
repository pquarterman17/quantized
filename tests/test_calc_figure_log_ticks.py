"""Export log-axis ticks match the screen's (``frontend/src/lib/logTicks.ts``).

The screen labels only the decade anchors on a view spanning at least a decade
(1, 10, 10^2, 10^-3) and falls back to ordinary numbers on a sub-decade view,
whose ticks step arithmetically (``fixedLogAxisSplits``: 0.5/1/1.5, not
matplotlib's 0.5..0.9/1/2/3). The export used to null every minor label, so a
zoomed sub-decade log view exported with no y tick labels at all.
"""

from __future__ import annotations

from collections.abc import Iterator

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pytest

from quantized.calc.figure_scale import apply_axis_scale
from quantized.calc.figure_ticks import apply_tick_formats, apply_tick_steps


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
        (0.8, 0.95, ["0.8", "0.82", "0.84", "0.86", "0.88", "0.9", "0.92", "0.94"]),
        (2.0, 8.0, ["2", "3", "4", "5", "6", "7", "8"]),
        (0.5, 3.0, ["0.5", "1", "1.5", "2", "2.5", "3"]),
    ],
)
def test_a_sub_decade_log_view_labels_every_tick(
    ax: plt.Axes, lo: float, hi: float, expected: list[str]
) -> None:
    _view(ax, lo, hi)
    assert _labels(ax, lo, hi) == expected


def test_a_sub_decade_view_of_huge_values_reads_mantissa_times_ten_to_the_k(ax: plt.Axes) -> None:
    # The screen's 1.5x10^22 form (logTicks.ts scaledLabels), not 22 digits.
    _view(ax, 1.1e22, 4.5e22)
    # Stepped by 5e21; 4.5e22 sits under 30 px from 4e22, so it goes unlabelled.
    assert _labels(ax, 1.1e22, 4.5e22) == [
        rf"$\mathdefault{{{m}\times10^{{22}}}}$" for m in ("1.5", "2", "2.5", "3", "3.5", "4")
    ]


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


def _minors(ax: plt.Axes) -> list[float]:
    ax.figure.canvas.draw()
    return [float(v) for v in ax.yaxis.get_minorticklocs()]


def test_sci_and_eng_keep_one_digit_count_across_decades(ax: plt.Axes) -> None:
    # The increment floor once grew the mantissa a digit per decade
    # (1.0e-7 ... 1.000000e-1); every labelled mantissa here is 1.
    _view(ax, 1e-7, 1e-1)
    apply_tick_formats(ax, None, {"mode": "sci", "digits": 1})
    assert _labels(ax, 1e-7, 1e-1) == [f"1.0e-{k}" for k in range(7, 0, -1)]
    apply_tick_formats(ax, None, {"mode": "eng", "digits": 1})
    assert _labels(ax, 1e-7, 1e-1) == [
        "100.0e-9", "1.0e-6", "10.0e-6", "100.0e-6", "1.0e-3", "10.0e-3", "100.0e-3",
    ]


def test_crowded_decades_thin_their_labels_on_the_screen_stride(ax: plt.Axes) -> None:
    # 40 decades in ~355 px: every 4th decade (k % 4 == 0) keeps its label.
    _view(ax, 1e-30, 1e10)
    labels = _labels(ax, 1e-30, 1e10)
    assert labels[0] == r"$\mathdefault{10^{-28}}$"
    assert labels[-1] == r"$\mathdefault{10^{8}}$"
    assert len(labels) == 10


def test_minor_ticks_drop_past_six_decades_or_when_labels_thin(ax: plt.Axes) -> None:
    _view(ax, 1e-3, 1e2)
    assert len(_minors(ax)) == 40  # five roomy decades keep their 2-9s
    ax.set_ylim(1e15, 1e23)
    assert _minors(ax) == []  # a SIMS depth profile's eight decades
    ax.set_ylim(1e-3, 1e2)
    ax.figure.set_size_inches(6.4, 1.2)  # thinned labels on a short axis
    assert _minors(ax) == []


def test_a_crowded_sub_decade_view_keeps_labels_apart(ax: plt.Axes) -> None:
    ax.figure.set_size_inches(6.4, 2.5)
    _view(ax, 2e-7, 1.5e-6)
    labels = _labels(ax, 2e-7, 1.5e-6)
    assert len(labels) < len(ax.yaxis.get_majorticklocs())
    assert labels[0] == r"$\mathdefault{2\times10^{-7}}$"


def test_a_sub_decade_log_view_takes_the_origin_step(ax: plt.Axes) -> None:
    _view(ax, 0.9772, 1.2916)
    apply_tick_steps(ax, None, 0.05, "linear", "log")
    ax.figure.canvas.draw()
    assert [round(v, 6) for v in ax.yaxis.get_majorticklocs()] == [1.0, 1.05, 1.1, 1.15, 1.2, 1.25]
