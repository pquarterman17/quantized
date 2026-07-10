"""Tests for GLM (logistic & Poisson regression) — gap #30.

Contract: ``predictors`` is a list of *k column* arrays (same convention as
``calc.stats_multivar._as_matrix`` / ``multiple_regression`` — the "house
style" for every multi-predictor calc function), not a list of row records.
A 2-predictor, 3-observation design is ``[[x1_a, x1_b, x1_c], [x2_a, x2_b,
x2_c]]``, never ``[[x1_a, x2_a], [x1_b, x2_b], [x1_c, x2_c]]``.

Reference values from real, published, non-degenerate datasets (never a toy
perfect-separation fit — statsmodels cannot produce stable coefficients
there):
- Logistic: Spector & Mazzeo (1980) PSI teaching-method data, as reproduced
  in William Greene's "Econometric Analysis" and bundled directly with
  statsmodels (``sm.datasets.spector``); this is also the dataset used in
  statsmodels' own discrete-choice-models example notebook. Published
  coefficients (Greene): const=-13.021, GPA=2.826, TUCE=0.0952, PSI=2.379,
  McFadden pseudo-R²=0.374 — reproduced exactly below.
- Poisson: RAND Health Insurance Experiment data (Cameron & Trivedi,
  "Microeconometrics: Methods and Applications", 2005), bundled with
  statsmodels (``sm.datasets.randhie``). The full 20190-row set is too large
  to assert tight reference values against reliably across BLAS/platform
  variation for a unit test, so a fixed first-500-row slice is used — real,
  unaltered data, not fabricated. Reference coefficients below were computed
  once via this module and are stable (deterministic Newton-Raphson MLE on
  fixed, well-conditioned data).
"""

from __future__ import annotations

import sys

import numpy as np
import pytest

pytestmark = pytest.mark.skipif(
    pytest.importorskip("statsmodels", minversion="0.14") is None, reason="requires statsmodels"
)


def _synthetic_logistic_data() -> tuple[list[float], list[float], list[float]]:
    """Reproducible, non-separable synthetic binary data (fixed seed).

    Used only for structural/property assertions (CI ordering, prediction
    bounds) — NOT a reference-value test, so synthetic data is fine here;
    the point is just to avoid the perfect-separation instability of a
    small hand-picked toy set. n=60 with genuine class overlap converges
    cleanly with no PerfectSeparationWarning.
    """
    rng = np.random.default_rng(42)
    n = 60
    x1 = rng.normal(0, 1, n)
    x2 = rng.normal(0, 1, n)
    logits = 0.5 + 0.8 * x1 - 0.6 * x2
    p = 1.0 / (1.0 + np.exp(-logits))
    y = (rng.uniform(size=n) < p).astype(float)
    return x1.tolist(), x2.tolist(), y.tolist()


def test_glm_logistic_binary_check():
    """Logistic regression requires binary y."""
    from quantized.calc.stats_glm import logistic_regression

    x = [[1.0, 2.0, 3.0]]  # 1 predictor column, 3 rows
    y = [0.0, 0.5, 1.0]  # Not binary

    with pytest.raises(ValueError, match="binary"):
        logistic_regression(x, y)


def test_glm_logistic_nan_deletion():
    """Logistic regression drops rows with NaN (listwise deletion).

    The data must stay comfortably NON-degenerate: the original 5-row version
    left 4 complete rows for a 3-parameter fit, and whether that near-singular
    IRLS solve converged depended on the runner's BLAS build (it raised
    "Singular matrix" on ubuntu CI while passing locally, 2026-07-10). This
    test's subject is listwise deletion, not numerics — use enough
    well-conditioned, non-separable rows that the fit is robust everywhere.
    """
    from quantized.calc.stats_glm import logistic_regression

    x1 = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    x2 = [2.0, np.nan, 4.0, 5.0, 3.0, 6.0, 5.5, 7.0, 6.5]
    y = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0]

    result = logistic_regression([x1, x2], y)
    assert result["N"] == 8  # One row dropped


def test_glm_logistic_spector_reference():
    """Logistic regression against the real Spector & Mazzeo (1980) data.

    32 students; predictors GPA, TUCE (test score), PSI (teaching method
    dummy); outcome GRADE (course grade improved: 0/1). Bundled directly
    with statsmodels as ``sm.datasets.spector`` and reproduced in William
    Greene's "Econometric Analysis" textbook (and statsmodels' own
    discrete-choice-models example notebook). Published reference
    coefficients (intercept, GPA, TUCE, PSI): -13.021, 2.826, 0.0952,
    2.379; McFadden pseudo-R² = 0.374.
    """
    import statsmodels.api as sm

    from quantized.calc.stats_glm import logistic_regression

    data = sm.datasets.spector.load()
    gpa = data.exog["GPA"].tolist()
    tuce = data.exog["TUCE"].tolist()
    psi = data.exog["PSI"].tolist()
    grade = data.endog.tolist()

    result = logistic_regression([gpa, tuce, psi], grade)

    assert result["N"] == 32
    np.testing.assert_allclose(
        result["coeffs"], [-13.021347, 2.826113, 0.095158, 2.378688], rtol=1e-4
    )
    np.testing.assert_allclose(result["se"], [4.931324, 1.262941, 0.141554, 1.064564], rtol=1e-4)
    np.testing.assert_allclose(result["pseudoR2"], 0.374038, rtol=1e-4)
    np.testing.assert_allclose(result["AIC"], 33.779268, rtol=1e-6)
    np.testing.assert_allclose(result["deviance"], 25.779268, rtol=1e-6)
    assert np.all(0.0 <= result["pValues"]) and np.all(result["pValues"] <= 1.0)


def test_glm_logistic_confidence_intervals():
    """CI bounds (ciLow < ciHigh) for logistic regression."""
    from quantized.calc.stats_glm import logistic_regression

    x1, x2, y = _synthetic_logistic_data()
    result = logistic_regression([x1, x2], y)

    assert np.all(result["ciLow"] < result["ciHigh"])
    assert np.allclose(
        result["ciLow"],
        result["coeffs"] - 1.959964 * result["se"],
        atol=1e-6,
    )


def test_glm_poisson_count_check():
    """Poisson regression requires non-negative integer y."""
    from quantized.calc.stats_glm import poisson_regression

    x = [[1.0, 2.0, 3.0]]  # 1 predictor column, 3 rows
    y = [1.5, 2.0, 3.0]  # Not integers

    with pytest.raises(ValueError, match="integer"):
        poisson_regression(x, y)


def test_glm_poisson_randhie_reference():
    """Poisson regression against a real slice of the RAND HIE data.

    First 500 rows of ``sm.datasets.randhie`` (Cameron & Trivedi,
    "Microeconometrics: Methods and Applications", 2005) — real,
    unaltered health-insurance-experiment data (predictors: log
    coinsurance rate, individual-deductible-plan dummy, chronic disease
    count; outcome: doctor visits). Reference coefficients/SEs computed
    once via this module (deterministic Newton-Raphson MLE on fixed,
    well-conditioned data — reproduces to the asserted tolerance
    regardless of platform/BLAS).
    """
    import statsmodels.api as sm

    from quantized.calc.stats_glm import poisson_regression

    data = sm.datasets.randhie.load()
    n = 500
    lncoins = data.exog["lncoins"].values[:n].tolist()
    idp = data.exog["idp"].values[:n].tolist()
    disea = data.exog["disea"].values[:n].tolist()
    y = data.endog.values[:n].astype(float).tolist()

    result = poisson_regression([lncoins, idp, disea], y)

    assert result["N"] == 500
    np.testing.assert_allclose(
        result["coeffs"], [0.886773, -0.104750, -0.070912, 0.049829], rtol=1e-4
    )
    np.testing.assert_allclose(result["se"], [0.048999, 0.014158, 0.060181, 0.002358], rtol=1e-4)
    np.testing.assert_allclose(result["AIC"], 4340.369978, rtol=1e-6)
    np.testing.assert_allclose(result["deviance"], 3200.096510, rtol=1e-6)
    assert 0.0 <= result["pseudoR2"] <= 1.0


def test_glm_insufficient_rows():
    """GLM requires enough observations (n >= k + 2)."""
    from quantized.calc.stats_glm import logistic_regression

    x1 = [1.0, 2.0]
    x2 = [3.0, 4.0]
    y = [0.0, 1.0]
    # n=2, k=2, need n >= k+2 (4)

    with pytest.raises(ValueError, match="at least"):
        logistic_regression([x1, x2], y)


def test_glm_logistic_import_error_when_statsmodels_missing(monkeypatch):
    """Missing statsmodels raises a clear RuntimeError, not a bare ImportError.

    ``sys.modules[name] = None`` is the standard way to simulate "package
    not importable" without actually uninstalling it — any subsequent
    ``import statsmodels`` raises ImportError immediately.
    """
    from quantized.calc import stats_glm

    monkeypatch.setitem(sys.modules, "statsmodels", None)

    with pytest.raises(RuntimeError, match=r"quantized\[stats\]"):
        stats_glm.logistic_regression([[1.0, 2.0, 3.0]], [0.0, 1.0, 1.0])


def test_glm_poisson_nan_handling():
    """Poisson regression drops NaN rows correctly."""
    from quantized.calc.stats_glm import poisson_regression

    x1 = [1.0, 2.0, 3.0, 4.0, 5.0]
    x2 = [2.0, 1.0, np.nan, 3.0, 2.0]
    y = [2.0, 1.0, 4.0, 3.0, 5.0]

    result = poisson_regression([x1, x2], y)
    assert result["N"] == 4


def test_glm_logistic_predicted_probabilities():
    """Logistic regression predicted probabilities are in [0, 1]."""
    from quantized.calc.stats_glm import logistic_regression

    x1, x2, y = _synthetic_logistic_data()
    result = logistic_regression([x1, x2], y)
    assert np.all(result["yPred"] >= 0.0)
    assert np.all(result["yPred"] <= 1.0)
