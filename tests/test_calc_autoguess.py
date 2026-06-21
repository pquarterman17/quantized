"""autoGuess initial-parameter estimation: golden parity vs MATLAB fitting.autoGuess."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_models import FIT_MODELS


@pytest.mark.golden
def test_autoguess_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_autoguess.json")
    x = np.asarray(g["x"], dtype=float)
    y = np.asarray(g["y"], dtype=float)
    tested = 0
    for entry in g["guesses"]:
        name = entry["name"]
        if name not in FIT_MODELS:
            continue
        guess = auto_guess(name, x, y)
        assert_allclose(
            guess, np.atleast_1d(np.asarray(entry["p0"], dtype=float)),
            rtol=1e-9, atol=1e-12, err_msg=name,
        )
        tested += 1
    assert tested >= 25


def test_autoguess_gaussian_recovers_peak() -> None:
    x = np.linspace(0.0, 20.0, 200)
    y = 7.0 * np.exp(-((x - 8.0) ** 2) / (2 * 1.5**2)) + 0.5
    g = auto_guess("Gaussian", x, y)
    assert g[0] == pytest.approx(7.5, abs=0.1)  # amplitude ~ peak value
    assert g[1] == pytest.approx(8.0, abs=0.2)  # center at peak
    assert g[2] > 0  # sigma positive


def test_autoguess_linear_slope_intercept() -> None:
    x = np.linspace(0.0, 10.0, 50)
    y = 3.0 * x + 2.0
    g = auto_guess("Linear", x, y)
    assert g[0] == pytest.approx(3.0, rel=1e-6)
    assert g[1] == pytest.approx(2.0, rel=1e-6)


def test_autoguess_unknown_model_raises() -> None:
    with pytest.raises(ValueError, match="not found"):
        auto_guess("Nonexistent", np.array([1.0, 2.0]), np.array([1.0, 2.0]))
