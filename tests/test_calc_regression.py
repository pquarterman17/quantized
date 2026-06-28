"""Linear/polynomial regression: golden parity vs MATLAB +utilities/linRegress."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.stats import lin_regress


@pytest.mark.golden
def test_lin_regress_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_linregress.json")
    out = lin_regress(
        np.asarray(g["input"]["x"], dtype=float),
        np.asarray(g["input"]["y"], dtype=float),
        order=int(g["params"]["order"]),
    )
    compare_calc(out, g["output"])


def test_lin_regress_recovers_known_line() -> None:
    # Exact line: slope 3, intercept -2, no noise -> R^2 == 1.
    x = np.arange(1.0, 11.0)
    y = 3.0 * x - 2.0
    r = lin_regress(x, y, order=1)
    assert_allclose(r["coeffs"], [-2.0, 3.0], atol=1e-9)
    assert r["R2"] == pytest.approx(1.0)
    assert_allclose(r["residuals"], 0.0, atol=1e-9)


def test_lin_regress_quadratic_order2() -> None:
    x = np.linspace(-2.0, 2.0, 15)
    y = 0.5 * x**2 - 1.5 * x + 4.0
    r = lin_regress(x, y, order=2)
    assert_allclose(r["coeffs"], [4.0, -1.5, 0.5], atol=1e-9)
    assert r["df"] == 15 - 3


def test_lin_regress_too_few_points() -> None:
    with pytest.raises(ValueError, match="at least"):
        lin_regress(np.array([1.0, 2.0]), np.array([1.0, 2.0]), order=1)


def test_lin_regress_singular_raises_valueerror() -> None:
    # All-identical x → constant predictor column → singular normal equations.
    # Must surface a clean ValueError, not an unguarded LinAlgError (HTTP 500).
    x = np.array([3.0, 3.0, 3.0, 3.0, 3.0])
    y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    with pytest.raises(ValueError, match="singular"):
        lin_regress(x, y, order=1)


def test_lin_regress_constant_y_gives_nan_adjusted_r2() -> None:
    """Constant y -> ss_tot=0; adjusted R^2 is NaN (was ZeroDivisionError)."""
    import math

    out = lin_regress(np.array([0.0, 1.0, 2.0, 3.0, 4.0]), np.array([3.0] * 5))
    assert math.isnan(out["R2adj"])
    assert out["R2"] == pytest.approx(1.0)


def test_lin_regress_mismatched_lengths_raises_clean_error() -> None:
    with pytest.raises(ValueError, match="same length"):
        lin_regress(np.array([0.0, 1.0, 2.0, 3.0]), np.array([1.0, 2.0]))
