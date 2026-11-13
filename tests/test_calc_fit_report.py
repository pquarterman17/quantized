"""calc.fit_report vs statsmodels: t, Prob>|t|, confidence limits, ANOVA.

A straight line fit by OLS/WLS is a least-squares fit whose inference
statsmodels computes independently, so it is the reference. The ANOVA uses
NLFit's *uncorrected* regression decomposition, which is exactly statsmodels'
no-constant convention (``hasconst=False``: ``ess`` = uncentered TSS - SSR on
k df), while R² is the usual centered one (``hasconst=True``).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
import statsmodels.api as sm

from quantized.calc.fit_report import (
    anova_table,
    correlation_matrix,
    fit_report,
    parameter_inference,
)


def _data(weighted: bool) -> tuple[np.ndarray, np.ndarray, np.ndarray | None]:
    rng = np.random.default_rng(7)
    x = np.linspace(0.0, 10.0, 40)
    sigma = 0.2 + 0.05 * x
    y = 1.7 * x - 0.6 + rng.normal(0.0, sigma)
    return x, y, (1.0 / sigma**2 if weighted else None)


@pytest.mark.parametrize("weighted", [False, True])
@pytest.mark.parametrize("level", [0.95, 0.90, 0.99])
def test_matches_statsmodels(weighted: bool, level: float) -> None:
    x, y, w = _data(weighted)
    design = np.column_stack([x, np.ones_like(x)])
    model = sm.WLS(y, design, weights=w if w is not None else 1.0, hasconst=False)
    res = model.fit()
    centered = sm.WLS(y, design, weights=w if w is not None else 1.0, hasconst=True).fit()
    resid = y - design @ res.params

    out = fit_report(
        list(res.params), list(res.bse), res.cov_params().tolist(), list(y), list(resid), 2,
        weights=None if w is None else list(w), level=level,
    )
    ci = res.conf_int(alpha=1 - level)
    for i, row in enumerate(out["parameters"]):
        assert row["t"] == pytest.approx(res.tvalues[i], rel=1e-10)
        assert row["prob"] == pytest.approx(res.pvalues[i], rel=1e-8, abs=1e-300)
        assert row["lcl"] == pytest.approx(ci[i, 0], rel=1e-10)
        assert row["ucl"] == pytest.approx(ci[i, 1], rel=1e-10)

    reg, resid_row, unc, cor = out["anova"]
    assert reg["df"] == 2 and resid_row["df"] == 38 and unc["df"] == 40 and cor["df"] == 39
    assert reg["ss"] == pytest.approx(res.ess, rel=1e-10)
    assert resid_row["ss"] == pytest.approx(res.ssr, rel=1e-10)
    assert reg["f"] == pytest.approx(res.fvalue, rel=1e-10)
    assert reg["prob"] == pytest.approx(res.f_pvalue, rel=1e-6, abs=1e-300)
    assert cor["ss"] == pytest.approx(centered.centered_tss, rel=1e-10)

    s = out["stats"]
    assert s["n"] == 40 and s["dof"] == 38
    assert s["R2"] == pytest.approx(centered.rsquared, rel=1e-10)
    assert s["adjR2"] == pytest.approx(centered.rsquared_adj, rel=1e-10)
    assert s["reducedChiSq"] == pytest.approx(res.mse_resid, rel=1e-10)
    assert s["rootMSE"] == pytest.approx(math.sqrt(res.mse_resid), rel=1e-10)

    corr = np.asarray(out["correlation"], dtype=float)
    cov = res.cov_params()
    sd = np.sqrt(np.diag(cov))
    np.testing.assert_allclose(corr, cov / np.outer(sd, sd), rtol=1e-12)
    np.testing.assert_allclose(np.asarray(out["covariance"]), cov, rtol=1e-14)


def test_held_parameter_gets_null_inference() -> None:
    rows = parameter_inference([2.0, 5.0], [0.1, float("nan")], dof=10)
    assert rows[0]["t"] == pytest.approx(20.0)
    held = {"value": 5.0, "error": None, "t": None, "prob": None, "lcl": None, "ucl": None}
    assert rows[1] == held
    corr = correlation_matrix([[0.01, 0.0], [0.0, 0.0]])
    assert corr is not None
    assert corr[0][0] == pytest.approx(1.0) and corr[0][1] is None and corr[1] == [None, None]


def test_no_residual_dof_has_no_inference_or_f() -> None:
    rows = parameter_inference([1.0], [0.5], dof=0)
    assert rows[0]["t"] is None and rows[0]["lcl"] is None
    table = anova_table([1.0, 2.0], [0.0, 0.0], n_free=2)
    assert table[0]["f"] is None and table[0]["prob"] is None and table[1]["ms"] is None


def test_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError, match="level"):
        parameter_inference([1.0], [0.1], dof=3, level=1.0)
    with pytest.raises(ValueError, match="errors"):
        parameter_inference([1.0, 2.0], [0.1], dof=3)
    with pytest.raises(ValueError, match="residuals"):
        anova_table([1.0, 2.0], [0.1], n_free=1)
    with pytest.raises(ValueError, match="square"):
        correlation_matrix([[1.0, 2.0]])
    assert correlation_matrix(None) is None
