"""fitCompare / residualDiagnostics / fitBands: golden parity vs MATLAB +fitting."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from scipy.stats import t as student_t

from quantized.calc.fit_models import FIT_MODELS
from quantized.calc.fit_stats import fit_bands, fit_compare, residual_diagnostics


@pytest.mark.golden
def test_fit_compare_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_fitcompare.json")
    inp = g["input"]
    out = fit_compare(
        np.asarray(inp["y"], dtype=float),
        np.asarray(inp["residuals"], dtype=float),
        int(inp["nParams"]),
        resid_ref=np.asarray(inp["residRef"], dtype=float),
        n_params_ref=float(inp["nParamsRef"]),
    )
    ref = dict(g["output"])
    # DEPARTURE from the MATLAB golden (fitting audit finding 16; see
    # docs/fitting_statistics.md): one AIC definition project-wide, statsmodels'
    # -2 llf + 2k. MATLAB fitCompare's n*ln(RSS/n) + 2k is that minus the
    # constant n(1 + ln 2*pi); the intended values are frozen here as golden +
    # that constant (n = 80 -> +227.0302), every other field stays golden.
    shift = ref["n"] * (1 + math.log(2 * math.pi))
    assert shift == pytest.approx(227.03016531, rel=1e-9)
    for key in ("aic", "aicc", "bic"):
        ref[key] = ref[key] + shift
    # DEPARTURE 2 (integration review item 1): adjusted R² on the residual dof
    # n - p (p = every fitted parameter), as Origin's NLFit, statsmodels and
    # the fit report compute it; MATLAB fitCompare divided by n - p - 1. The
    # intended value is frozen from the golden R² (n = 80, p = 3).
    n, p = ref["n"], ref["p"]
    ref["adjR2"] = 1 - (1 - ref["R2"]) * (n - 1) / (n - p)
    assert ref["adjR2"] == pytest.approx(0.99962052, rel=1e-6)
    compare_calc(out, ref, rtol=1e-6, atol=1e-9)


@pytest.mark.golden
def test_residual_diagnostics_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_residdiag.json")
    out = residual_diagnostics(np.asarray(g["input"], dtype=float))
    compare_calc(out, g["output"], rtol=1e-6, atol=1e-9)


@pytest.mark.golden
def test_fit_bands_matches_matlab_curve_and_intended_bands(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    """The fitted curve is golden; the bands are a deliberate DEPARTURE.

    MATLAB fitBands has two latent bugs (docs/fitting_statistics.md): its
    prediction variance adds sum(var_ci)/tr(J'J) -- not the residual variance
    -- so the PI was ~4.6x too narrow here, and its t quantile used nFree (3)
    instead of the residual dof nPoints - nFree (77), so the CI was ~1.6x too
    wide. The INTENDED values are frozen inline below (half-widths at grid
    points 0/10/20/30, MSE = the same fit's golden chiSqRed); the MATLAB
    golden values they replace are kept beside them for the record.
    """
    g = load_golden("calc_fitbands.json")
    inp = g["input"]
    mse = load_golden("calc_curvefit_gauss.json")["output"]["chiSqRed"]  # same fit
    out = fit_bands(
        np.asarray(inp["xGrid"], dtype=float),
        FIT_MODELS["Gaussian"]["fcn"],
        np.asarray(inp["params"], dtype=float),
        np.asarray(inp["covar"], dtype=float),
        int(inp["nPoints"]),
        int(inp["nFree"]),
        mse=mse,
    )
    compare_calc({"yFit": out["yFit"]}, {"yFit": g["output"]["yFit"]}, rtol=1e-6, atol=1e-9)
    y = out["yFit"]
    idx = [0, 10, 20, 30]
    # intended (this port)            MATLAB golden (buggy)
    ci = [2.9966557e-11, 9.4189917e-04, 2.2594050e-02, 2.9375361e-04]
    # MATLAB ci: 4.7892906e-11, 1.5053544e-03, 3.6110077e-02, 4.6948049e-04
    pi = [5.9313577e-02, 5.9321055e-02, 6.3471186e-02, 5.9314304e-02]
    # MATLAB pi: 1.2944175e-02, 1.3031414e-02, 3.8359997e-02, 1.2952686e-02
    np.testing.assert_allclose((out["ciHi"] - y)[idx], ci, rtol=1e-6)
    np.testing.assert_allclose((y - out["ciLo"])[idx], ci, rtol=1e-6)
    np.testing.assert_allclose((out["piHi"] - y)[idx], pi, rtol=1e-6)
    np.testing.assert_allclose((y - out["piLo"])[idx], pi, rtol=1e-6)
    # Far from the peak the curve is pinned, so PI -> t * sqrt(MSE).
    assert (out["piHi"] - y)[0] == pytest.approx(student_t.ppf(0.975, 77) * math.sqrt(mse))


def test_fit_compare_perfect_fit() -> None:
    y = np.linspace(0.0, 10.0, 50)
    out = fit_compare(y, np.zeros(50), 2)
    assert out["R2"] == pytest.approx(1.0)
    assert out["aic"] == float("-inf")  # perfect fit -> -Inf


def test_residual_diagnostics_white_noise_structure() -> None:
    rng = np.random.default_rng(0)
    r = rng.normal(size=200)
    d = residual_diagnostics(r)
    assert d["nPos"] + d["nNeg"] == 200
    assert 1.5 < d["durbinWatson"] < 2.5  # uncorrelated -> DW near 2
    assert len(d["qqX"]) == 200


def test_fit_bands_ci_inside_pi() -> None:
    x = np.linspace(0.0, 20.0, 30)
    params = np.array([5.0, 10.0, 2.0])
    covar = np.diag([0.01, 0.001, 0.001])
    b = fit_bands(x, FIT_MODELS["Gaussian"]["fcn"], params, covar, 80, 3, mse=0.01)
    assert np.all(b["ciHi"] <= b["piHi"] + 1e-12)  # CI band inside PI band
    assert np.all(b["ciLo"] >= b["piLo"] - 1e-12)
    assert np.all(b["ciHi"] >= b["ciLo"])


def test_adjusted_r2_matches_statsmodels_and_the_fit_report() -> None:
    """Integration review item 1: one adjusted R² (n - p), equal to statsmodels'
    OLS rsquared_adj and to calc.fit_report's for the same fit."""
    import statsmodels.api as sm

    from quantized.calc.fit_report import fit_report

    rng = np.random.default_rng(3)
    x = np.linspace(0.0, 10.0, 25)
    y = 1.3 * x + 0.4 + rng.normal(0.0, 1.0, x.size)
    res = sm.OLS(y, sm.add_constant(x)).fit()
    resid = y - res.fittedvalues
    out = fit_compare(y, resid, 2)
    rep = fit_report(list(res.params), list(res.bse), None, list(y), list(resid), 2)
    assert out["adjR2"] == pytest.approx(res.rsquared_adj, rel=1e-12)
    assert rep["stats"]["adjR2"] == pytest.approx(out["adjR2"], rel=1e-12)
