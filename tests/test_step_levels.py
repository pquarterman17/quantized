"""Plateau (state) levels for rise time: IEEE 181 histogram method, checked by hand."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.curve_measure import step_time
from quantized.calc.step_levels import plateau_levels


def _hand_step() -> tuple[np.ndarray, np.ndarray]:
    # 9 low samples (eight at 2.0, one at 2.3), a 3-sample ramp, 9 high (one 5.7, eight 6.0).
    y = np.array([2.0] * 8 + [2.3, 3.0, 4.0, 5.0, 5.7] + [6.0] * 8)
    return np.arange(y.size, dtype=float), y


def test_hand_computed_levels_and_rise_time() -> None:
    x, y = _hand_step()
    # Range 2..6, 100 bins of 0.04: the lower-half mode is bin 0 (eight 2.0s), the
    # upper-half mode is bin 99 (eight 6.0s), so the states are exactly 2 and 6.
    assert plateau_levels(y, "state", 0.1) == (2.0, 6.0)
    r = step_time(x, y)
    assert r.plateau_method == "state" and r.plateaus_estimated == (True, True)
    # H = 4: 10 % = 2.4 is crossed between x=8 (2.3) and x=9 (3.0): 8 + 0.1/0.7;
    # 90 % = 5.6 between x=11 (5.0) and x=12 (5.7): 11 + 0.6/0.7. Time = 26/7.
    assert (r.low_plateau, r.high_plateau) == (2.0, 6.0)
    assert r.low_level == pytest.approx(2.4) and r.high_level == pytest.approx(5.6)
    assert r.x_low == pytest.approx(8 + 1 / 7) and r.x_high == pytest.approx(11 + 6 / 7)
    assert r.time == pytest.approx(26 / 7)
    r2 = step_time(x, y, low_fraction=0.2, high_fraction=0.8)  # 2.8 and 5.2
    assert r2.time == pytest.approx((11 + 0.2 / 0.7) - (8 + 0.5 / 0.7))


def test_noisy_step_matches_independent_histogram_and_truth() -> None:
    rng = np.random.default_rng(11)
    t = np.linspace(0.0, 10.0, 4001)
    w, base, top = 0.15, 1.5, 4.5
    y = base + (top - base) * 0.5 * (1 + np.tanh((t - 5.0) / w)) + rng.normal(0, 0.05, t.size)
    # Independent computation: numpy's own histogram, mode of each half, median of that bin.
    counts, edges = np.histogram(y, bins=100)
    lo_b, hi_b = int(np.argmax(counts[:50])), 50 + int(np.argmax(counts[50:]))

    def median_in(b: int) -> float:
        m = (y >= edges[b]) & ((y < edges[b + 1]) if b < 99 else (y <= edges[b + 1]))
        return float(np.median(y[m]))

    r = step_time(t, y)
    assert r.low_plateau == pytest.approx(median_in(lo_b), abs=1e-12)
    assert r.high_plateau == pytest.approx(median_in(hi_b), abs=1e-12)
    assert r.low_plateau == pytest.approx(base, abs=0.03)
    assert r.high_plateau == pytest.approx(top, abs=0.03)
    # tanh edge: 10-90 % takes 2 w ln 3 (noise on the crossings makes this approximate).
    assert r.time == pytest.approx(2 * w * np.log(3.0), rel=0.15)


def test_given_level_is_used_and_not_checked() -> None:
    x, y = _hand_step()
    r = step_time(x, y, low_level=2.0)
    assert r.plateaus_estimated == (False, True) and r.high_plateau == 6.0


def test_band_method_still_available() -> None:
    x, y = _hand_step()
    r = step_time(x, y, plateau_method="band")
    assert r.plateau_method == "band" and r.plateaus_estimated == (True, True)


@pytest.mark.parametrize(
    "name, y",
    [
        ("ramp", np.linspace(0.0, 1.0, 400)),
        ("exponential", 1.0 - np.exp(-np.linspace(0.0, 5.0, 400))),
        ("sine", np.sin(np.linspace(0.0, 6.0 * np.pi, 600))),
    ],
)
def test_no_two_level_shape_is_refused(name: str, y: np.ndarray) -> None:
    with pytest.raises(ValueError, match="no clear (low|high) plateau"):
        step_time(np.arange(y.size, dtype=float), y)
    # Supplying both levels measures it, as before.
    if name == "exponential":
        step_time(np.linspace(0, 5, 400), y, low_level=0.0, high_level=1.0)


def test_unknown_method_is_refused() -> None:
    with pytest.raises(ValueError, match="plateau_method"):
        plateau_levels(np.arange(10.0), "mean", 0.1)  # type: ignore[arg-type]
