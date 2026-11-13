"""Regression tests for the independent review of the fitting-audit commit.

Each test names the review item it pins. References are scipy / statsmodels.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
import statsmodels.api as sm
from numpy.typing import NDArray
from scipy import special
from scipy.optimize import curve_fit as scipy_curve_fit

from quantized.calc.batch_fit import batch_fit
from quantized.calc.fit_covariance import residual_jacobian
from quantized.calc.fit_equation import (
    equation_model,
    parse_equation,
    positive_even_params,
)
from quantized.calc.fit_equation_init import MAX_MODEL_EVALS, MAX_POINTS, auto_start
from quantized.calc.fit_stats import fit_bands, fit_compare, observation_variance_on_grid
from quantized.calc.fitting import curve_fit, weights_from_dy
from quantized.calc.global_curve_fit import global_curve_fit
from quantized.calc.global_fit import global_fit


def _line(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] + p[1] * x, dtype=float)


def _gauss_off(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-((x - p[1]) ** 2) / (2 * p[2] ** 2)) + p[3], dtype=float)


def _exp(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-x / p[1]) + p[2], dtype=float)


# ── item 1: weighted prediction band is per-point ──────────────────────────


def test_weighted_prediction_band_matches_statsmodels_wls_per_point() -> None:
    rng = np.random.default_rng(31)
    x = np.linspace(0.0, 20.0, 81)
    dy = 0.1 + 0.3 * x
    y = 1.0 + 0.5 * x + rng.normal(0, 1, x.size) * dy
    w = weights_from_dy(dy, x.size)
    fit = curve_fit(x, y, _line, [0.0, 0.0], weights=w)
    var_grid = observation_variance_on_grid(x, fit["obsVar"], x)
    b = fit_bands(x, _line, fit["params"], fit["covar"], fit["nPoints"], fit["nFree"],
                  mse=var_grid)
    wls = sm.WLS(y, sm.add_constant(x), weights=w).fit()
    frame = wls.get_prediction(sm.add_constant(x), weights=w).summary_frame(alpha=0.05)
    # atol: one limit crosses zero, where a 1e-6 RELATIVE test means nothing.
    np.testing.assert_allclose(b["piLo"], frame["obs_ci_lower"], rtol=1e-6, atol=1e-7)
    np.testing.assert_allclose(b["piHi"], frame["obs_ci_upper"], rtol=1e-6, atol=1e-7)
    np.testing.assert_allclose(b["ciHi"], frame["mean_ci_upper"], rtol=1e-6, atol=1e-7)
    half = (b["piHi"] - b["piLo"]) / 2
    assert half[-1] > 10 * half[0]  # the band widens with the error bars, not constant


def test_observation_variance_interpolates_and_holds_the_ends() -> None:
    xd = np.array([3.0, 1.0, 2.0, 2.0])  # unsorted, one duplicate x
    vd = np.array([9.0, 1.0, 3.0, 5.0])
    got = observation_variance_on_grid(xd, vd, np.array([0.0, 1.0, 1.5, 2.0, 2.5, 3.0, 9.0]))
    np.testing.assert_allclose(got, [1.0, 1.0, 2.5, 4.0, 6.5, 9.0, 9.0])
    # Zero-weight points (infinite variance) are not observations: skipped.
    got = observation_variance_on_grid([0.0, 1.0, 2.0], [1.0, np.inf, 3.0], [1.0])
    np.testing.assert_allclose(got, [2.0])


def test_repeated_x_rows_keep_their_own_variance_on_the_fitted_x() -> None:
    """Integration review item 5: repeated x with unequal weights. On the
    fitted x itself (the result worksheet's PI columns) each row keeps its own
    variance, matching statsmodels WLS row for row; a separate grid gets the
    mean at that x."""
    rng = np.random.default_rng(8)
    x = np.repeat(np.linspace(0.0, 10.0, 15), 2)
    dy = np.tile([0.2, 1.5], 15)
    y = 1.0 + 0.5 * x + rng.normal(0, 1, x.size) * dy
    w = weights_from_dy(dy, x.size)
    fit = curve_fit(x, y, _line, [0.0, 0.0], weights=w)
    var_rows = observation_variance_on_grid(x, fit["obsVar"], x)
    np.testing.assert_allclose(var_rows, fit["obsVar"])
    b = fit_bands(x, _line, fit["params"], fit["covar"], fit["nPoints"], fit["nFree"], mse=var_rows)
    wls = sm.WLS(y, sm.add_constant(x), weights=w).fit()
    frame = wls.get_prediction(sm.add_constant(x), weights=w).summary_frame(alpha=0.05)
    np.testing.assert_allclose(b["piHi"], frame["obs_ci_upper"], rtol=1e-6, atol=1e-7)
    grid = observation_variance_on_grid(x, fit["obsVar"], np.array([x[0]]))
    assert grid[0] == pytest.approx(np.mean(fit["obsVar"][:2]))


def test_absolute_sigma_obs_var_is_the_error_bar_squared() -> None:
    x = np.linspace(0.0, 5.0, 12)
    dy = 0.2 + 0.1 * x
    fit = curve_fit(x, 2 * x + np.sin(7 * x) * dy, _line, [0.0, 1.0],
                    weights=weights_from_dy(dy, x.size), scale_errors=False)
    np.testing.assert_allclose(fit["obsVar"], dy**2)


# ── item 2: zero-weight points are not observations ────────────────────────


def test_zero_weight_points_do_not_count_toward_n_or_dof() -> None:
    rng = np.random.default_rng(4)
    x = np.linspace(0.0, 10.0, 25)
    y = 1.0 + 2.0 * x + rng.normal(0, 0.5, x.size)
    w = np.ones(25)
    w[::5] = 0.0  # five points switched off
    y_bad = y.copy()
    y_bad[::5] += 100.0  # ...so their values cannot matter
    keep = w > 0
    full = curve_fit(x, y_bad, _line, [0.0, 0.0], weights=w)
    sub = curve_fit(x[keep], y[keep], _line, [0.0, 0.0])
    ols = sm.OLS(y[keep], sm.add_constant(x[keep])).fit()
    assert full["nPoints"] == 20
    np.testing.assert_allclose(full["errors"], ols.bse, rtol=1e-6)
    for key in ("chiSqRed", "AIC", "AICc", "BIC", "R2"):
        assert full[key] == pytest.approx(sub[key], rel=1e-8), key
    assert full["RMSE"] == pytest.approx(sub["RMSE"], rel=1e-8)  # over fitted points only
    cmp_ = fit_compare(y_bad, full["residuals"], 2, weights=w)
    assert cmp_["n"] == 20 and cmp_["aic"] == pytest.approx(ols.aic, rel=1e-8)


# ── item 3: a start exactly ON a bound ─────────────────────────────────────


def _gauss_data() -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    x = np.linspace(0.0, 20.0, 120)
    return x, _gauss_off(x, np.array([5.0, 10.0, 1.5, 0.5]))


def test_start_on_an_upper_bound_moves() -> None:
    x, y = _gauss_data()
    out = curve_fit(x, y, _gauss_off, [4.0, 9.5, 1.0, 4.0], upper=[np.inf, np.inf, np.inf, 4.0])
    assert out["params"][3] == pytest.approx(0.5, abs=1e-5)
    assert out["R2"] > 0.999999 and out["exitFlag"] == 1 and out["warnings"] == []


def test_start_on_a_lower_bound_and_two_sided_bounds_move() -> None:
    x, y = _gauss_data()
    lo = curve_fit(x, y, _gauss_off, [4.0, 9.5, 1.0, -3.0], lower=[-np.inf] * 3 + [-3.0])
    assert lo["params"][3] == pytest.approx(0.5, abs=1e-5) and lo["exitFlag"] == 1
    for start in (-3.0, 4.0):
        two = curve_fit(x, y, _gauss_off, [4.0, 9.5, 1.0, start],
                        lower=[-np.inf] * 3 + [-3.0], upper=[np.inf] * 3 + [4.0])
        assert two["params"][3] == pytest.approx(0.5, abs=1e-5) and two["exitFlag"] == 1


def test_a_genuinely_active_bound_is_not_a_stall() -> None:
    x, y = _gauss_data()  # offset truth 0.5, but capped at 0.2: the bound is active
    out = curve_fit(x, y, _gauss_off, [4.0, 9.5, 1.0, 0.2], upper=[np.inf, np.inf, np.inf, 0.2])
    assert out["params"][3] == pytest.approx(0.2, abs=1e-6)
    assert out["warnings"] == [] and out["exitFlag"] == 1


def test_global_fit_start_on_a_bound_moves() -> None:
    x = np.linspace(0.0, 10.0, 60)
    ys = [_exp(x, np.array([a, 2.0, 0.5])) for a in (3.0, 5.0)]
    out = global_curve_fit([(x, y) for y in ys], _exp, ["A", "tau", "C"],
                           [{"param_name": "tau", "datasets": [0, 1]}],
                           init_guess=[1.0, 1.0, 4.0], upper=[np.inf, np.inf, 4.0])
    np.testing.assert_allclose(np.array(out["params"])[:, 2], 0.5, atol=1e-5)
    assert out["exitFlag"] == 1


# ── item 14: Jacobian step for a parameter that happens to be ~0 ───────────


def test_jtj_errors_exact_for_a_near_zero_parameter() -> None:
    rng = np.random.default_rng(12)
    x = np.linspace(0.0, 10.0, 60)
    y = 2.0 + 3.8e-6 * x + rng.normal(0, 0.3, x.size)  # slope truth ~0 on a unit scale
    ols = sm.OLS(y, sm.add_constant(x)).fit()
    p = np.asarray(ols.params, dtype=float)
    jac = residual_jacobian(lambda q: y - _line(x, q), p, [0, 1])
    np.testing.assert_allclose(jac, -sm.add_constant(x), rtol=1e-8, atol=1e-10)
    out = curve_fit(x, y, _line, [1.0, 0.1])
    np.testing.assert_allclose(out["errors"], ols.bse, rtol=1e-6)
    tiny = residual_jacobian(lambda q: y - _line(x, q), np.array([2.0, 3.8e-6]), [1])
    np.testing.assert_allclose(tiny[:, 0], -x, rtol=1e-8, atol=1e-10)


# ── item 6: voigt is only defined for non-negative widths ──────────────────


def test_voigt_uses_width_magnitudes_and_fits_report_positive_widths() -> None:
    fcn, names = parse_equation("voigt(x, s, g)")
    assert names == ["s", "g"]
    xs = np.linspace(-1, 1, 5)
    want = special.voigt_profile(xs, 0.5, 0.3)
    for s_, g_ in ((0.5, 0.3), (-0.5, 0.3), (0.5, -0.3), (-0.5, -0.3)):
        np.testing.assert_allclose(fcn(xs, np.array([s_, g_])), want, rtol=1e-14)

    x = np.linspace(0.0, 10.0, 200)
    y = 30 * special.voigt_profile(x - 6.2, 0.3, 0.2) + 1
    model, mnames = equation_model("A*voigt(x-xc, s, g) + b")
    # This start used to converge on sigma = -0.3 (scipy) or stick at 0 (a NaN wall).
    out = curve_fit(x, y, model, [20.0, 6.0, 0.05, 0.5, 0.0])
    assert out["R2"] > 0.999999 and out["params"][2] == pytest.approx(-0.3, abs=1e-4)
    cov_before = np.asarray(out["covar"]).copy()
    assert positive_even_params(model, x, out) == [2]
    np.testing.assert_allclose(out["params"], [30, 6.2, 0.3, 0.2, 1], atol=1e-4)
    np.testing.assert_allclose(out["covar"][2, 3], -cov_before[2, 3])
    np.testing.assert_allclose(np.diag(out["covar"]), np.diag(cov_before))
    # Not even in the amplitude or the centre: those signs are real and stay.
    neg = curve_fit(x, -y, model, [-20.0, 6.0, 0.3, 0.2, -1.0])
    assert positive_even_params(model, x, neg) == [] and neg["params"][0] < 0
    # A held negative width, or one whose flip leaves its bounds, is left alone.
    held = {"params": np.array([30.0, 6.2, -0.3, 0.2, 1.0]), "covar": None}
    assert positive_even_params(model, x, held, fixed=[False, False, True, False, False]) == []
    assert positive_even_params(model, x, held, upper=[np.inf, np.inf, 0.0, np.inf, np.inf]) == []
    assert len(mnames) == 5


def test_undefined_model_at_the_start_is_reported_not_fitted() -> None:
    x = np.linspace(1.0, 5.0, 30)
    model, _ = equation_model("a*log(b*x)")
    bad = curve_fit(x, np.log(2 * x), model, [1.0, -2.0], upper=[np.inf, -1.0])
    assert bad["exitFlag"] == 0 and any("undefined" in w for w in bad["warnings"])


# ── item 5: auto_start is bounded by counts, not wall-clock ────────────────


def test_auto_start_caps_points_and_model_evaluations() -> None:
    eqn = "a*exp(-(x-b)^2/(2*c^2)) + d*exp(-(x-m)^2/(2*f^2)) + g + h*x + k*x^2"
    fcn, names = equation_model(eqn)
    assert len(names) == 9
    rng = np.random.default_rng(0)
    x = np.linspace(0.0, 100.0, 200_000)
    y = fcn(x, np.array([5, 30, 3, 8, 70, 5, 1, 0.01, 1e-4])) + rng.normal(0, 0.2, x.size)
    calls: list[int] = []

    def counted(xx: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
        calls.append(np.asarray(xx).size)
        return fcn(xx, pp)

    p0 = auto_start(counted, names, x, y)
    assert len(p0) == 9 and all(math.isfinite(v) for v in p0)
    assert max(calls) <= MAX_POINTS < 200_000
    assert len(calls) <= MAX_MODEL_EVALS
    assert auto_start(counted, names, x, y) == p0  # deterministic subsample + seed


# ── item 9: global-fit RMSE is unweighted, in data units ───────────────────


def test_global_fit_rmse_is_unweighted() -> None:
    rng = np.random.default_rng(2)
    x = np.linspace(0.0, 10.0, 50)
    dy = 0.05 + 0.02 * x
    ys = [_exp(x, np.array([a, 2.0, 0.5])) + rng.normal(0, 1, x.size) * dy for a in (3.0, 5.0)]
    out = global_curve_fit([(x, y) for y in ys], _exp, ["A", "tau", "C"],
                           [{"param_name": "tau", "datasets": [0, 1]}],
                           init_guess=[1.0, 1.5, 0.0],
                           weights=[weights_from_dy(dy, x.size)] * 2)
    for k in range(2):
        res = np.asarray(out["residuals"][k])
        assert out["RMSE"][k] == pytest.approx(math.sqrt(np.mean(res**2)), rel=1e-12)
        assert out["chiSq"][k] == pytest.approx(float(np.sum(res**2 / dy**2)), rel=1e-12)


# ── item 12: both error estimates from every fitter ────────────────────────


def test_batch_and_global_fits_return_both_error_estimates() -> None:
    rng = np.random.default_rng(8)
    x = np.linspace(0.0, 10.0, 50)
    ys = [_exp(x, np.array([a, 2.0, 0.5])) + rng.normal(0, 0.05, x.size) for a in (3.0, 5.0)]
    data = [(x, y) for y in ys]

    b = batch_fit(data, _exp, [1.0, 1.5, 0.0])
    bh = batch_fit(data, _exp, [1.0, 1.5, 0.0], covariance="hessian")
    np.testing.assert_allclose(b["errors"], b["errorsJtj"])
    np.testing.assert_allclose(bh["errors"], b["errorsHessian"], rtol=1e-9)
    for i, y in enumerate(ys):
        _, c = scipy_curve_fit(lambda xx, *pp: _exp(xx, np.array(pp)), x, y, p0=[1, 1.5, 0],
                               ftol=1e-15, xtol=1e-15, gtol=1e-15)
        np.testing.assert_allclose(b["errorsJtj"][i], np.sqrt(np.diag(c)), rtol=1e-5)

    g = global_fit(data, _exp, [1.0, 1.5, 0.0], [False, True, True])
    gh = global_fit(data, _exp, [1.0, 1.5, 0.0], [False, True, True], covariance="hessian")
    np.testing.assert_allclose(g["sharedErrors"], g["sharedErrorsJtj"])
    np.testing.assert_allclose(gh["sharedErrors"], g["sharedErrorsHessian"], rtol=1e-9)
    np.testing.assert_allclose(gh["perErrors"], g["perErrorsHessian"], rtol=1e-9)
    np.testing.assert_allclose(g["perErrors"], g["perErrorsJtj"])

    cons = [{"param_name": "tau", "datasets": [0, 1]}]
    c = global_curve_fit(data, _exp, ["A", "tau", "C"], cons, init_guess=[1.0, 1.5, 0.0])
    ch = global_curve_fit(data, _exp, ["A", "tau", "C"], cons, init_guess=[1.0, 1.5, 0.0],
                          covariance="hessian")
    np.testing.assert_allclose(c["errors"], c["errorsJtj"])
    np.testing.assert_allclose(ch["errors"], c["errorsHessian"], rtol=1e-9)
    assert c["shared"][0]["errorJtj"] == c["shared"][0]["error"]
    assert c["shared"][0]["errorHessian"] == pytest.approx(ch["shared"][0]["error"], rel=1e-9)


def test_a_fit_worse_than_a_constant_is_not_reported_converged() -> None:
    """Found driving the real app: a Gaussian started at centre 0 on data
    peaked at 10 collapsed to a spike between samples -- R² = -0.85, and the
    result said exitFlag 1 with no warning."""
    x = np.linspace(0.0, 20.0, 201)
    y = 5 * np.exp(-((x - 10.0) ** 2) / (2 * 1.5**2)) + 0.5

    def gauss(xx: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(p[0] * np.exp(-((xx - p[1]) ** 2) / (2 * p[2] ** 2)), dtype=float)

    out = curve_fit(x, y, gauss, [8.0, 0.0, 1.0], lower=[-np.inf, -np.inf, 0.0],
                    upper=[8.0, np.inf, np.inf])
    if out["R2"] < 0:
        assert out["exitFlag"] == 0 and any("worse than a constant" in w for w in out["warnings"])
    else:  # if a future optimizer finds the peak, it must simply be right
        assert out["exitFlag"] == 1 and out["R2"] > 0.9
    good = curve_fit(x, y, gauss, [4.0, 9.0, 1.0])
    assert good["exitFlag"] == 1 and good["warnings"] == []
