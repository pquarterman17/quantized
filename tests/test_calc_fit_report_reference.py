"""End-to-end fit report vs independent references (integration review).

``tests/test_calc_fit_report.py`` feeds ``fit_report`` statsmodels' own
parameters and standard errors, which checks the report's arithmetic. These
tests run the REAL pipeline the panel uses instead — ``calc.fitting.curve_fit``
then ``fit_report`` on its output — against references computed another way:

* a straight line (through the nonlinear fitter) against statsmodels OLS/WLS;
* an exponential decay against ``scipy.optimize.curve_fit`` plus hand-built
  t / confidence-limit / NLFit-ANOVA numbers.

The parameter values agree to ~1e-8. The standard errors agree to a few parts
in a thousand, not to rounding: ``curve_fit`` inverts the numerical Hessian of
the cost (second-derivative terms included) while statsmodels and scipy use the
Gauss-Newton ``J'J``. Measured 2026-11-13: <= 3e-3 relative on these data, so
the bound below is 5e-3; the sums of squares and F do not depend on the
covariance and agree to rounding.
"""

from __future__ import annotations

import numpy as np
import pytest
import statsmodels.api as sm
from numpy.typing import NDArray
from scipy import optimize, stats

from quantized.calc.fit_models import evaluate
from quantized.calc.fit_report import fit_report
from quantized.calc.fitting import curve_fit

SE_RTOL = 5e-3


def _decay(x: NDArray[np.float64], a: float, tau: float, c: float) -> NDArray[np.float64]:
    return np.asarray(a * np.exp(-x / tau) + c, dtype=float)


@pytest.mark.parametrize("weighted", [False, True])
def test_line_through_the_nonlinear_fitter_matches_statsmodels(weighted: bool) -> None:
    rng = np.random.default_rng(3)
    x = np.linspace(-2.0, 6.0, 30)
    sigma = 0.3 + 0.1 * np.abs(x)
    y = 0.8 * x + 2.5 + rng.normal(0.0, sigma)
    w = 1.0 / sigma**2 if weighted else None
    res = curve_fit(x, y, lambda xx, pp: evaluate("Linear", xx, pp), [1.0, 1.0], weights=w)
    rep = fit_report(
        res["params"], res["errors"], res["covar"], y, res["residuals"], res["nFree"], weights=w
    )

    design = np.column_stack([x, np.ones_like(x)])
    ref = sm.WLS(y, design, weights=1.0 if w is None else w, hasconst=False).fit()
    centered = sm.WLS(y, design, weights=1.0 if w is None else w, hasconst=True).fit()
    ci = ref.conf_int(alpha=0.05)
    for i, row in enumerate(rep["parameters"]):
        assert row["value"] == pytest.approx(ref.params[i], rel=1e-6)
        assert row["error"] == pytest.approx(ref.bse[i], rel=SE_RTOL)
        assert row["t"] == pytest.approx(ref.tvalues[i], rel=SE_RTOL)
        assert row["lcl"] == pytest.approx(ci[i, 0], rel=SE_RTOL)
        assert row["ucl"] == pytest.approx(ci[i, 1], rel=SE_RTOL)
    reg, resid, unc, cor = rep["anova"]
    assert (reg["df"], resid["df"], unc["df"], cor["df"]) == (2, 28, 30, 29)
    assert resid["ss"] == pytest.approx(ref.ssr, rel=1e-9)
    assert reg["ss"] == pytest.approx(ref.ess, rel=1e-9)
    assert reg["f"] == pytest.approx(ref.fvalue, rel=1e-8)
    assert cor["ss"] == pytest.approx(centered.centered_tss, rel=1e-9)
    assert rep["stats"]["R2"] == pytest.approx(centered.rsquared, rel=1e-9)
    assert rep["stats"]["adjR2"] == pytest.approx(centered.rsquared_adj, rel=1e-9)
    # The report's R² is the one the panel's headline shows.
    assert rep["stats"]["R2"] == pytest.approx(res["R2"], rel=1e-12)
    assert rep["stats"]["reducedChiSq"] == pytest.approx(res["chiSqRed"], rel=1e-12)


@pytest.mark.parametrize("weighted", [False, True])
def test_exponential_decay_matches_scipy_and_hand_built_anova(weighted: bool) -> None:
    rng = np.random.default_rng(11)
    x = np.linspace(0.5, 9.0, 50)
    sigma = 0.05 + 0.02 * x
    y = _decay(x, 3.0, 2.0, 0.4) + rng.normal(0.0, sigma)
    w = 1.0 / sigma**2 if weighted else None
    res = curve_fit(
        x, y, lambda xx, pp: evaluate("Exponential Decay", xx, pp), [2.5, 1.5, 0.3], weights=w
    )
    rep = fit_report(
        res["params"], res["errors"], res["covar"], y, res["residuals"], res["nFree"],
        weights=w, level=0.9,
    )

    popt, pcov = optimize.curve_fit(
        _decay, x, y, [2.5, 1.5, 0.3], sigma=sigma if weighted else None,
        absolute_sigma=False, xtol=1e-14, ftol=1e-14,
    )
    se = np.sqrt(np.diag(pcov))
    n, p = x.size, 3
    dof = n - p
    t_crit = stats.t.ppf(0.95, dof)
    for i, row in enumerate(rep["parameters"]):
        assert row["value"] == pytest.approx(popt[i], rel=1e-6)
        assert row["error"] == pytest.approx(se[i], rel=SE_RTOL)
        assert row["t"] == pytest.approx(popt[i] / se[i], rel=SE_RTOL)
        assert row["prob"] == pytest.approx(
            2 * stats.t.sf(abs(popt[i] / se[i]), dof), rel=0.2, abs=1e-300
        )
        assert row["lcl"] == pytest.approx(popt[i] - t_crit * se[i], rel=SE_RTOL)
        assert row["ucl"] == pytest.approx(popt[i] + t_crit * se[i], rel=SE_RTOL)

    ww = np.ones_like(x) if w is None else w
    resid = y - _decay(x, *popt)
    rss = float(np.sum(ww * resid**2))
    unc = float(np.sum(ww * y**2))
    mean = float(np.sum(ww * y) / np.sum(ww))
    cor = float(np.sum(ww * (y - mean) ** 2))
    f_ref = ((unc - rss) / p) / (rss / dof)
    reg_row, res_row, unc_row, cor_row = rep["anova"]
    assert (reg_row["df"], res_row["df"], unc_row["df"], cor_row["df"]) == (p, dof, n, n - 1)
    assert res_row["ss"] == pytest.approx(rss, rel=1e-9)
    assert unc_row["ss"] == pytest.approx(unc, rel=1e-12)
    assert cor_row["ss"] == pytest.approx(cor, rel=1e-12)
    assert reg_row["ss"] == pytest.approx(unc - rss, rel=1e-9)
    assert reg_row["ms"] == pytest.approx((unc - rss) / p, rel=1e-9)
    assert res_row["ms"] == pytest.approx(rss / dof, rel=1e-9)
    assert reg_row["f"] == pytest.approx(f_ref, rel=1e-8)
    assert reg_row["prob"] == pytest.approx(stats.f.sf(f_ref, p, dof), rel=1e-6, abs=1e-300)
    s = rep["stats"]
    assert (s["n"], s["dof"]) == (n, dof)
    assert s["R2"] == pytest.approx(1 - rss / cor, rel=1e-9)
    assert s["adjR2"] == pytest.approx(1 - (rss / dof) / (cor / (n - 1)), rel=1e-9)
    assert s["rootMSE"] == pytest.approx(np.sqrt(rss / dof), rel=1e-9)
    corr = np.asarray(rep["correlation"], dtype=float)
    np.testing.assert_allclose(corr, pcov / np.outer(se, se), atol=5e-3)
    np.testing.assert_allclose(np.diag(corr), 1.0, atol=1e-12)
