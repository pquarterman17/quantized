"""curve_fit error estimates, error scaling, weighting modes, metrics and the
bounded-start simplex -- checked against scipy ``curve_fit`` and statsmodels.

Fitting audit findings 2 (start at lo + 1 frozen), 3 (Origin/scipy (JᵀJ)⁻¹
covariance), 12 (scale-errors switch, direct weighting) and 16 (one metric
definition). The MATLAB golden parity of the Hessian method lives in
``test_calc_fitting.py``.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
import statsmodels.api as sm
from numpy.typing import NDArray
from scipy.optimize import curve_fit as scipy_curve_fit

from quantized.calc.fit_metrics import fit_metrics
from quantized.calc.fit_simplex import initial_simplex, stalled_parameters
from quantized.calc.fitting import curve_fit, weights_from_dy


def _gauss(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-((x - p[1]) ** 2) / (2 * p[2] ** 2)) + p[3], dtype=float)


def _decay(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-x / p[1]) + p[2], dtype=float)


def _line(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] + p[1] * x, dtype=float)


def _gauss_data() -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    rng = np.random.default_rng(7)
    x = np.linspace(0.0, 20.0, 120)
    return x, _gauss(x, np.array([5.0, 9.5, 1.7, 0.4])) + rng.normal(0, 0.15, x.size)


def _decay_data() -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    rng = np.random.default_rng(11)
    x = np.linspace(0.0, 10.0, 60)
    sig = 0.05 + 0.03 * x
    return x, _decay(x, np.array([3.0, 2.2, 0.3])) + rng.normal(0, 1, x.size) * sig, sig


def _scipy(f, x, y, p0, **kw):  # type: ignore[no-untyped-def]
    # Tight LM tolerances: scipy's defaults stop measurably short of the
    # optimum Nelder-Mead reaches (chi^2 2.94660809691 vs ...09688).
    p, c = scipy_curve_fit(lambda xx, *pp: f(xx, np.array(pp)), x, y, p0=p0,
                           ftol=1e-15, xtol=1e-15, gtol=1e-15, **kw)
    return p, np.sqrt(np.diag(c))


# ── finding 3: (JᵀJ)⁻¹·MSE is the default and matches scipy pcov ────────────


def test_default_errors_match_scipy_pcov_unweighted() -> None:
    x, y = _gauss_data()
    out = curve_fit(x, y, _gauss, [4.0, 9.0, 1.0, 0.0])
    p_ref, se_ref = _scipy(_gauss, x, y, [4.0, 9.0, 1.0, 0.0])
    assert out["covariance"] == "jtj"
    np.testing.assert_allclose(out["params"], p_ref, rtol=1e-6)
    np.testing.assert_allclose(out["errors"], se_ref, rtol=1e-5)
    np.testing.assert_allclose(out["errorsJtj"], se_ref, rtol=1e-5)
    np.testing.assert_allclose(out["covar"], out["covar"].T)


def test_hessian_mode_is_selectable_and_both_are_returned() -> None:
    x, y = _gauss_data()
    jtj = curve_fit(x, y, _gauss, [4.0, 9.0, 1.0, 0.0])
    hes = curve_fit(x, y, _gauss, [4.0, 9.0, 1.0, 0.0], covariance="hessian")
    assert hes["covariance"] == "hessian"
    np.testing.assert_allclose(hes["errors"], jtj["errorsHessian"], rtol=1e-12)
    np.testing.assert_allclose(jtj["errors"], hes["errorsJtj"], rtol=1e-12)
    # Small residuals: the Gauss-Newton and full-Hessian estimates nearly agree.
    np.testing.assert_allclose(hes["errors"], jtj["errors"], rtol=0.05)
    with pytest.raises(ValueError, match="covariance"):
        curve_fit(x, y, _gauss, [4.0, 9.0, 1.0, 0.0], covariance="bogus")


def test_fixed_parameter_has_no_error_and_others_match_scipy() -> None:
    x, y = _gauss_data()
    out = curve_fit(x, y, _gauss, [4.0, 9.0, 1.0, 0.4], fixed=[False, False, False, True])
    p_ref, se_ref = _scipy(lambda xx, p: _gauss(xx, np.r_[p, 0.4]), x, y, [4.0, 9.0, 1.0])
    np.testing.assert_allclose(out["params"][:3], p_ref, rtol=1e-6)
    np.testing.assert_allclose(out["errors"][:3], se_ref, rtol=1e-5)
    assert math.isnan(out["errors"][3])


# ── finding 12: error scaling switch + direct weighting ────────────────────


def test_weighted_scaled_errors_match_scipy_relative_sigma() -> None:
    x, y, sig = _decay_data()
    out = curve_fit(x, y, _decay, [3.0, 2.0, 0.0], weights=weights_from_dy(sig, x.size))
    p_ref, se_ref = _scipy(_decay, x, y, [3.0, 2.0, 0.0], sigma=sig, absolute_sigma=False)
    assert out["errorsScaled"] is True
    np.testing.assert_allclose(out["params"], p_ref, rtol=1e-6)
    np.testing.assert_allclose(out["errors"], se_ref, rtol=1e-5)


def test_weighted_absolute_errors_match_scipy_absolute_sigma() -> None:
    x, y, sig = _decay_data()
    w = weights_from_dy(sig, x.size)
    out = curve_fit(x, y, _decay, [3.0, 2.0, 0.0], weights=w, scale_errors=False)
    scaled = curve_fit(x, y, _decay, [3.0, 2.0, 0.0], weights=w)
    _, se_ref = _scipy(_decay, x, y, [3.0, 2.0, 0.0], sigma=sig, absolute_sigma=True)
    assert out["errorsScaled"] is False
    np.testing.assert_allclose(out["errors"], se_ref, rtol=1e-5)
    # Scaled = absolute * sqrt(reduced chi^2), for both estimators.
    root = math.sqrt(scaled["chiSqRed"])
    np.testing.assert_allclose(scaled["errors"], out["errors"] * root, rtol=1e-9)
    np.testing.assert_allclose(scaled["errorsHessian"], out["errorsHessian"] * root, rtol=1e-9)


def test_unweighted_fit_always_scales() -> None:
    x, y = _gauss_data()
    a = curve_fit(x, y, _gauss, [4.0, 9.0, 1.0, 0.0], scale_errors=False)
    b = curve_fit(x, y, _gauss, [4.0, 9.0, 1.0, 0.0])
    assert a["errorsScaled"] is True
    np.testing.assert_allclose(a["errors"], b["errors"])


def test_direct_weighting_matches_scipy_sigma_inverse_sqrt_w() -> None:
    x, y, _ = _decay_data()
    w = 1.0 + 0.5 * np.cos(x) ** 2  # an arbitrary weight column, used as w directly
    out = curve_fit(x, y, _decay, [3.0, 2.0, 0.0], weights=w)
    p_ref, se_ref = _scipy(_decay, x, y, [3.0, 2.0, 0.0], sigma=1 / np.sqrt(w))
    np.testing.assert_allclose(out["params"], p_ref, rtol=1e-6)
    np.testing.assert_allclose(out["errors"], se_ref, rtol=1e-5)


def test_bad_weights_are_rejected() -> None:
    x, y = _gauss_data()
    for bad in (np.ones(3), -np.ones(x.size), np.zeros(x.size), np.full(x.size, np.nan)):
        with pytest.raises(ValueError, match="weights"):
            curve_fit(x, y, _gauss, [4.0, 9.0, 1.0, 0.0], weights=bad)


# ── finding 16: one metric definition, statsmodels-consistent ──────────────


def test_unweighted_metrics_match_statsmodels_ols() -> None:
    rng = np.random.default_rng(3)
    x = np.linspace(0, 10, 40)
    y = 1.5 + 0.8 * x + rng.normal(0, 0.3, x.size)
    out = curve_fit(x, y, _line, [1.0, 1.0])
    ols = sm.OLS(y, sm.add_constant(x)).fit()
    assert out["SSR"] == pytest.approx(ols.ssr, rel=1e-8)
    assert out["RMSE"] == pytest.approx(math.sqrt(ols.ssr / x.size), rel=1e-8)
    assert out["chiSqRed"] == pytest.approx(ols.mse_resid, rel=1e-8)
    assert out["logLik"] == pytest.approx(ols.llf, rel=1e-9)
    assert out["AIC"] == pytest.approx(ols.aic, rel=1e-9)
    assert out["BIC"] == pytest.approx(ols.bic, rel=1e-9)
    assert out["AICc"] == pytest.approx(ols.aic + 2 * 2 * 3 / (40 - 2 - 1), rel=1e-9)


def test_weighted_rmse_is_in_data_units_and_aic_matches_statsmodels_wls() -> None:
    x, y, sig = _decay_data()
    xl = np.linspace(0, 10, x.size)
    yl = 0.5 + 0.2 * xl + (y - _decay(x, np.array([3.0, 2.2, 0.3])))
    w = weights_from_dy(sig, x.size)
    out = curve_fit(xl, yl, _line, [0.0, 0.0], weights=w)
    wls = sm.WLS(yl, sm.add_constant(xl), weights=w).fit()
    resid = yl - (out["params"][0] + out["params"][1] * xl)
    # RMSE: unweighted, in y units -- NOT sqrt(sum(w r^2)/n).
    assert out["RMSE"] == pytest.approx(math.sqrt(np.mean(resid**2)), rel=1e-7)
    assert out["chiSq"] == pytest.approx(float(np.sum(w * resid**2)), rel=1e-7)
    assert out["chiSq"] == pytest.approx(wls.ssr, rel=1e-7)
    assert out["AIC"] == pytest.approx(wls.aic, rel=1e-7)
    assert out["BIC"] == pytest.approx(wls.bic, rel=1e-7)


def test_fit_metrics_perfect_fit_and_tiny_n() -> None:
    m = fit_metrics(np.zeros(10), 2)
    assert m["AIC"] == -math.inf and m["BIC"] == -math.inf
    assert math.isnan(fit_metrics(np.array([0.3]), 1)["AIC"])


# ── finding 2: a start at lo + 1 must not freeze the parameter ─────────────


def test_start_exactly_one_above_lower_bound_moves() -> None:
    x = np.linspace(0.0, 30.0, 80)
    y = _decay(x, np.array([4.0, 6.0, 0.5]))
    # tau starts at lo + 1 = 1 with lo = 0: log(1 + eps) ~ 2e-16 in free space.
    out = curve_fit(x, y, _decay, [3.0, 1.0, 0.0], lower=[-np.inf, 0.0, -np.inf])
    assert out["params"][1] == pytest.approx(6.0, rel=1e-4)
    assert out["exitFlag"] == 1
    assert out["warnings"] == []


@pytest.mark.parametrize("lo", [-5.0, 0.0, 2.0])
def test_start_one_above_any_lower_bound_moves(lo: float) -> None:
    x = np.linspace(-3.0, 3.0, 50)
    true = np.array([2.0, lo + 4.0])
    y = _line(x, true)
    out = curve_fit(x, y, _line, [0.0, lo + 1.0], lower=[-np.inf, lo])
    np.testing.assert_allclose(out["params"], true, rtol=1e-5, atol=1e-7)


def test_start_one_below_upper_bound_moves() -> None:
    x = np.linspace(-3.0, 3.0, 50)
    y = _line(x, np.array([2.0, -3.0]))
    out = curve_fit(x, y, _line, [0.0, 0.0], upper=[np.inf, 1.0])  # 1 - 1 = 0 -> -log(1)
    np.testing.assert_allclose(out["params"], [2.0, -3.0], rtol=1e-5)


@pytest.mark.parametrize("start", [5.0, 1e-9, 10.0 - 1e-9])
def test_two_sided_bounds_midpoint_and_near_edge_starts_converge(start: float) -> None:
    x = np.linspace(-3.0, 3.0, 50)
    y = _line(x, np.array([1.0, 7.0]))
    out = curve_fit(x, y, _line, [0.0, start], lower=[-np.inf, 0.0], upper=[np.inf, 10.0])
    np.testing.assert_allclose(out["params"], [1.0, 7.0], rtol=1e-4)


def test_initial_simplex_matches_scipy_default_off_the_near_zero_case() -> None:
    x0 = np.array([0.0, 2.0, -3.0, 2e-16, 0.0])
    sim = initial_simplex(x0, [False, True, False, True, False])
    assert sim.shape == (6, 5)
    np.testing.assert_array_equal(sim[0], x0)
    assert sim[1, 0] == 0.00025  # scipy's zero rule
    assert sim[2, 1] == 1.05 * 2.0  # scipy's 5 % rule, even when transformed
    assert sim[3, 2] == 1.05 * -3.0
    assert sim[4, 3] == pytest.approx(0.05)  # near-zero transformed: absolute step
    assert sim[5, 4] == 0.00025


def test_stalled_parameter_is_flagged() -> None:
    def cost(p: NDArray[np.float64]) -> float:
        return float((p[0] - 3.0) ** 2 + (p[1] - 1.0) ** 2 + 0.1)

    lo, hi = np.full(2, -np.inf), np.full(2, np.inf)
    # p[0] "never moved" from its start at 1 while the cost slope there is -4.
    start = np.array([1.0, 0.0])
    assert stalled_parameters(cost, np.array([1.0, 1.0]), start, lo, hi, [0, 1]) == [0]
    # At the optimum nothing is stalled, even when it equals the start.
    best = np.array([3.0, 1.0])
    assert stalled_parameters(cost, best, best.copy(), lo, hi, [0, 1]) == []
    # Sitting on an active bound is a legitimate optimum, not a stall.
    assert stalled_parameters(cost, np.array([1.0, 1.0]), np.array([1.0, 1.0]),
                              lo, np.array([1.0, np.inf]), [0, 1]) == []


def test_stalled_fit_is_not_reported_converged(monkeypatch: pytest.MonkeyPatch) -> None:
    """Safety net: with the PRE-FIX simplex (scipy's default, 5 % of a ~2e-16
    coordinate) the start-at-lo+1 fit freezes; it must not claim success."""
    import quantized.calc.fitting as fitting_mod

    def scipy_default(x0: NDArray[np.float64], transformed: list[bool]) -> NDArray[np.float64]:
        return initial_simplex(x0, [False] * len(transformed))

    monkeypatch.setattr(fitting_mod, "initial_simplex", scipy_default)
    x = np.linspace(0.0, 30.0, 80)
    y = _decay(x, np.array([4.0, 6.0, 0.5]))
    out = curve_fit(x, y, _decay, [3.0, 1.0, 0.0], lower=[-np.inf, 0.0, -np.inf])
    assert out["params"][1] == pytest.approx(1.0, abs=1e-12)  # frozen, as before the fix
    assert out["exitFlag"] == 0
    assert len(out["warnings"]) == 1 and "parameter 2" in out["warnings"][0]


def test_large_cost_fit_reports_convergence() -> None:
    """scipy's absolute fatol (1e-12) is below the float spacing of a cost in
    the thousands: the collapsed simplex used to burn the whole evaluation
    budget and return exitFlag 0 for a good fit. fminsearch's 10*eps(f)
    floor (fit_simplex.function_tolerance) ends it."""
    rng = np.random.default_rng(1)
    x = np.linspace(100.0, 200.0, 200)
    y = _gauss(x, np.array([1000.0, 150.0, 5.0, 20.0])) + rng.normal(0, 5, x.size)
    out = curve_fit(x, y, _gauss, [990.0, 149.0, 4.8, 18.0])
    assert out["chiSq"] > 1000  # the regime the floor is for
    assert out["exitFlag"] == 1 and out["nIter"] < 2000
    p_ref, se_ref = _scipy(_gauss, x, y, [990.0, 149.0, 4.8, 18.0])
    np.testing.assert_allclose(out["params"], p_ref, rtol=1e-6)
    np.testing.assert_allclose(out["errors"], se_ref, rtol=1e-5)


def test_perfect_fit_starting_at_the_optimum_is_not_stalled() -> None:
    x = np.linspace(0.0, 30.0, 80)
    y = _decay(x, np.array([4.0, 6.0, 0.5]))
    out = curve_fit(x, y, _decay, [4.0, 6.0, 0.5], lower=[-np.inf, 0.0, -np.inf])
    assert out["exitFlag"] == 1 and out["warnings"] == []


def test_jacobian_stays_inside_the_bounds_near_an_edge() -> None:
    from quantized.calc.fit_covariance import residual_jacobian

    def resid(p: NDArray[np.float64]) -> NDArray[np.float64]:
        with np.errstate(invalid="ignore"):
            return np.asarray(np.sqrt(p[0]) * np.array([1.0, 2.0]) + p[1], dtype=float)

    p = np.array([1e-12, 0.0])
    lo, hi = np.array([0.0, -np.inf]), np.array([np.inf, np.inf])
    jac = residual_jacobian(resid, p, [0, 1], lo, hi)
    assert np.all(np.isfinite(jac))  # central differences would step to sqrt(<0) = NaN
    np.testing.assert_allclose(jac[:, 1], [1.0, 1.0])
    near_top = residual_jacobian(lambda q: np.asarray(np.sqrt(1 - q), dtype=float),
                                 np.array([1 - 1e-12]), [0], np.array([0.0]), np.array([1.0]))
    assert np.all(np.isfinite(near_top))
