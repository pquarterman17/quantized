"""fit_bands vs statsmodels ``get_prediction`` and the scipy delta method.

Fitting audit finding 1: the prediction band was ~7x too narrow because it
added a curve-variance average instead of the fit's residual variance (MSE).
These references pin the corrected band end to end: curve_fit -> covar + MSE
-> fit_bands.
"""

from __future__ import annotations

import numpy as np
import statsmodels.api as sm
from numpy.typing import NDArray
from scipy.optimize import curve_fit as scipy_curve_fit
from scipy.stats import t as student_t

from quantized.calc.fit_stats import fit_bands, observation_variance_on_grid
from quantized.calc.fitting import curve_fit, weights_from_dy


def _line(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] + p[1] * x, dtype=float)


def _expbasis(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] + p[1] * np.exp(-x / 3.0), dtype=float)


def _gauss(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-((x - p[1]) ** 2) / (2 * p[2] ** 2)) + p[3], dtype=float)


def _bands_for(x, y, f, p0, grid, weights=None):  # type: ignore[no-untyped-def]
    fit = curve_fit(x, y, f, p0, weights=weights)
    return fit, fit_bands(grid, f, fit["params"], fit["covar"], fit["nPoints"], fit["nFree"],
                          mse=fit["MSE"])


def _assert_frame(b, frame, rtol):  # type: ignore[no-untyped-def]
    np.testing.assert_allclose(b["ciLo"], frame["mean_ci_lower"], rtol=rtol)
    np.testing.assert_allclose(b["ciHi"], frame["mean_ci_upper"], rtol=rtol)
    np.testing.assert_allclose(b["piLo"], frame["obs_ci_lower"], rtol=rtol)
    np.testing.assert_allclose(b["piHi"], frame["obs_ci_upper"], rtol=rtol)


def test_linear_bands_match_statsmodels_get_prediction() -> None:
    rng = np.random.default_rng(5)
    x = np.linspace(0, 10, 30)
    y = 2.0 + 0.7 * x + rng.normal(0, 0.8, x.size)
    grid = np.linspace(-2, 12, 15)
    _, b = _bands_for(x, y, _line, [0.0, 0.0], grid)
    ols = sm.OLS(y, sm.add_constant(x)).fit()
    frame = ols.get_prediction(sm.add_constant(grid)).summary_frame(alpha=0.05)
    _assert_frame(b, frame, rtol=1e-6)


def test_basis_nonlinear_in_x_matches_statsmodels_at_99_percent() -> None:
    rng = np.random.default_rng(6)
    x = np.linspace(0, 15, 40)
    y = 1.0 + 4.0 * np.exp(-x / 3.0) + rng.normal(0, 0.2, x.size)
    grid = np.linspace(0, 15, 12)
    fit = curve_fit(x, y, _expbasis, [0.0, 1.0])
    b = fit_bands(grid, _expbasis, fit["params"], fit["covar"], fit["nPoints"], fit["nFree"],
                  mse=fit["MSE"], level=0.99)
    exog = np.column_stack([np.ones_like(x), np.exp(-x / 3.0)])
    gexog = np.column_stack([np.ones_like(grid), np.exp(-grid / 3.0)])
    frame = sm.OLS(y, exog).fit().get_prediction(gexog).summary_frame(alpha=0.01)
    _assert_frame(b, frame, rtol=1e-6)


def test_nonlinear_bands_match_scipy_delta_method() -> None:
    rng = np.random.default_rng(8)
    x = np.linspace(0, 20, 90)
    y = _gauss(x, np.array([5.0, 10.0, 2.0, 0.5])) + rng.normal(0, 0.2, x.size)
    grid = np.linspace(0, 20, 25)
    fit, b = _bands_for(x, y, _gauss, [4.0, 9.0, 1.5, 0.0], grid)

    p, pcov = scipy_curve_fit(lambda xx, *pp: _gauss(xx, np.array(pp)), x, y,
                              p0=[4.0, 9.0, 1.5, 0.0], ftol=1e-15, xtol=1e-15, gtol=1e-15)
    a, mu, s, _ = p
    e = np.exp(-((grid - mu) ** 2) / (2 * s**2))
    grad = np.column_stack([e, a * e * (grid - mu) / s**2, a * e * (grid - mu) ** 2 / s**3,
                            np.ones_like(grid)])
    var_ci = np.einsum("ij,jk,ik->i", grad, pcov, grad)
    resid = y - _gauss(x, p)
    mse = float(resid @ resid) / (x.size - 4)
    tq = student_t.ppf(0.975, x.size - 4)
    yg = _gauss(grid, p)
    assert fit["MSE"] == np.float64(fit["chiSqRed"])
    np.testing.assert_allclose(fit["MSE"], mse, rtol=1e-8)
    np.testing.assert_allclose(b["ciHi"] - b["yFit"], tq * np.sqrt(var_ci), rtol=1e-4)
    np.testing.assert_allclose(b["piHi"], yg + tq * np.sqrt(var_ci + mse), rtol=1e-6)
    np.testing.assert_allclose(b["piLo"], yg - tq * np.sqrt(var_ci + mse), rtol=1e-6)
    # The audit's symptom: the PI must cover the residual scatter. ~95 % of the
    # data points fall inside it (the old band covered roughly a third).
    inside = fit_bands(x, _gauss, fit["params"], fit["covar"], 90, 4, mse=fit["MSE"])
    frac = np.mean((y >= inside["piLo"]) & (y <= inside["piHi"]))
    assert 0.9 <= frac <= 1.0


def test_weighted_band_between_data_points_tracks_statsmodels() -> None:
    """Per-point prediction variance (review item 1; the exact at-the-data
    comparison is test_calc_fit_review_fixes). BETWEEN data points the
    variance is linearly interpolated, which is close to -- not identical
    with -- the smooth error model statsmodels is handed here."""
    rng = np.random.default_rng(9)
    x = np.linspace(0, 10, 201)
    sig = 0.2 + 0.1 * x
    y = 1.0 + 0.5 * x + rng.normal(0, 1, x.size) * sig
    w = weights_from_dy(sig, x.size)
    fit = curve_fit(x, y, _line, [0.0, 0.0], weights=w)
    grid = (x[:-1] + x[1:]) / 2  # every midpoint
    var = observation_variance_on_grid(x, fit["obsVar"], grid)
    b = fit_bands(grid, _line, fit["params"], fit["covar"], fit["nPoints"], fit["nFree"], mse=var)
    wls = sm.WLS(y, sm.add_constant(x), weights=w).fit()
    w_grid = 1.0 / (0.2 + 0.1 * grid) ** 2
    frame = wls.get_prediction(sm.add_constant(grid), weights=w_grid).summary_frame(alpha=0.05)
    _assert_frame(b, frame, rtol=1e-3)
    # Outside the data the variance is HELD at the end value, not extrapolated.
    out = observation_variance_on_grid(x, fit["obsVar"], [-5.0, 15.0])
    np.testing.assert_allclose(out, [fit["obsVar"][0], fit["obsVar"][-1]])


def test_bands_without_mse_omit_the_prediction_limits() -> None:
    x = np.linspace(0, 10, 20)
    b = fit_bands(x, _line, [1.0, 2.0], np.diag([0.01, 0.001]), 20, 2)
    assert np.all(np.isfinite(b["ciLo"])) and np.all(np.isnan(b["piLo"]))


def test_bands_accept_a_held_parameter_zero_covariance_row() -> None:
    x = np.linspace(0, 10, 20)
    fit = curve_fit(x, 1.0 + 2.0 * x + np.sin(x), _line, [1.0, 1.0], fixed=[True, False])
    b = fit_bands(x, _line, fit["params"], fit["covar"], 20, 1, mse=fit["MSE"])
    assert np.all(np.isfinite(b["ciHi"])) and np.all(np.isfinite(b["piHi"]))
