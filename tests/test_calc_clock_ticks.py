"""The ``clock`` tick mode on export (`calc.clock_ticks`): labels, the step
table, the locator, and the date-aware auto default -- mirrored by the
screen's `frontend/src/lib/clockTicks.ts` (`clockTicks.test.ts` asserts the
same labels)."""

from __future__ import annotations

import math

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402

from quantized.calc.axis_categories import x_axis_kind  # noqa: E402
from quantized.calc.axis_dates import date_aware_x_fmt  # noqa: E402
from quantized.calc.clock_ticks import ClockLocator, clock_label, clock_step  # noqa: E402
from quantized.calc.figure_ticks import apply_tick_formats, apply_tick_steps  # noqa: E402


@pytest.mark.parametrize(
    ("x", "step", "label"),
    [
        (45000.0, 3600.0, "12:30"),
        (45001.0, 1.0, "12:30:01"),
        (45001.25, 0.25, "12:30:01.25"),
        (45001.5, 0.5, "12:30:01.5"),
        (86400.0 + 1800.0, 1800.0, "00:30"),  # unwrapped past midnight: the clock wraps
        (86400.0, 86400.0, "1d 00:00"),  # a day apart: the day offset, never a date
        (3599.9999, 1.0, "01:00:00"),  # rounds into the next minute, never ":60"
        (90.0, 90.0, "00:01:30"),
        (-60.0, 60.0, "23:59"),
        (12.0, 0.0, "00:00:12"),
        (0.5, 1.0, "00:00:01"),  # half up, like the screen's Math.round
        (2.5, 1.0, "00:00:03"),
    ],
)
def test_clock_label(x: float, step: float, label: str) -> None:
    assert clock_label(x, step) == label


def test_clock_label_blank_for_non_finite() -> None:
    assert clock_label(math.nan, 60) == "" and clock_label(math.inf, 60) == ""


@pytest.mark.parametrize(
    ("min_step", "step"),
    [(0.3, 0.5), (7, 10), (11, 15), (4000, 7200), (50000, 86400), (90000, 172800),
     (3 * 86400, 5 * 86400), (0, 1.0), (math.nan, 1.0)],
)
def test_clock_step(min_step: float, step: float) -> None:
    assert clock_step(min_step) == step


def test_locator_ticks_at_whole_clock_increments() -> None:
    ticks = ClockLocator(nbins=7).tick_values(36000.0, 36000.0 + 8 * 3600.0)
    assert ticks[0] == 36000.0
    assert all(b - a == 7200.0 for a, b in zip(ticks, ticks[1:], strict=False))
    assert ClockLocator().tick_values(5.0, 5.0) == [5.0]


def test_export_axis_labels_a_clock_x_as_a_time_of_day() -> None:
    fig, ax = plt.subplots()
    try:
        ax.plot([82800.0, 90000.0], [0, 1])
        ax.set_xlim(82800.0, 90000.0)
        apply_tick_formats(ax, {"mode": "clock", "digits": 2}, None)
        fig.canvas.draw()
        labels = [t.get_text() for t in ax.get_xticklabels()]
    finally:
        plt.close(fig)
    assert labels[0] == "23:00" and "00:00" in labels and "1970" not in "".join(labels)


def test_a_typed_x_step_keeps_its_ticks_on_a_clock_axis() -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xlim(82800.0, 90000.0)
        apply_tick_steps(ax, 600.0, None, "linear", "linear")  # figure.py's order
        apply_tick_formats(ax, {"mode": "clock", "digits": 2}, None)
        assert not isinstance(ax.xaxis.get_major_locator(), ClockLocator)
        fig.canvas.draw()
        labels = [t.get_text() for t in ax.get_xticklabels()]
    finally:
        plt.close(fig)
    assert {"23:00", "23:10", "23:20"} <= set(labels)  # 10-minute ticks, as typed


def test_auto_on_a_clock_x_draws_clock() -> None:
    meta = {"time_is_clock": True}
    assert x_axis_kind(meta, None).is_clock and not x_axis_kind(meta, 0).is_clock
    assert not x_axis_kind({}, None).is_clock
    assert date_aware_x_fmt(None, False, True) == {"digits": 2, "mode": "clock"}
    fixed = date_aware_x_fmt({"mode": "fixed", "digits": 1}, False, True)
    assert fixed is not None and fixed["mode"] == "fixed"
    assert date_aware_x_fmt(None, True, False) == {"digits": 2, "mode": "datetime"}
    assert date_aware_x_fmt(None, False) is None
