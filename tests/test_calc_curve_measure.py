"""Analytic and edge-case tests for calc.curve_measure."""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.curve_measure import intersect_curves, level_crossings, step_time


def test_sin_cos_cross_at_pi_over_4_plus_k_pi() -> None:
    xa = np.linspace(0.0, 4 * math.pi, 4001)
    xb = np.linspace(0.0, 4 * math.pi, 3001)  # a different grid: union logic is exercised
    r = intersect_curves(xa, np.sin(xa), xb, np.cos(xb))
    want = [math.pi / 4 + k * math.pi for k in range(4)]
    assert [i.x for i in r.intersections] == pytest.approx(want, abs=1e-5)
    assert all(i.kind == "cross" for i in r.intersections)
    # sin - cos goes from negative to positive at pi/4, then alternates.
    assert [i.direction for i in r.intersections] == ["rising", "falling", "rising", "falling"]
    assert [i.y for i in r.intersections] == pytest.approx([math.sin(w) for w in want], abs=1e-5)


def test_unsorted_and_duplicate_x_are_handled() -> None:
    r = intersect_curves([2, 0, 1, 1], [2, 0, 0.5, 1.5], [0, 2], [2, 0])
    assert r.merged_a == 1
    assert [i.x for i in r.intersections] == pytest.approx([1.0])


def test_no_overlap_fails_closed() -> None:
    with pytest.raises(ValueError, match="do not overlap"):
        intersect_curves([0, 1], [0, 1], [2, 3], [0, 1])


def test_touching_without_crossing_and_coincident() -> None:
    r = intersect_curves([-1, 0, 1], [1, 0, 1], [-1, 1], [0, 0])
    assert [(i.kind, i.direction) for i in r.intersections] == [("touch", None)]
    r = intersect_curves([0, 1, 2, 3], [1, 0, 0, 1], [0, 3], [0, 0])
    assert [i.kind for i in r.intersections] == [("coincident")]
    assert (r.intersections[0].x, r.intersections[0].x_end) == (1.0, 2.0)
    r = intersect_curves([0, 1], [0, 1], [0, 1], [1, 2])
    assert r.intersections == ()


def test_intersect_nan_and_too_few_points() -> None:
    with pytest.raises(ValueError, match="not finite"):
        intersect_curves([0, 1, 2], [0, np.nan, 2], [0, 2], [0, 1])
    r = intersect_curves([0, 1, 2], [0, np.nan, 2], [0, 2], [2, 0], nonfinite="drop")
    assert r.dropped_a == 1 and len(r.intersections) == 1
    with pytest.raises(ValueError, match="at least 2"):
        intersect_curves([0], [0], [0, 1], [0, 1])


def test_level_crossings_of_sine_at_known_phases() -> None:
    x = np.linspace(0.0, 4 * math.pi, 8001)
    level = 0.5
    r = level_crossings(x, np.sin(x), level)
    up = [k * 2 * math.pi + math.asin(level) for k in range(2)]
    down = [k * 2 * math.pi + math.pi - math.asin(level) for k in range(2)]
    assert [(c.x) for c in r.crossings] == pytest.approx(sorted(up + down), abs=1e-5)
    assert [c.direction for c in r.crossings] == ["rising", "falling", "rising", "falling"]
    only_up = level_crossings(x, np.sin(x), level, direction="rising")
    assert [c.x for c in only_up.crossings] == pytest.approx(up, abs=1e-5)


def test_level_touch_and_unreached_level() -> None:
    assert level_crossings([0, 1, 2], [-1, 0, -1], 0).crossings == ()
    assert [c.direction for c in level_crossings([0, 1, 2], [-1, 0, 1], 0).crossings] == ["rising"]
    assert level_crossings([0, 1, 2], [1, 2, 3], 10).crossings == ()


def test_dead_band_suppresses_noise_bursts() -> None:
    rng = np.random.default_rng(1)
    x = np.linspace(0.0, 4.0, 4001)
    clean = np.where(x < 2.0, -1.0, 1.0) * 0.0 + (x - 2.0) * 0.05  # slow ramp through zero at x = 2
    y = clean + rng.normal(0.0, 0.05, x.size)
    bare = level_crossings(x, y, 0.0)
    banded = level_crossings(x, y, 0.0, hysteresis=0.15)
    assert len(bare.crossings) > 5
    assert [c.direction for c in banded.crossings] == ["rising"]
    assert abs(banded.crossings[0].x - 2.0) < 1.0  # inside the noisy region, a single crossing


def test_level_crossings_validation() -> None:
    with pytest.raises(ValueError, match="negative"):
        level_crossings([0, 1], [0, 1], 0.5, hysteresis=-1)
    with pytest.raises(ValueError, match="finite"):
        level_crossings([0, 1], [0, 1], float("nan"))
    with pytest.raises(ValueError, match="at least 2"):
        level_crossings([0], [0], 0.5)
    with pytest.raises(ValueError, match="not finite"):
        level_crossings([0, 1, 2], [0, np.nan, 1], 0.5)


def test_rise_time_exponential_closed_form() -> None:
    tau = 0.7
    t = np.linspace(0.0, 10 * tau, 20001)
    r = step_time(t, 1.0 - np.exp(-t / tau), low_level=0.0, high_level=1.0)
    assert r.edge == "rise"
    assert r.time == pytest.approx(tau * math.log(9.0), rel=1e-5)
    assert r.x_low == pytest.approx(-tau * math.log(0.9), rel=1e-4)
    assert r.x_high == pytest.approx(-tau * math.log(0.1), rel=1e-4)
    assert r.plateaus_estimated == (False, False)


def test_rise_fall_time_default_plateaus_and_fraction_options() -> None:
    w = 0.2
    t = np.linspace(0.0, 10.0, 5001)
    y = 3.0 + 2.0 * np.tanh((t - 5.0) / w)  # plateaus 1 and 5, 10-90 time = 2 w ln 3
    r = step_time(t, y)
    assert r.plateaus_estimated == (True, True)
    assert r.time == pytest.approx(2 * w * math.log(3.0), rel=1e-2)
    f = step_time(t, y[::-1])
    assert f.edge == "fall" and f.x_high < f.x_low
    assert f.time == pytest.approx(r.time, rel=1e-6)
    wide = step_time(t, y, low_fraction=0.2, high_fraction=0.8)
    assert wide.time == pytest.approx(2 * w * math.log(2.0), rel=1e-2)  # atanh(0.6) = ln 2


def test_step_time_noise_pulse_and_errors() -> None:
    rng = np.random.default_rng(3)
    t = np.linspace(0.0, 10.0, 4001)
    y = (
        0.5 * (1 + np.tanh((t - 3.0) / 0.1))
        - 0.5 * (1 + np.tanh((t - 7.0) / 0.1))
        + rng.normal(0, 0.02, t.size)
    )
    up = step_time(t, y)
    assert up.edge == "rise"
    assert up.time == pytest.approx(2 * 0.1 * math.log(3.0), rel=0.1)
    down = step_time(t, y, edge="fall")
    assert down.edge == "fall" and down.x_high > 6.0
    with pytest.raises(ValueError, match="flat"):
        step_time(t, np.ones_like(t))
    with pytest.raises(ValueError, match="fractions"):
        step_time(t, y, low_fraction=0.9, high_fraction=0.1)
    with pytest.raises(ValueError, match="at least 5"):
        step_time([0, 1, 2], [0, 1, 2])
    with pytest.raises(ValueError, match="no rise|no fall"):
        step_time(
            t[:1500],
            1.0 - 0.0 * t[:1500] + np.linspace(0, 0.001, 1500),
            low_level=0.0,
            high_level=5.0,
            edge="rise",
        )
    with pytest.raises(ValueError, match="not finite"):
        step_time(t, np.where(t > 5, np.nan, y))


# --- rise time on a noisy step (acceptance 14, W1) ------------------------------------------------


def _noisy_tanh_step(seed: int, sigma: float = 0.15) -> tuple[np.ndarray, np.ndarray]:
    x = np.linspace(0, 10, 1001)
    y = 2 + 4 * (0.5 + 0.5 * np.tanh((x - 5) / 0.5))
    return x, y + np.random.default_rng(seed).normal(0, sigma, x.size)


_TANH_RISE = 2 * 0.5 * np.arctanh(0.8)  # 10 -> 90 % of tanh((x - 5) / 0.5)


def test_noise_free_tanh_step_gives_the_exact_rise_time() -> None:
    from quantized.calc.curve_measure import step_time

    x = np.linspace(0, 10, 4001)
    y = 2 + 4 * (0.5 + 0.5 * np.tanh((x - 5) / 0.5))
    r = step_time(x, y, low_level=2.0, high_level=6.0)
    np.testing.assert_allclose(r.time, _TANH_RISE, rtol=1e-4)


def test_noisy_step_rise_time_is_not_biased_short() -> None:
    from quantized.calc.curve_measure import step_time

    times = np.array([step_time(*_noisy_tanh_step(s)).time for s in range(40)])
    # unbiased on average (the old last-10 % / first-90 % rule gave 0.93, 15 % low) ...
    assert abs(times.mean() / _TANH_RISE - 1) < 0.04
    # ... and each single trace lies within the noise's own timing jitter
    assert np.all(np.abs(times / _TANH_RISE - 1) < 0.25)


def test_noisy_step_fall_matches_the_rise() -> None:
    from quantized.calc.curve_measure import step_time

    x, y = _noisy_tanh_step(3)
    up = step_time(x, y)
    down = step_time(x, 8 - y)
    assert down.edge == "fall"
    np.testing.assert_allclose(down.time, up.time, rtol=0.02)


def test_band_method_keeps_the_legacy_crossing_rule() -> None:
    from quantized.calc.curve_measure import step_time

    x, y = _noisy_tanh_step(0)
    legacy = step_time(x, y, plateau_method="band")
    # pinned to the value saved steps were measured with; the state method differs on noisy data
    assert legacy.x_low > step_time(x, y).x_low
