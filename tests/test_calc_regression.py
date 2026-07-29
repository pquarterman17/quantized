"""Linear/polynomial regression: golden parity vs MATLAB +utilities/linRegress."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.stats import lin_regress, polynomial_confidence_band


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


# ── polynomial_confidence_band (JMP_GAP_PLAN J3 residual) ──────────────────


def test_confidence_band_matches_statsmodels_ols_linear() -> None:
    """Cross-check against statsmodels' own OLS mean-CI (independent
    implementation) for a noisy linear sample -- the oracle this module's
    'MEASURE before loosening tolerance' convention calls for."""
    import statsmodels.api as sm

    rng = np.random.default_rng(11)
    x = np.linspace(0.0, 10.0, 30)
    y = 2.0 * x + 1.0 + rng.normal(0.0, 1.5, x.size)

    grid = np.linspace(0.0, 10.0, 21)
    band = polynomial_confidence_band(x, y, grid, order=1, alpha=0.05)

    X = sm.add_constant(x)
    ols = sm.OLS(y, X).fit()
    pred = ols.get_prediction(sm.add_constant(grid)).summary_frame(alpha=0.05)

    np.testing.assert_allclose(band["yFit"], pred["mean"].to_numpy(), atol=1e-9)
    np.testing.assert_allclose(band["ciLo"], pred["mean_ci_lower"].to_numpy(), atol=1e-9)
    np.testing.assert_allclose(band["ciHi"], pred["mean_ci_upper"].to_numpy(), atol=1e-9)


def test_confidence_band_matches_statsmodels_ols_quadratic() -> None:
    """Same cross-check for an order-2 fit -- confirms the design-matrix
    reuse generalizes past the linear case."""
    import statsmodels.api as sm

    rng = np.random.default_rng(12)
    x = np.linspace(-3.0, 3.0, 40)
    y = 0.5 * x**2 - 2.0 * x + 3.0 + rng.normal(0.0, 0.8, x.size)

    grid = np.linspace(-3.0, 3.0, 25)
    band = polynomial_confidence_band(x, y, grid, order=2, alpha=0.10)

    X = np.column_stack([np.ones_like(x), x, x**2])
    ols = sm.OLS(y, X).fit()
    grid_mat = np.column_stack([np.ones_like(grid), grid, grid**2])
    pred = ols.get_prediction(grid_mat).summary_frame(alpha=0.10)

    np.testing.assert_allclose(band["yFit"], pred["mean"].to_numpy(), atol=1e-9)
    np.testing.assert_allclose(band["ciLo"], pred["mean_ci_lower"].to_numpy(), atol=1e-9)
    np.testing.assert_allclose(band["ciHi"], pred["mean_ci_upper"].to_numpy(), atol=1e-8)


def test_confidence_band_narrows_toward_the_center_of_x() -> None:
    # Textbook shape: the mean-CI half-width is smallest near mean(x) and
    # widens toward the extremes (leverage grows away from the centroid).
    rng = np.random.default_rng(13)
    x = np.linspace(0.0, 10.0, 25)
    y = 3.0 * x + rng.normal(0.0, 1.0, x.size)
    grid = np.array([0.0, 5.0, 10.0])
    band = polynomial_confidence_band(x, y, grid, order=1)
    half_lo = band["yFit"][0] - band["ciLo"][0]
    half_mid = band["yFit"][1] - band["ciLo"][1]
    half_hi = band["yFit"][2] - band["ciLo"][2]
    assert half_mid < half_lo
    assert half_mid < half_hi


def test_confidence_band_zero_noise_collapses_to_the_fit_line() -> None:
    x = np.arange(1.0, 11.0)
    y = 3.0 * x - 2.0
    grid = np.linspace(1.0, 10.0, 5)
    band = polynomial_confidence_band(x, y, grid, order=1)
    assert_allclose(band["ciLo"], band["yFit"], atol=1e-7)
    assert_allclose(band["ciHi"], band["yFit"], atol=1e-7)


def test_confidence_band_too_few_points_raises() -> None:
    with pytest.raises(ValueError, match="at least"):
        polynomial_confidence_band(
            np.array([1.0, 2.0]), np.array([1.0, 2.0]), np.array([1.0]), order=1,
        )


def test_confidence_band_mismatched_lengths_raises_clean_error() -> None:
    with pytest.raises(ValueError, match="same length"):
        polynomial_confidence_band(
            np.array([0.0, 1.0, 2.0, 3.0]), np.array([1.0, 2.0]), np.array([0.0]), order=1,
        )


def test_confidence_band_singular_raises_valueerror() -> None:
    x = np.array([3.0, 3.0, 3.0, 3.0, 3.0])
    y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    with pytest.raises(ValueError, match="singular"):
        polynomial_confidence_band(x, y, np.array([3.0]), order=1)


def test_confidence_band_grid_need_not_match_input_x() -> None:
    # The evaluation grid is independent of the fitted x -- a caller can
    # extrapolate or use a finer/coarser grid than the raw scatter.
    x = np.arange(1.0, 11.0)
    y = 3.0 * x - 2.0
    band = polynomial_confidence_band(x, y, np.array([0.0, 100.0]), order=1)
    assert_allclose(band["yFit"], [-2.0, 298.0], atol=1e-7)
