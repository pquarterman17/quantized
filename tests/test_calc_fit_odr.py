"""Orthogonal distance (Deming) regression: golden parity vs MATLAB fitting.odrFit."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.fit_odr import odr_fit

_KEYS = ("slope", "intercept", "slopeErr", "interceptErr", "lambda", "rss", "rmse", "n")


@pytest.mark.golden
def test_odr_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_odr.json")
    x = np.asarray(g["x"], dtype=float)
    y = np.asarray(g["y"], dtype=float)
    variants = [
        ("default", {}),
        ("lambda4", {"lambda_": 4.0}),
        ("fromErrors", {"x_error": g["xerr"], "y_error": g["yerr"]}),
    ]
    for key, kwargs in variants:
        r = odr_fit(x, y, **kwargs)
        ref = g[key]
        for k in _KEYS:
            assert_allclose(r[k], ref[k], rtol=1e-12, atol=1e-12, err_msg=f"{key}.{k}")


def test_odr_recovers_exact_line() -> None:
    # Noiseless y = 3x - 2: orthogonal fit recovers it exactly, zero residual.
    x = np.linspace(0.0, 5.0, 11)
    y = 3.0 * x - 2.0
    r = odr_fit(x, y)
    assert r["slope"] == pytest.approx(3.0, rel=1e-12)
    assert r["intercept"] == pytest.approx(-2.0, abs=1e-10)
    assert r["rss"] == pytest.approx(0.0, abs=1e-18)


def test_odr_lambda_from_errors_matches_explicit() -> None:
    rng = np.random.default_rng(0)
    x = np.linspace(0.0, 10.0, 30)
    y = 1.5 * x + 0.5 + 0.1 * rng.standard_normal(30)
    # x_error=1, y_error=2 → lambda = (2/1)^2 = 4
    from_err = odr_fit(x, y, x_error=np.ones(30), y_error=2.0 * np.ones(30))
    explicit = odr_fit(x, y, lambda_=4.0)
    assert from_err["lambda"] == pytest.approx(4.0)
    assert from_err["slope"] == pytest.approx(explicit["slope"], rel=1e-12)


def test_odr_high_lambda_approaches_ols() -> None:
    # λ→∞ recovers ordinary least squares (errors all in y).
    rng = np.random.default_rng(1)
    x = np.linspace(0.0, 10.0, 40)
    y = 2.0 * x + 1.0 + 0.3 * rng.standard_normal(40)
    ols_slope = float(np.polyfit(x, y, 1)[0])
    odr_slope = odr_fit(x, y, lambda_=1e8)["slope"]
    assert odr_slope == pytest.approx(ols_slope, rel=1e-4)


def test_odr_degenerate_no_correlation_returns_flat() -> None:
    # Symmetric data with zero covariance → slope 0 anchored at the mean.
    x = np.array([-2.0, -1.0, 0.0, 1.0, 2.0])
    y = np.array([1.0, 1.0, 1.0, 1.0, 1.0])
    r = odr_fit(x, y)
    assert r["slope"] == pytest.approx(0.0, abs=1e-12)
    assert r["intercept"] == pytest.approx(1.0, rel=1e-12)


def test_odr_too_few_points_raises() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        odr_fit([0.0, 1.0], [0.0, 1.0])


def test_odr_size_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="same length"):
        odr_fit([0.0, 1.0, 2.0], [0.0, 1.0])


def test_odr_nonpositive_lambda_raises() -> None:
    with pytest.raises(ValueError, match="lambda_ must be positive"):
        odr_fit([0.0, 1.0, 2.0], [0.0, 1.0, 2.0], lambda_=0.0)
