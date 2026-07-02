"""Multiple regression + correlation (calc.stats_multivar).

Oracles (no MATLAB reference — ORIGIN_GAP_PLAN #27):
- multiple_regression with ONE predictor must reproduce calc.stats.lin_regress
  (order=1), which is itself golden-verified against MATLAB.
- correlation p-values must match scipy.stats.pearsonr/spearmanr (an
  independent implementation of the same t-transform).
- 3-variable partial correlation must match the closed-form
  r_xy.z = (r_xy - r_xz r_yz) / sqrt((1-r_xz²)(1-r_yz²)).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy import stats as sps

from quantized.calc.stats import lin_regress
from quantized.calc.stats_multivar import (
    correlation_matrix,
    multiple_regression,
    partial_correlation,
)

# deterministic pseudo-noise (no RNG — keeps the suite reproducible)
_N = 40
_T = np.linspace(0.0, 4.0, _N)
_NOISE = 0.05 * np.sin(17.3 * _T + 0.4) + 0.03 * np.cos(41.7 * _T)
_X1 = _T
_X2 = np.cos(2.0 * _T)  # independent shape, not collinear with _X1
_Y = 1.5 + 2.0 * _X1 - 0.7 * _X2 + _NOISE


def test_single_predictor_matches_lin_regress() -> None:
    ref = lin_regress(_X1, _Y, order=1)
    out = multiple_regression([_X1], _Y)
    np.testing.assert_allclose(out["coeffs"], ref["coeffs"], rtol=1e-10)
    np.testing.assert_allclose(out["se"], ref["se"], rtol=1e-10)
    np.testing.assert_allclose(out["pValues"], ref["pValues"], rtol=1e-9, atol=1e-15)
    assert math.isclose(out["R2"], ref["R2"], rel_tol=1e-12)
    assert math.isclose(out["fStat"], ref["fStat"], rel_tol=1e-10)
    assert math.isclose(out["fPvalue"], ref["fPvalue"], rel_tol=1e-9, abs_tol=1e-15)
    assert out["df"] == ref["df"]


def test_two_predictors_recover_the_plane() -> None:
    out = multiple_regression([_X1, _X2], _Y)
    # noise amplitude 0.08 → coefficients recovered to ~1e-2
    np.testing.assert_allclose(out["coeffs"], [1.5, 2.0, -0.7], atol=0.05)
    assert out["R2"] > 0.999
    assert out["pValues"][1] < 1e-10  # x1 clearly significant
    assert (out["ciLow"] <= out["coeffs"]).all() and (out["coeffs"] <= out["ciHigh"]).all()


def test_regression_drops_nonfinite_rows() -> None:
    x = np.concatenate([_X1, [np.nan]])
    y = np.concatenate([_Y, [123.0]])
    out = multiple_regression([x], y)
    assert out["N"] == _N  # the NaN row was dropped, not fitted


def test_regression_errors() -> None:
    with pytest.raises(ValueError, match="same length"):
        multiple_regression([np.arange(5.0), np.arange(4.0)], np.arange(5.0))
    with pytest.raises(ValueError, match="singular"):
        multiple_regression([np.ones(10)], np.arange(10.0))  # constant predictor
    with pytest.raises(ValueError, match="complete rows"):
        multiple_regression([np.arange(2.0)], np.arange(2.0))  # n=2 < k+2=3


def test_correlation_matches_scipy_pearson() -> None:
    out = correlation_matrix([_X1, _X2, _Y])
    r_ref, p_ref = sps.pearsonr(_X1, _Y)
    assert math.isclose(out["r"][0][2], float(r_ref), rel_tol=1e-12)
    assert math.isclose(out["p"][0][2], float(p_ref), rel_tol=1e-8, abs_tol=1e-15)
    # symmetric with a unit diagonal, p diagonal = 1 by convention
    np.testing.assert_allclose(out["r"], np.asarray(out["r"]).T, rtol=1e-14)
    np.testing.assert_allclose(np.diag(out["r"]), 1.0)
    np.testing.assert_allclose(np.diag(out["p"]), 1.0)


def test_correlation_spearman_matches_scipy() -> None:
    out = correlation_matrix([_X1, _Y], method="spearman")
    rho_ref, p_ref = sps.spearmanr(_X1, _Y)
    assert math.isclose(out["r"][0][1], float(rho_ref), rel_tol=1e-12)
    assert math.isclose(out["p"][0][1], float(p_ref), rel_tol=1e-6, abs_tol=1e-12)


def test_correlation_perfect_pair() -> None:
    out = correlation_matrix([_X1, 2.0 * _X1 + 1.0])
    assert math.isclose(out["r"][0][1], 1.0, rel_tol=1e-12)
    assert out["p"][0][1] < 1e-300 or out["p"][0][1] == 0.0


def test_partial_correlation_closed_form() -> None:
    cols = [_X1, _X2, _Y]
    out = partial_correlation(cols)
    r = np.corrcoef(np.column_stack(cols), rowvar=False)
    expect = (r[0, 1] - r[0, 2] * r[1, 2]) / math.sqrt((1 - r[0, 2] ** 2) * (1 - r[1, 2] ** 2))
    assert math.isclose(out["r"][0][1], expect, rel_tol=1e-9)
    assert out["controlled"] == 1


def test_partial_correlation_errors() -> None:
    with pytest.raises(ValueError, match="at least 3 columns"):
        partial_correlation([_X1, _Y])
