"""Tests for survival analysis (KM, log-rank, Cox PH) — gap #30.

``cox_proportional_hazards``' ``predictors`` follows the same "list of k
column arrays" contract as ``calc.stats_glm``/``calc.stats_multivar`` — a
1-predictor, 5-observation design is ``[[x_a, x_b, x_c, x_d, x_e]]`` (one
column), never five single-element rows.

Reference values from a real, published, non-degenerate dataset (never a
toy fit degenerate enough to trigger Cox "complete separation" instability):
Rossi et al. (1980) criminal-recidivism data, bundled directly with
lifelines as ``lifelines.datasets.load_rossi`` and used throughout the
lifelines documentation as its standard Cox PH / KM / log-rank worked
example. 432 inmates followed for 52 weeks; ``arrest`` is the event,
``week`` the time-to-event/censoring, ``fin`` a financial-aid treatment
indicator plus 6 other covariates.
"""

from __future__ import annotations

import numpy as np
import pytest

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


def test_km_rossi_reference():
    """Kaplan-Meier on the full Rossi (1980) recidivism dataset (N=432).

    Bundled with lifelines as ``load_rossi``; 114 of 432 inmates are
    rearrested within the 52-week follow-up (the well-documented ~26.4%
    recidivism rate for this study), so the median survival time is
    undefined (S(t) never drops to 0.5) — lifelines reports it as +inf.
    Final survival estimate S(52) and its Greenwood CI are asserted
    against this module's own (deterministic) computation on the
    unaltered dataset.
    """
    from lifelines.datasets import load_rossi

    from quantized.calc.stats_survival import kaplan_meier

    rossi = load_rossi()
    result = kaplan_meier(rossi["week"].tolist(), rossi["arrest"].tolist())

    assert result["N"] == 432
    assert result["events"].sum() == 114.0
    assert np.isinf(result["medianSurvival"])
    assert result["times"][-1] == 52.0
    np.testing.assert_allclose(result["survival"][-1], 0.736111, rtol=1e-5)
    np.testing.assert_allclose(result["ciLow"][-1], 0.691860, rtol=1e-4)
    np.testing.assert_allclose(result["ciHigh"][-1], 0.775063, rtol=1e-4)


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


def test_logrank_rossi_fin_reference():
    """Log-rank comparing Rossi recidivism by financial-aid status (``fin``).

    Splitting the Rossi (1980) dataset into the ``fin``=1 (received aid)
    and ``fin``=0 (did not) groups is the canonical two-group comparison
    used throughout the lifelines documentation. Reference statistic and
    p-value below are lifelines' own ``logrank_test`` output on this
    unaltered split (verified independently via
    ``lifelines.statistics.logrank_test`` outside this module).
    """
    from lifelines.datasets import load_rossi

    from quantized.calc.stats_survival import logrank_test

    rossi = load_rossi()
    g1 = rossi[rossi["fin"] == 1]
    g2 = rossi[rossi["fin"] == 0]

    result = logrank_test(
        g1["week"].tolist(), g1["arrest"].tolist(), g2["week"].tolist(), g2["arrest"].tolist()
    )

    assert result["N1"] == 216
    assert result["N2"] == 216
    np.testing.assert_allclose(result["statistic"], 3.837570, rtol=1e-5)
    np.testing.assert_allclose(result["pValue"], 0.050116, rtol=1e-4)
    np.testing.assert_allclose(result["observedGroup1"], 48.0)
    np.testing.assert_allclose(result["observedGroup2"], 66.0)


def test_cox_simple():
    """Cox PH model on a simple example."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    event = np.array([1.0, 1.0, 0.0, 1.0, 0.0])
    x = [[0.0, 1.0, 0.0, 1.0, 1.0]]  # 1 predictor column, 5 rows

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
    x = [[0.0, 0.0, 0.0, 1.0, 0.0]]  # 1 predictor column, 5 rows

    result = cox_proportional_hazards(time, event, x)
    assert result["N"] == 4


def test_cox_multiple_predictors():
    """Cox PH with multiple predictors."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    event = np.array([1.0, 1.0, 0.0, 1.0, 1.0, 0.0])
    x1 = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0]
    x2 = [5.2, 3.1, 7.4, 2.2, 6.6, 4.8]  # not correlated with time/x1
    x = [x1, x2]

    result = cox_proportional_hazards(time, event, x)

    assert result["N"] == 6
    assert len(result["coeffs"]) == 2
    assert np.all(np.isfinite(result["coeffs"]))


def test_cox_time_constraint():
    """Cox PH requires non-negative time."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, -1.0, 3.0])
    event = np.array([1.0, 1.0, 0.0])
    x = [[1.0, 2.0, 3.0]]  # 1 predictor column, 3 rows

    with pytest.raises(ValueError, match="non-negative"):
        cox_proportional_hazards(time, event, x)


def test_cox_insufficient_rows():
    """Cox PH needs enough observations (n >= k + 2)."""
    from quantized.calc.stats_survival import cox_proportional_hazards

    time = np.array([1.0, 2.0, 3.0])
    event = np.array([1.0, 1.0, 0.0])
    x1 = [1.0, 2.0, 3.0]
    x2 = [2.0, 3.0, 4.0]  # k=2, need n >= 4

    with pytest.raises(ValueError, match="at least"):
        cox_proportional_hazards(time, event, [x1, x2])


def test_cox_rossi_reference():
    """Cox PH on the full Rossi (1980) recidivism data — the canonical
    lifelines ``CoxPHFitter`` worked example (7 covariates, N=432).

    Reference coefficients/SEs/z/p computed once via this module
    (deterministic Newton-Raphson partial-likelihood MLE on fixed,
    unaltered data) and cross-checked directly against
    ``lifelines.CoxPHFitter().fit(rossi, ...).summary`` outside this
    module. Exercises the CoxPHFitter API surface this wrapper previously
    got wrong: ``.AIC_`` raises for a semi-parametric model (use
    ``.AIC_partial_``), and ``cph.summary["p"]`` is already the two-sided
    p-value (must not be re-transformed).
    """
    from lifelines.datasets import load_rossi

    from quantized.calc.stats_survival import cox_proportional_hazards

    rossi = load_rossi()
    cols = ["fin", "age", "race", "wexp", "mar", "paro", "prio"]
    predictors = [rossi[c].tolist() for c in cols]

    result = cox_proportional_hazards(rossi["week"].tolist(), rossi["arrest"].tolist(), predictors)

    assert result["N"] == 432
    np.testing.assert_allclose(
        result["coeffs"],
        [-0.379422, -0.057438, 0.313900, -0.149796, -0.433704, -0.084871, 0.091497],
        rtol=1e-4,
    )
    np.testing.assert_allclose(
        result["se"],
        [0.191379, 0.021999, 0.307993, 0.212224, 0.381868, 0.195757, 0.028649],
        rtol=1e-4,
    )
    np.testing.assert_allclose(
        result["pValues"],
        [0.047416, 0.009031, 0.308118, 0.480290, 0.256064, 0.664612, 0.001404],
        rtol=1e-3,
    )
    assert np.all(0.0 <= result["pValues"]) and np.all(result["pValues"] <= 1.0)
    np.testing.assert_allclose(result["concordanceIndex"], 0.640329, rtol=1e-5)
    np.testing.assert_allclose(result["logLikelihood"], -658.747659, rtol=1e-6)
    np.testing.assert_allclose(result["AIC"], 1331.495319, rtol=1e-6)


def test_km_single_event():
    """KM handles data with few events gracefully."""
    from quantized.calc.stats_survival import kaplan_meier

    time = np.array([1.0, 2.0, 3.0])
    event = np.array([1.0, 0.0, 0.0])  # Only one event

    result = kaplan_meier(time, event)
    assert result["N"] == 3
    assert result["survival"][0] <= 1.0
