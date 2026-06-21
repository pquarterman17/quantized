"""baselineRollingBall + baselineModPoly: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.baseline import baseline_modpoly, baseline_rolling_ball


@pytest.mark.golden
def test_rolling_ball_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_rollingball.json")
    y = np.asarray(g["input"], dtype=float)
    baseline, params = baseline_rolling_ball(y)
    compare_calc(
        {"baseline": baseline, "radius": params["radius"], "smooth": params["smooth"]},
        g["output"],
    )


@pytest.mark.golden
def test_modpoly_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_modpoly.json")
    y = np.asarray(g["input"], dtype=float)
    baseline, params = baseline_modpoly(y, order=5)
    compare_calc(
        {
            "baseline": baseline,
            "order": params["order"],
            "nIter": params["nIter"],
            "converged": params["converged"],
        },
        g["output"],
        rtol=1e-7,
        atol=1e-7,
    )


def test_rolling_ball_stays_below_data() -> None:
    x = np.linspace(0.0, 30.0, 300)
    y = 50.0 + 2.0 * x + 500.0 * np.exp(-((x - 15.0) ** 2) / 0.2)
    baseline, params = baseline_rolling_ball(y, radius=80)
    assert baseline.shape == y.shape
    assert np.all(baseline <= y + 1e-9)  # clamped to min(bg, y)
    assert baseline[np.argmax(y)] < y.max() / 2  # peak excluded from baseline
    assert params["radius"] == 80


def test_modpoly_recovers_linear_background() -> None:
    x = np.linspace(0.0, 10.0, 200)
    y = 3.0 + 0.5 * x + 100.0 * np.exp(-((x - 5.0) ** 2) / 0.05)  # line + sharp peak
    baseline, params = baseline_modpoly(y, order=2)
    assert np.all(baseline <= y + 1e-9)  # clamped to min(fit, y)
    # the sharp peak is clipped out of the baseline
    assert baseline[int(np.argmax(y))] < y.max() / 2
    assert params["order"] == 2
