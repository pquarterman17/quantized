"""Unit tests for calc.figure_scale: axis-scale resolution + the reciprocal
(1/x) transform/tick locator (MAIN #12 -- Arrhenius-style plots)."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure_scale import (
    _reciprocal,
    apply_axis_scale,
    reciprocal_tick_values,
    resolve_axis_scale,
)


# ── resolve_axis_scale (back-compat bridge) ─────────────────────────────────
def test_resolve_axis_scale_prefers_explicit_when_valid() -> None:
    assert resolve_axis_scale("reciprocal", False) == "reciprocal"
    assert resolve_axis_scale("log", False) == "log"
    assert resolve_axis_scale("linear", True) == "linear"


def test_resolve_axis_scale_falls_back_to_legacy_log_flag() -> None:
    assert resolve_axis_scale(None, True) == "log"
    assert resolve_axis_scale(None, False) == "linear"


def test_resolve_axis_scale_ignores_an_invalid_explicit_value() -> None:
    assert resolve_axis_scale("sqrt", True) == "log"
    assert resolve_axis_scale("sqrt", False) == "linear"


# ── _reciprocal transform ────────────────────────────────────────────────────
def test_reciprocal_is_1_over_v_for_positive_input() -> None:
    out = _reciprocal(np.array([1.0, 2.0, 4.0]))
    assert np.allclose(out, [1.0, 0.5, 0.25])


def test_reciprocal_is_self_inverse() -> None:
    v = np.array([1.0, 2.0, 5.0, 100.0, 0.001, 300.0])
    assert np.allclose(_reciprocal(_reciprocal(v)), v)


def test_reciprocal_degrades_non_positive_to_nan() -> None:
    out = _reciprocal(np.array([0.0, -5.0, 3.0]))
    assert np.isnan(out[0])
    assert np.isnan(out[1])
    assert out[2] == pytest.approx(1.0 / 3.0)


def test_reciprocal_accepts_a_scalar() -> None:
    assert float(_reciprocal(4.0)) == pytest.approx(0.25)


# ── reciprocal_tick_values ───────────────────────────────────────────────────
def test_reciprocal_tick_values_degenerate_range_is_empty() -> None:
    assert reciprocal_tick_values(0.0, 10.0) == []
    assert reciprocal_tick_values(-1.0, 10.0) == []
    assert reciprocal_tick_values(10.0, 5.0) == []
    assert reciprocal_tick_values(5.0, 5.0) == []


def test_reciprocal_tick_values_stay_within_range_and_sorted() -> None:
    out = reciprocal_tick_values(100.0, 300.0)
    assert len(out) > 2
    assert out == sorted(out)
    assert all(100.0 <= v <= 300.0 for v in out)


def test_reciprocal_tick_values_evenly_spaced_in_reciprocal_space() -> None:
    out = reciprocal_tick_values(100.0, 300.0)
    recips = [1.0 / v for v in out]
    steps = [b - a for a, b in zip(recips, recips[1:], strict=False)]
    assert steps  # non-empty
    for s in steps:
        assert s == pytest.approx(steps[0], abs=1e-9)
    # The raw tick values themselves are NOT evenly spaced -- that's the
    # whole point of a reciprocal axis (positions follow 1/x, labels stay in
    # the original units).
    raw_steps = [b - a for a, b in zip(out, out[1:], strict=False)]
    assert len(set(round(s, 6) for s in raw_steps)) > 1


def test_reciprocal_tick_values_lands_on_clean_endpoints() -> None:
    # 1/50 = 0.02, 1/200 = 0.005 -- a clean 0.005 reciprocal step lands on
    # both endpoints (mirrors the frontend uplotOpts.test.ts case).
    out = reciprocal_tick_values(50.0, 200.0)
    assert out[0] == pytest.approx(50.0, abs=1e-6)
    assert out[-1] == pytest.approx(200.0, abs=1e-6)


def test_reciprocal_tick_values_respects_target_count() -> None:
    few = reciprocal_tick_values(100.0, 1000.0, target=2)
    many = reciprocal_tick_values(100.0, 1000.0, target=10)
    assert len(many) >= len(few)


# ── apply_axis_scale (matplotlib integration) ───────────────────────────────
def test_apply_axis_scale_linear_is_a_no_op() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    try:
        apply_axis_scale(ax, "x", "linear")
        assert ax.get_xscale() == "linear"
    finally:
        plt.close(fig)


def test_apply_axis_scale_log_sets_log_scale() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    try:
        apply_axis_scale(ax, "y", "log")
        assert ax.get_yscale() == "log"
    finally:
        plt.close(fig)


def test_apply_axis_scale_reciprocal_sets_function_scale_and_locator() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    try:
        ax.plot([100.0, 200.0, 300.0], [1.0, 2.0, 3.0])
        apply_axis_scale(ax, "x", "reciprocal")
        assert ax.get_xscale() == "function"
        # The custom locator is attached and produces finite ticks without
        # raising, for a real (drawn) axes view range.
        ax.set_xlim(100.0, 300.0)
        ticks = ax.xaxis.get_major_locator()()
        assert len(ticks) > 0
        assert all(np.isfinite(t) for t in ticks)
    finally:
        plt.close(fig)
