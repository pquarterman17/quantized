"""Rank-all-models table: the extra columns (R2adj, reduced chi2, AIC, AICc, BIC, converged).

Known answers computed independently of ``curve_fit``: closed-form OLS for a line (numpy), the
Gaussian log-likelihood by hand, and statsmodels' ``OLS`` information criteria.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.fit_scan import scan_models


def _line_data() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(7)
    x = np.linspace(0.0, 10.0, 40)
    return x, 2.0 * x + 1.0 + rng.normal(0.0, 0.4, x.size)


def _linear_entry() -> tuple[dict, np.ndarray, np.ndarray]:
    x, y = _line_data()
    out = scan_models(x, y, models=["Linear"])
    return out["results"][0], x, y


def test_linear_columns_match_a_hand_computation() -> None:
    e, x, y = _linear_entry()
    n, k = x.size, 2
    coef = np.polyfit(x, y, 1)
    rss = float(np.sum((y - np.polyval(coef, x)) ** 2))
    tss = float(np.sum((y - y.mean()) ** 2))
    log_lik = -n / 2 * (math.log(2 * math.pi * rss / n) + 1)
    aic = 2 * k - 2 * log_lik
    assert e["converged"] is True
    # The simplex stops at its own tolerance, so compare to the closed form loosely.
    np.testing.assert_allclose(e["AIC"], aic, rtol=1e-6, atol=1e-6)
    np.testing.assert_allclose(e["AICc"], aic + 2 * k * (k + 1) / (n - k - 1), rtol=1e-6, atol=1e-6)
    np.testing.assert_allclose(e["BIC"], k * math.log(n) - 2 * log_lik, rtol=1e-6, atol=1e-6)
    np.testing.assert_allclose(e["R2"], 1 - rss / tss, rtol=1e-6)
    np.testing.assert_allclose(e["adjR2"], 1 - (rss / (n - k)) / (tss / (n - 1)), rtol=1e-6)
    np.testing.assert_allclose(e["chiSqRed"], rss / (n - k), rtol=1e-5)


def test_information_criteria_match_statsmodels() -> None:
    sm = pytest.importorskip("statsmodels.api")
    e, x, y = _linear_entry()
    ols = sm.OLS(y, sm.add_constant(x)).fit()
    np.testing.assert_allclose(e["AIC"], ols.aic, rtol=1e-6)
    np.testing.assert_allclose(e["BIC"], ols.bic, rtol=1e-6)
    np.testing.assert_allclose(e["adjR2"], ols.rsquared_adj, rtol=1e-6)
    # statsmodels' aicc: AIC + 2k(k+1)/(n-k-1)
    np.testing.assert_allclose(e["AICc"], ols.aic + 12 / (x.size - 3), rtol=1e-6)


def test_a_failed_model_keeps_null_columns_and_does_not_stop_the_run() -> None:
    x, y = _line_data()
    out = scan_models(x, y, models=["No Such Model", "Linear"])
    ok, bad = out["results"]
    assert ok["name"] == "Linear" and ok["error"] is None
    assert bad["error"] and bad["converged"] is None
    for key in ("adjR2", "chiSqRed", "BIC", "AIC", "AICc"):
        assert bad[key] is None


def test_exactly_determined_fit_reports_no_goodness_of_fit() -> None:
    e = scan_models([0.0, 1.0, 2.0], [1.0, 3.0, 2.0], models=["Quadratic"])["results"][0]
    assert e["k"] == 3
    for key in ("adjR2", "chiSqRed", "BIC", "AIC"):
        assert math.isnan(e[key])


def _hand_weights(aicc: list[float]) -> list[float]:
    """w_i = exp(-d_i / 2) / sum_j exp(-d_j / 2) with d_i = AICc_i - min(AICc)."""
    best = min(aicc)
    rel = [math.exp(-(a - best) / 2.0) for a in aicc]
    return [r / sum(rel) for r in rel]


def test_akaike_weights_match_a_hand_computation_over_the_converged_models() -> None:
    from quantized.calc.fit_scan import _rank

    # An unconverged fit with the LOWEST AICc must not compete: listed and sorted, no weight.
    ok = [
        {"name": n, "AICc": a, "converged": c, "deltaAICc": None, "weight": None}
        for n, a, c in [("A", 10.0, True), ("B", 12.0, True), ("C", 15.0, True), ("U", 7.0, False)]
    ]
    _rank(ok)
    assert [e["name"] for e in ok] == ["U", "A", "B", "C"]  # ascending AICc
    by = {e["name"]: e for e in ok}
    assert by["U"]["weight"] is None and by["U"]["deltaAICc"] is None
    hand = _hand_weights([10.0, 12.0, 15.0])
    np.testing.assert_allclose([by[n]["weight"] for n in "ABC"], hand, rtol=1e-12)
    np.testing.assert_allclose([by[n]["deltaAICc"] for n in "ABC"], [0.0, 2.0, 5.0], rtol=1e-12)
    assert sum(by[n]["weight"] for n in "ABC") == pytest.approx(1.0)
    assert by["A"]["weight"] == pytest.approx(1.0 / (1.0 + math.exp(-1.0) + math.exp(-2.5)))


def test_scan_weights_follow_the_returned_aicc_of_the_converged_rows() -> None:
    x, y = _line_data()
    out = scan_models(x, y, models=["Linear", "Quadratic", "Cubic"])
    conv = [e for e in out["results"] if e["error"] is None and e["converged"] is True]
    assert len(conv) >= 2
    hand = _hand_weights([e["AICc"] for e in conv])
    np.testing.assert_allclose([e["weight"] for e in conv], hand, rtol=1e-9)
    assert conv[0]["deltaAICc"] == pytest.approx(0.0)
    for e in out["results"]:
        if e["error"] is None and e["converged"] is not True:
            assert e["weight"] is None and e["deltaAICc"] is None
