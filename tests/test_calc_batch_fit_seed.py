"""Sequential batch fit (``seed_from_previous``): each dataset starts from the
previous fit's converged parameters. Default off must change nothing."""

from __future__ import annotations

import numpy as np
from numpy.testing import assert_allclose

from quantized.calc.batch_fit import batch_fit
from quantized.calc.fit_models import FIT_MODELS

_GAUSS = FIT_MODELS["Gaussian"]["fcn"]  # params: A, mu, sigma
_N = 20
_X = np.linspace(0.0, 50.0, 501)
_P0 = [10.0, 10.0, 1.0]


def _drifting_series() -> list[tuple[np.ndarray, np.ndarray]]:
    """A narrow peak whose centre drifts 10 -> 38.5 across 20 datasets."""
    rng = np.random.default_rng(1)
    return [
        (_X, _GAUSS(_X, np.array([10.0, 10.0 + 1.5 * k, 1.0])) + rng.normal(0.0, 0.05, _X.size))
        for k in range(_N)
    ]


def test_fixed_start_fails_late_datasets_sequential_succeeds() -> None:
    series = _drifting_series()
    centres = [10.0 + 1.5 * k for k in range(_N)]
    fixed_start = batch_fit(series, _GAUSS, _P0)
    # The premise: a start at 10 loses the peak once it has drifted far away.
    assert not all(fixed_start["converged"])
    assert not fixed_start["converged"][-1]

    seq = batch_fit(series, _GAUSS, _P0, seed_from_previous=True)
    assert all(seq["converged"])
    assert_allclose(np.asarray(seq["params"])[:, 1], centres, atol=0.05)
    assert seq["seedFromPrevious"] is True
    assert seq["seeded"] == [False] + [True] * (_N - 1)


def test_failed_fit_falls_back_to_panel_start_values() -> None:
    series = _drifting_series()
    series[5] = (_X[:2], series[5][1][:2])  # too few points: skipped
    s = batch_fit(series, _GAUSS, _P0, seed_from_previous=True)
    assert s["converged"][5] is False
    # Dataset 6 gets no seed (5 left nothing); its peak is near the panel start,
    # so it still converges. Dataset 7 is seeded from 6 again.
    assert s["seeded"][5] is False  # skipped before it started
    assert s["seeded"][6] is False
    assert s["seeded"][7] is True
    assert s["converged"][6] and s["converged"][7]


def test_nonconverged_fit_is_not_used_as_a_seed() -> None:
    series = _drifting_series()
    series[3] = (_X, np.full_like(_X, np.nan))  # no usable data: exitFlag 0
    s = batch_fit(series, _GAUSS, _P0, seed_from_previous=True)
    assert not s["converged"][3]
    assert s["seeded"][4] is False


def test_seed_is_clamped_into_bounds_and_fixed_stays_fixed() -> None:
    series = _drifting_series()[:6]
    lower = [0.0, 0.0, 0.1]
    upper = [100.0, 15.0, 5.0]  # the drifting centre leaves this window
    s = batch_fit(series, _GAUSS, _P0, lower=lower, upper=upper, seed_from_previous=True,
                  fixed=[False, False, True])
    params = np.asarray(s["params"])
    assert np.all(params[:, 1] <= 15.0 + 1e-9)
    assert_allclose(params[:, 2], 1.0)  # sigma held at its panel start
    # The seed that was handed on never left the bounds.
    assert np.all(params[:, 1] >= 0.0)


def test_default_off_is_identical_to_not_passing_the_option() -> None:
    series = _drifting_series()
    base = batch_fit(series, _GAUSS, _P0)
    off = batch_fit(series, _GAUSS, _P0, seed_from_previous=False)
    for key in ("params", "errors", "R2", "chiSqRed", "RMSE", "AIC"):
        assert_allclose(np.asarray(off[key]), np.asarray(base[key]), equal_nan=True, err_msg=key)
    assert off["exitFlags"] == base["exitFlags"]
    assert off["seedFromPrevious"] is False
    assert off["seeded"] == [False] * _N
