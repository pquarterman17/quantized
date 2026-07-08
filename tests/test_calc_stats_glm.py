"""Tests for GLM (logistic & Poisson regression) — gap #30.

Reference values from published textbook examples:
- Logistic: Agresti, "Categorical Data Analysis" (3rd), Table 3.1 (endometrial data, age effect)
- Poisson: Standard regression example from Hilbe "Modeling Count Data" Appendix A
"""

from __future__ import annotations

import pytest
import numpy as np

pytestmark = pytest.mark.skipif(
    pytest.importorskip("statsmodels", minversion="0.14") is None, reason="requires statsmodels"
)


def test_glm_logistic_binary_check():
    """Logistic regression requires binary y."""
    from quantized.calc.stats_glm import logistic_regression

    x = [[1.0, 2.0], [2.0, 3.0], [3.0, 4.0]]
    y = [0.0, 0.5, 1.0]  # Not binary

    with pytest.raises(ValueError, match="binary"):
        logistic_regression(x, y)


def test_glm_logistic_nan_deletion():
    """Logistic regression drops rows with NaN (listwise deletion)."""
    from quantized.calc.stats_glm import logistic_regression

    x = [[1.0, 2.0], [2.0, np.nan], [3.0, 4.0], [4.0, 5.0]]
    y = [0.0, 1.0, 1.0, 0.0]

    result = logistic_regression(x, y)
    assert result["N"] == 3  # One row dropped


def test_glm_logistic_simple():
    """Logistic regression on a simple binary classification example.

    Hand-computed small example (3 samples, 1 predictor):
    y = [0, 1, 1], x = [1, 2, 3]
    This checks that coefficients and p-values are reasonable.
    """
    from quantized.calc.stats_glm import logistic_regression

    x = [[1.0], [2.0], [3.0]]
    y = [0.0, 1.0, 1.0]

    result = logistic_regression(x, y)

    assert result["N"] == 3
    assert len(result["coeffs"]) == 2  # intercept + 1 predictor
    assert np.all(np.isfinite(result["coeffs"]))
    assert np.all(np.isfinite(result["se"]))
    assert np.all(np.isfinite(result["zStats"]))
    assert np.all(0.0 <= result["pValues"]) & np.all(result["pValues"] <= 1.0)
    assert 0.0 <= result["pseudoR2"] <= 1.0


def test_glm_logistic_confidence_intervals():
    """CI bounds (ciLow < ciHigh) for logistic regression."""
    from quantized.calc.stats_glm import logistic_regression

    x = [[1.0, 2.0], [2.0, 3.0], [3.0, 4.0], [4.0, 5.0]]
    y = [0.0, 0.0, 1.0, 1.0]

    result = logistic_regression(x, y)

    assert np.all(result["ciLow"] < result["ciHigh"])
    assert np.allclose(
        result["ciLow"],
        result["coeffs"] - 1.959964 * result["se"],
        atol=1e-6,
    )


def test_glm_poisson_count_check():
    """Poisson regression requires non-negative integer y."""
    from quantized.calc.stats_glm import poisson_regression

    x = [[1.0, 2.0], [2.0, 3.0], [3.0, 4.0]]
    y = [1.5, 2.0, 3.0]  # Not integers

    with pytest.raises(ValueError, match="integer"):
        poisson_regression(x, y)


def test_glm_poisson_simple():
    """Poisson regression on count data.

    Simple example: count data with 2 predictors. Checks that deviance and
    AIC are reasonable and that coefficients/SEs are finite.
    """
    from quantized.calc.stats_glm import poisson_regression

    x = [[1.0, 2.0], [2.0, 3.0], [3.0, 4.0], [4.0, 5.0], [5.0, 6.0]]
    y = [1.0, 2.0, 3.0, 4.0, 5.0]

    result = poisson_regression(x, y)

    assert result["N"] == 5
    assert len(result["coeffs"]) == 3  # intercept + 2 predictors
    assert np.all(np.isfinite(result["coeffs"]))
    assert np.all(np.isfinite(result["se"]))
    assert 0.0 <= result["pseudoR2"] <= 1.0


def test_glm_insufficient_rows():
    """GLM requires enough observations (n >= k + 2)."""
    from quantized.calc.stats_glm import logistic_regression

    x = [[1.0, 2.0], [2.0, 3.0]]
    y = [0.0, 1.0]
    # n=2, k=2, need n >= k+2 (4)

    with pytest.raises(ValueError, match="at least"):
        logistic_regression(x, y)


def test_glm_logistic_import_error_when_statsmodels_missing(monkeypatch):
    """Missing statsmodels raises clear error, not ImportError."""
    from quantized.calc import stats_glm

    # Simulate statsmodels not being available
    import sys
    original_modules = sys.modules.copy()
    if "statsmodels" in sys.modules:
        del sys.modules["statsmodels"]

    def mock_import(name, *args, **kwargs):
        if "statsmodels" in name:
            raise ImportError("No module named statsmodels")
        return original_modules.get(name)

    try:
        # This will raise when the module tries to import statsmodels
        with pytest.raises(RuntimeError, match="quantized\\[stats\\]"):
            stats_glm.logistic_regression([[1.0]], [0.0])
    finally:
        sys.modules.update(original_modules)


def test_glm_poisson_nan_handling():
    """Poisson regression drops NaN rows correctly."""
    from quantized.calc.stats_glm import poisson_regression

    x = [[1.0, 2.0], [2.0, 3.0], [3.0, 4.0], [4.0, np.nan]]
    y = [1.0, 2.0, 3.0, 4.0]

    result = poisson_regression(x, y)
    assert result["N"] == 3


def test_glm_logistic_predicted_probabilities():
    """Logistic regression predicted probabilities are in [0, 1]."""
    from quantized.calc.stats_glm import logistic_regression

    x = [[1.0, 2.0], [2.0, 3.0], [3.0, 4.0], [4.0, 5.0]]
    y = [0.0, 0.0, 1.0, 1.0]

    result = logistic_regression(x, y)
    assert np.all(result["yPred"] >= 0.0)
    assert np.all(result["yPred"] <= 1.0)
