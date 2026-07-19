"""Unit tests for calc.figure_ticks: matplotlib tick-label formatting for
publication export (MAIN #24), mirroring the screen's `AxisFormat` contract
(`frontend/src/lib/uplotOpts.ts`'s `tickFormatter` + `frontend/src/lib/
ticks.ts`'s `decimalsForIncrement`/`stripNegZero`/`formatEng`).

The "duplicate-run regression shape", -0 absence, and eng-mode cases below
are ported 1:1 from `frontend/src/lib/uplotOpts.test.ts`'s
"increment-aware precision floor (MAIN #20)" describe block -- same input
splits, same expected output strings -- to prove the export side matches the
screen side, not just internal self-consistency.
"""

from __future__ import annotations

from datetime import UTC, datetime

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402
from matplotlib.ticker import LogLocator, MultipleLocator  # noqa: E402

from quantized.calc.figure_ticks import (  # noqa: E402
    _decimals_for_increment,
    _format_eng,
    _format_fixed,
    _format_sci,
    _mantissa_decimal_floor,
    _strip_neg_zero,
    _to_exponential,
    apply_tick_formats,
    apply_tick_steps,
    axis_tick_formatter,
)


def test_apply_tick_steps_uses_decoded_intervals_on_linear_axes() -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xlim(-7000.0, 7000.0)
        ax.set_ylim(-1.0, 1.0)
        apply_tick_steps(ax, 2000.0, 0.5, "linear", "linear")
        assert isinstance(ax.xaxis.get_major_locator(), MultipleLocator)
        assert isinstance(ax.yaxis.get_major_locator(), MultipleLocator)
        x_ticks = ax.xaxis.get_majorticklocs()
        y_ticks = ax.yaxis.get_majorticklocs()
        assert [v for v in x_ticks if -7000.0 <= v <= 7000.0] == [
            -6000.0, -4000.0, -2000.0, 0.0, 2000.0, 4000.0, 6000.0,
        ]
        assert [v for v in y_ticks if -1.0 <= v <= 1.0] == [
            -1.0, -0.5, 0.0, 0.5, 1.0,
        ]
    finally:
        plt.close(fig)


def test_apply_tick_steps_fails_closed_for_non_linear_or_invalid_steps() -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xscale("log")
        log_locator = ax.xaxis.get_major_locator()
        y_locator = ax.yaxis.get_major_locator()
        apply_tick_steps(ax, 2.0, -1.0, "log", "linear")
        assert ax.xaxis.get_major_locator() is log_locator
        assert isinstance(log_locator, LogLocator)
        assert ax.yaxis.get_major_locator() is y_locator
    finally:
        plt.close(fig)


def test_apply_tick_steps_fails_closed_for_implausibly_dense_steps() -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xlim(0.0, 1.0)
        locator = ax.xaxis.get_major_locator()
        apply_tick_steps(ax, 0.000_001, None, "linear", "linear")
        assert ax.xaxis.get_major_locator() is locator
    finally:
        plt.close(fig)


# ── axis_tick_formatter / apply_tick_formats (dispatch) ─────────────────────
def test_axis_tick_formatter_none_for_missing_or_auto() -> None:
    assert axis_tick_formatter(None) is None
    assert axis_tick_formatter({}) is None
    assert axis_tick_formatter({"mode": "auto", "digits": 2}) is None


def test_axis_tick_formatter_none_for_unknown_mode() -> None:
    assert axis_tick_formatter({"mode": "bogus", "digits": 2}) is None


def test_axis_tick_formatter_builds_for_fixed_sci_eng() -> None:
    for mode in ("fixed", "sci", "eng"):
        f = axis_tick_formatter({"mode": mode, "digits": 2})
        assert f is not None


def test_apply_tick_formats_auto_leaves_default_formatter() -> None:
    fig, ax = plt.subplots()
    try:
        default_formatter = ax.xaxis.get_major_formatter()
        apply_tick_formats(ax, {"mode": "auto", "digits": 2}, None)
        assert ax.xaxis.get_major_formatter() is default_formatter
    finally:
        plt.close(fig)


def test_apply_tick_formats_sets_x_and_y_independently() -> None:
    fig, ax = plt.subplots()
    try:
        apply_tick_formats(ax, {"mode": "fixed", "digits": 3}, {"mode": "sci", "digits": 1})
        ax.set_xticks([1.0, 2.0])
        ax.set_yticks([1000.0])
        fig.canvas.draw()
        assert [t.get_text() for t in ax.get_xticklabels()] == ["1.000", "2.000"]
        assert [t.get_text() for t in ax.get_yticklabels()] == ["1.0e+3"]
    finally:
        plt.close(fig)


# ── real drawn labels: fixed/sci basic (uplotOpts.test.ts "formats ticks
#    fixed/sci at the configured digits when the increment needs no more") ──
def test_fixed_mode_drawn_labels_at_configured_digits() -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xticks([1.5, 2.0])
        apply_tick_formats(ax, {"mode": "fixed", "digits": 2}, None)
        fig.canvas.draw()
        assert [t.get_text() for t in ax.get_xticklabels()] == ["1.50", "2.00"]
    finally:
        plt.close(fig)


def test_sci_mode_drawn_labels_at_configured_digits() -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xticks([1500.0])
        apply_tick_formats(ax, {"mode": "sci", "digits": 1}, None)
        fig.canvas.draw()
        assert [t.get_text() for t in ax.get_xticklabels()] == ["1.5e+3"]
    finally:
        plt.close(fig)


# ── the duplicate-run regression shape (MAIN #20 parity) ────────────────────
def test_fixed_mode_increment_floor_keeps_dense_ticks_distinct() -> None:
    # A tight range (0.0001 apart) at digits=2 would collapse every label to
    # "0.00"/"-0.00" without the increment floor -- the exact owner bug the
    # frontend fixed; the export side must inherit the same guarantee.
    dense = [-0.0002, -0.0001, 0.0, 0.0001, 0.0002]
    fig, ax = plt.subplots()
    try:
        ax.set_xticks(dense)
        ax.set_xlim(min(dense), max(dense))
        apply_tick_formats(ax, {"mode": "fixed", "digits": 2}, None)
        fig.canvas.draw()
        labels = [t.get_text() for t in ax.get_xticklabels()]
        assert labels == ["-0.0002", "-0.0001", "0.0000", "0.0001", "0.0002"]
        assert len(set(labels)) == len(dense)
    finally:
        plt.close(fig)


def test_sci_mode_increment_floor_keeps_dense_ticks_distinct() -> None:
    dense = [1.1e-3, 1.2e-3, 1.3e-3]
    fig, ax = plt.subplots()
    try:
        ax.set_xticks(dense)
        ax.set_xlim(min(dense), max(dense))
        apply_tick_formats(ax, {"mode": "sci", "digits": 1}, None)
        fig.canvas.draw()
        labels = [t.get_text() for t in ax.get_xticklabels()]
        assert labels == ["1.1e-3", "1.2e-3", "1.3e-3"]
        assert len(set(labels)) == 3
    finally:
        plt.close(fig)


def test_eng_mode_increment_floor_keeps_dense_ticks_distinct() -> None:
    dense = [1.1e-3, 1.2e-3, 1.3e-3]
    fig, ax = plt.subplots()
    try:
        ax.set_xticks(dense)
        ax.set_xlim(min(dense), max(dense))
        apply_tick_formats(ax, {"mode": "eng", "digits": 0}, None)
        fig.canvas.draw()
        labels = [t.get_text() for t in ax.get_xticklabels()]
        assert len(set(labels)) == 3
    finally:
        plt.close(fig)


# ── -0 absence (MAIN #20 parity) ─────────────────────────────────────────────
def test_fixed_mode_never_renders_a_bare_negative_zero() -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xticks([-0.0004])
        apply_tick_formats(ax, {"mode": "fixed", "digits": 2}, None)
        fig.canvas.draw()
        assert [t.get_text() for t in ax.get_xticklabels()] == ["0.00"]
    finally:
        plt.close(fig)


# ── eng-mode shapes (uplotOpts.test.ts "eng mode: mantissa in [1,1000), …") ──
def test_eng_mode_shapes_match_the_frontend() -> None:
    fig, ax = plt.subplots()
    try:
        for value, expected in [
            (0.0012, "1.2e-3"),
            (-0.0012, "-1.2e-3"),
            (0.0, "0"),
            (12345.0, "12.3e+3"),
        ]:
            ax.set_xticks([value])
            apply_tick_formats(ax, {"mode": "eng", "digits": 1}, None)
            fig.canvas.draw()
            assert [t.get_text() for t in ax.get_xticklabels()] == [expected]
    finally:
        plt.close(fig)


def test_eng_mode_renormalizes_when_mantissa_rounds_up_to_1000() -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xticks([999.9996])
        apply_tick_formats(ax, {"mode": "eng", "digits": 0}, None)
        fig.canvas.draw()
        assert [t.get_text() for t in ax.get_xticklabels()] == ["1e+3"]
    finally:
        plt.close(fig)


@pytest.mark.parametrize(
    ("mode", "expected"),
    [("date", "2026-07-19"), ("time", "12:34:56"), ("datetime", "2026-07-19 12:34")],
)
def test_datetime_modes_format_epoch_seconds_in_utc(mode: str, expected: str) -> None:
    fig, ax = plt.subplots()
    try:
        stamp = datetime(2026, 7, 19, 12, 34, 56, tzinfo=UTC).timestamp()
        ax.set_xticks([stamp])
        apply_tick_formats(ax, {"mode": mode, "digits": 2}, None)
        fig.canvas.draw()
        assert [tick.get_text() for tick in ax.get_xticklabels()] == [expected]
    finally:
        plt.close(fig)


# ── pure formatter units (fast, no matplotlib draw needed) ──────────────────
def test_decimals_for_increment_floors_at_log10_order() -> None:
    assert _decimals_for_increment(0.0001) == 4
    assert _decimals_for_increment(1.0) == 0
    assert _decimals_for_increment(0.0) == 0
    assert _decimals_for_increment(float("nan")) == 0


def test_decimals_for_increment_round_trips_nice_non_power_of_10_steps() -> None:
    # 0.25 needs 2 decimals, not the 1 -log10(0.25)~0.6 -> ceil(0.6)=1 implies.
    assert _decimals_for_increment(0.25) == 2


def test_mantissa_decimal_floor_rescales_into_mantissa_units() -> None:
    assert _mantissa_decimal_floor(0.0, 0) == 0
    assert _mantissa_decimal_floor(100.0, 2) == 0  # 100 / 10**2 == 1 -> 0 decimals


def test_strip_neg_zero_only_strips_when_the_bare_value_is_zero() -> None:
    assert _strip_neg_zero("-0.00") == "0.00"
    assert _strip_neg_zero("-0.00e+0") == "0.00e+0"
    assert _strip_neg_zero("-1.50") == "-1.50"
    assert _strip_neg_zero("1.50") == "1.50"


def test_to_exponential_matches_js_shape_no_zero_padding() -> None:
    assert _to_exponential(1500.0, 1) == "1.5e+3"
    assert _to_exponential(0.0012, 1) == "1.2e-3"
    assert _to_exponential(-1500.0, 1) == "-1.5e+3"
    assert _to_exponential(0.0, 2) == "0.00e+0"


def test_format_fixed_floors_digits_at_the_increment_and_strips_neg_zero() -> None:
    assert _format_fixed(1.5, 2, 0.0) == "1.50"
    assert _format_fixed(-0.0004, 2, 0.01) == "0.00"
    assert _format_fixed(0.0001, 2, 0.0001) == "0.0001"  # floored above digits=2


def test_format_sci_floors_mantissa_digits_at_the_increment() -> None:
    assert _format_sci(1500.0, 1, 0.0) == "1.5e+3"
    assert _format_sci(1.2e-3, 1, 0.0001) == "1.2e-3"


def test_format_eng_zero_and_negative_and_renormalize() -> None:
    assert _format_eng(0.0, 1, 0.0) == "0"
    assert _format_eng(-0.0012, 1, 0.0) == "-1.2e-3"
    assert _format_eng(999.9996, 0, 0.0) == "1e+3"


@pytest.mark.parametrize("digits", [0, 20])
def test_digits_clamped_at_extremes_do_not_crash(digits: int) -> None:
    fig, ax = plt.subplots()
    try:
        ax.set_xticks([1.23456789])
        apply_tick_formats(ax, {"mode": "fixed", "digits": digits}, None)
        fig.canvas.draw()
        label = ax.get_xticklabels()[0].get_text()
        assert label  # renders something, doesn't raise
    finally:
        plt.close(fig)
