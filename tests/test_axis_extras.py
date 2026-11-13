"""Figures-audit #6: the Axis dialog's extras reach the matplotlib export
(``calc.axis_extras`` via ``calc.figure_ticks.apply_tick_formats``)."""

from __future__ import annotations

import math

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import AutoMinorLocator, LogLocator  # noqa: E402

from quantized.calc.axis_extras import divide_offset_text  # noqa: E402
from quantized.calc.figure_ticks import apply_tick_formats  # noqa: E402
from quantized.routes.export_figures_schema import TickFormatSpec, _tick_fmt  # noqa: E402


def _drawn(ax: object) -> None:
    ax.figure.canvas.draw()  # type: ignore[attr-defined]


def test_divide_scales_labels_and_shows_the_factor() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 1, 2, 3], [0.000, 0.001, 0.002, 0.003])
    apply_tick_formats(ax, None, {"mode": "auto", "digits": 2, "divide": 1e-3})
    _drawn(ax)
    labels = [t.get_text() for t in ax.get_yticklabels() if t.get_text()]
    assert "1" in labels and "3" in labels
    assert ax.yaxis.get_offset_text().get_text() == "×10⁻³"
    plt.close(fig)


def test_minor_ticks_direction_and_font_size() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 10], [0, 1])
    fmt = {"mode": "auto", "digits": 2, "minor": 4, "ticks": "in", "size": 7}
    apply_tick_formats(ax, fmt, None)
    _drawn(ax)
    assert isinstance(ax.xaxis.get_minor_locator(), AutoMinorLocator)
    major = ax.xaxis.get_major_ticks()[0]
    assert major.tick1line.get_marker() == 2  # TICKUP: drawn inward on the bottom axis
    assert ax.get_xticklabels()[0].get_fontsize() == 7
    plt.close(fig)


def test_ln_scale_puts_majors_at_powers_of_e() -> None:
    fig, ax = plt.subplots()
    ax.set_yscale("log")
    ax.plot([0, 1], [1, math.e**4])
    apply_tick_formats(ax, None, {"mode": "auto", "digits": 2, "base": "e"})
    _drawn(ax)
    assert isinstance(ax.yaxis.get_major_locator(), LogLocator)
    labels = [t.get_text() for t in ax.get_yticklabels() if t.get_text()]
    assert "e²" in labels
    plt.close(fig)


def test_no_extras_changes_nothing() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 1], [0, 1])
    before = type(ax.yaxis.get_major_formatter())
    apply_tick_formats(ax, None, {"mode": "auto", "digits": 2})
    assert type(ax.yaxis.get_major_formatter()) is before
    plt.close(fig)


def test_offset_text_matches_the_screen_wording() -> None:
    assert divide_offset_text(1000) == "×10³"
    assert divide_offset_text(2.5) == "×2.5"


def test_wire_model_validates_and_forwards_the_extras() -> None:
    spec = TickFormatSpec.model_validate(
        {"mode": "auto", "digits": 2, "divide": 0.001, "minor": 3, "ticks": "both"}
    )
    out = _tick_fmt(spec)
    assert out is not None
    assert (out["divide"], out["minor"], out["ticks"]) == (0.001, 3, "both")
