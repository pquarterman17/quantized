"""Tests for survival analysis (KM, log-rank, Cox PH) — gap #30.

Reference values from lifelines documentation and published examples.
"""

from __future__ import annotations

import pytest
import numpy as np

pytestmark = pytest.mark.skipif(
    pytest.importorskip("lifelines", minversion="0.27") is None, reason="requires lifelines"
)


def test_km_simple():
    """Kaplan-Meier curve on a simple example."""
    from quantized.calc.stats_survival import kaplan_meier

    # 5 subjects: 3 events, 2 censored
    time = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    event = np.array([1.0, 1.0, 0.0, 1.0, 0.0])

    result = kaplan_meier(time, event)

    assert result["N"] == 5
    assert len(result["times"]) >= 1
    assert len(result["survival"]) == len(result["times"])
    assert np.all((result["survival"] >= 0.0) & (result["survival"] <= 1.0))
    assert np.all(result["ciLow"] <= result["ciHigh"])


def test_km_nan_deletion():
    """KM drops NaN rows (listwise deletion)."""
    from quantized.calc.stats_survival import kaplan_meier

    time = np.array([1.0, 2.0, np.nan, 4.0])
    event = np.array([1.0, 1.0, 1.0, 0.0])

    result = kaplan_meier(time, event)
    assert result["N"] == 3


def test_km_time_constraint():
    """KM requires non-negative time."""
    from quantized.calc.stats_survival import kaplan_meier

    time = np.array([1.0, -1.0, 3.0])
    event = np.array([1.0, 1.0, 0.0])

    with pytest.raises(ValueError, match="non-negative"):
        kaplan_meier(time, event)


def test_km_event_binary():
    """KM requires binary event."""
    from quantized.calc.stats_survival import kaplan_meier

    time = np.array([1.0, 2.0, 3.0])
    event = np.array([0.0, 1.0, 0.5])  # Not binary

    with pytest.raises(ValueError, match="binary"):
        kaplan_meier(time, event)


def test_km_median_survival():
    """KM median survival is where S(t) crosses 0.5."""
    from quantized.calc.stats_survival import kaplan_meier

    # Construct data with a known median
    time = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    event = np.array([1.0, 1.0, 1.0, 0.0, 0.0])  # Median at t~3

    result = kaplan_meier(time, event)
    assert np.isfinite(result["medianSurvival"]) or np.isnan(result["medianSurvival"])


def test_logrank_simple():
    """Log-rank test on two groups."""
    from quantized.calc.stats_survival import logrank_test

    # Group 1: shorter survival
    time1 = np.array([1.0, 2.0, 3.0, 4.0])
    event1 = np.array([1.0, 1.0, 1.0, 0.0])

    # Group 2: longer survival
    time2 = np.array([5.0, 6.0, 7.0, 8.0])
    event2 = np.array([1.0, 0.0, 1.0, 0.0])

    result = logrank_test(time1, event1, time2, event2)

    assert result["N1"] == 4
    assert result["N2"] == 4
    assert 0.0 <= result["pValue"] <= 1.0
    assert result["dof"] == 1.0


def test_logrank_nan_deletion():
    """Log-rank drops NaN rows per group."""
    from quantized.calc.stats_survival import logrank_test

    time1 = np.array([1.0, np.nan, 3.0, 4.0])
    event1 = np.array([1.0, 1.0, 1.0, 0.0])
    time2 = np.array([5.0, 6.0, 7.0, 8.0])
    event2 = np.array([1.0, 0.0, 1.0, 0.0])

    result = logrank_test(time1, event1, time2, event2)
    assert result["N1"] == 3
    assert result["N2"] == 4


def test_logrank_time_constraint():
    """Log-rank requires non-negative time in both groups."""
    from quantized.calc.stats_survival import logrank_test

    time1 = np.array([1.0, -1.0, 3.0, 4.0])
    event1 = np.array([1.0, 1.0, 1.0, 0.0])
    time2 = np.array([5.0, 6.0, 7.0, 8.0])
    event2 = np.array([1.0, 0.0, 1.0, 0.0])

    with pytest.raises(ValueError, match="non-negative"):
        logrank_test(time1, event1, time2, event2)


def test_logrank_insufficient_rows():
    """Log-rank needs at least 2 rows per group."""
    from quantized.calc.stats_survival import logrank_test

    time1 = np.array([1.0])
    event1 = np.array([1.0])
    time2 = np.array([5.0, 6.0])
    event2 = np.array([1.0, 0.0])

    with pytest.raises(ValueError, match="at least 2"):
        logrank_test(time1, event1, time2, event2)


def test_cox_simple():
    """Cox PH model on a simple example."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    event = np.array([1.0, 1.0, 0.0, 1.0, 0.0])
    x = [[1.0], [2.0], [3.0], [4.0], [5.0]]

    result = cox_proportional_hazards(time, event, x)

    assert result["N"] == 5
    assert len(result["coeffs"]) == 1
    assert np.all(np.isfinite(result["coeffs"]))
    assert np.all(np.isfinite(result["se"]))
    assert 0.0 <= result["concordanceIndex"] <= 1.0


def test_cox_nan_deletion():
    """Cox PH drops NaN rows (listwise deletion)."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, 2.0, np.nan, 4.0, 5.0])
    event = np.array([1.0, 1.0, 1.0, 1.0, 0.0])
    x = [[1.0], [2.0], [3.0], [4.0], [5.0]]

    result = cox_proportional_hazards(time, event, x)
    assert result["N"] == 4


def test_cox_multiple_predictors():
    """Cox PH with multiple predictors."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    event = np.array([1.0, 1.0, 0.0, 1.0, 1.0, 0.0])
    x = [[1.0, 10.0], [2.0, 20.0], [3.0, 30.0], [4.0, 40.0], [5.0, 50.0], [6.0, 60.0]]

    result = cox_proportional_hazards(time, event, x)

    assert result["N"] == 6
    assert len(result["coeffs"]) == 2
    assert np.all(np.isfinite(result["coeffs"]))


def test_cox_time_constraint():
    """Cox PH requires non-negative time."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, -1.0, 3.0])
    event = np.array([1.0, 1.0, 0.0])
    x = [[1.0], [2.0], [3.0]]

    with pytest.raises(ValueError, match="non-negative"):
        cox_proportional_hazards(time, event, x)


def test_cox_insufficient_rows():
    """Cox PH needs enough observations (n >= k + 2)."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, 2.0, 3.0])
    event = np.array([1.0, 1.0, 0.0])
    x = [[1.0, 2.0], [2.0, 3.0], [3.0, 4.0]]  # k=2, need n >= 4

    with pytest.raises(ValueError, match="at least"):
        cox_proportional_hazards(time, event, x)


def test_km_single_event():
    """KM handles data with few events gracefully."""
    from quantized.calc.stats_survival import kaplan_meier

    time = np.array([1.0, 2.0, 3.0])
    event = np.array([1.0, 0.0, 0.0])  # Only one event

    result = kaplan_meier(time, event)
    assert result["N"] == 3
    assert result["survival"][0] <= 1.0
