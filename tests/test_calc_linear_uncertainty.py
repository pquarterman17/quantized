"""Uncertainty propagation through the linear signal transforms (audit #9).

Two checks per operator: (1) EXACTNESS -- the propagation matrix reproduces
the real transform in ``calc.processing`` (``A @ y == f(y)``), so the
variance is propagated through the very operation the data went through;
(2) STATISTICS -- the propagated standard deviation matches a Monte Carlo
simulation of the real transform on independently perturbed inputs.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.linear_uncertainty import (
    compose,
    cumulative_trapezoid_sigma,
    gradient_operator,
    linear_sigma,
    smoothing_operator,
)
from quantized.calc.processing import cumulative_integral, derivative, smooth_data

_RNG = np.random.default_rng(20261113)
_N = 41
_X = np.cumsum(_RNG.uniform(0.5, 1.5, _N))  # non-uniform spacing on purpose
_Y = np.sin(_X / 4.0) + 0.1 * _X
_SIGMA = _RNG.uniform(0.05, 0.3, _N)
_SMOOTHERS = [
    ("moving", 3, 2),
    ("gaussian", 4, 2),
    ("savitzky-golay", 5, 2),
    ("savitzky-golay", 3, 3),
    ("savitzky-golay", 40, 2),  # half-window clamped to n-1: all edge fits
]


def _monte_carlo_std(transform, draws: int = 6000) -> np.ndarray:  # type: ignore[no-untyped-def]
    # A fresh seeded generator per call: each test sees the same draws
    # whatever order (or xdist worker) it runs in. At 6000 draws the sample
    # std is good to ~1%, so the 6% tolerance below is a >5-sigma margin.
    noise = np.random.default_rng(7).standard_normal((draws, _N)) * _SIGMA
    outs = np.stack([transform(_Y + e) for e in noise])
    return np.asarray(outs.std(axis=0, ddof=1))


@pytest.mark.parametrize(("method", "window", "order"), _SMOOTHERS)
def test_smoothing_operator_reproduces_smooth_data(method: str, window: int, order: int) -> None:
    op = smoothing_operator(_N, method=method, window=window, poly_order=order)
    expected = smooth_data(_Y, method=method, window=window, poly_order=order)
    np.testing.assert_allclose(op @ _Y, expected, rtol=1e-10, atol=1e-12)


@pytest.mark.parametrize(("method", "window", "order"), _SMOOTHERS[:3])
def test_smoothing_sigma_matches_monte_carlo(method: str, window: int, order: int) -> None:
    op = smoothing_operator(_N, method=method, window=window, poly_order=order)
    mc = _monte_carlo_std(lambda y: smooth_data(y, method=method, window=window, poly_order=order))
    np.testing.assert_allclose(linear_sigma(op, _SIGMA), mc, rtol=0.06)
    # Squared weights, not squared sums: a moving average shrinks sigma.
    assert np.all(linear_sigma(op, _SIGMA)[5:-5] < _SIGMA.max())


@pytest.mark.parametrize("order", [1, 2])
def test_gradient_operator_reproduces_derivative_and_matches_monte_carlo(order: int) -> None:
    grad = gradient_operator(_X)
    op = grad if order == 1 else compose(grad, grad)
    np.testing.assert_allclose(op @ _Y, derivative(_X, _Y, order=order), rtol=1e-10, atol=1e-12)
    mc = _monte_carlo_std(lambda y: derivative(_X, y, order=order))
    np.testing.assert_allclose(linear_sigma(op, _SIGMA), mc, rtol=0.06)


def test_smoothed_derivative_is_one_composed_operator() -> None:
    smooth = smoothing_operator(_N, method="savitzky-golay", window=4, poly_order=2)
    op = compose(gradient_operator(_X), smooth)

    def chain(y: np.ndarray) -> np.ndarray:
        return derivative(_X, smooth_data(y, method="savitzky-golay", window=4, poly_order=2))

    np.testing.assert_allclose(op @ _Y, chain(_Y), rtol=1e-10, atol=1e-12)
    np.testing.assert_allclose(linear_sigma(op, _SIGMA), _monte_carlo_std(chain), rtol=0.06)


def test_cumulative_integral_sigma_is_a_cumulative_sum_of_variances() -> None:
    got = cumulative_trapezoid_sigma(_X, _SIGMA, _Y)
    dx = np.diff(_X)
    # Row 2 by hand: dx0/2*y0 + (dx0+dx1)/2*y1 + dx1/2*y2.
    by_hand = np.sqrt(
        (dx[0] / 2 * _SIGMA[0]) ** 2
        + ((dx[0] + dx[1]) / 2 * _SIGMA[1]) ** 2
        + (dx[1] / 2 * _SIGMA[2]) ** 2
    )
    assert got[0] == 0.0
    assert got[2] == pytest.approx(by_hand, rel=1e-12)
    assert np.all(np.diff(got[1:]) > 0)  # grows along the integral
    mc = _monte_carlo_std(lambda y: cumulative_integral(_X, y))
    np.testing.assert_allclose(got[1:], mc[1:], rtol=0.06)


def test_integral_of_smoothed_data_matches_dense_composition_and_monte_carlo() -> None:
    smooth = smoothing_operator(_N, method="gaussian", window=3)
    z = smooth @ _Y
    got = cumulative_trapezoid_sigma(_X, _SIGMA, z, pre=smooth)
    # Dense reference: the trapezoid matrix times S.
    eye = np.eye(_N)
    trap = np.stack([cumulative_integral(_X, eye[:, j]) for j in range(_N)], axis=1)
    dense = trap @ smooth.toarray()
    np.testing.assert_allclose(dense @ _Y, cumulative_integral(_X, z), rtol=1e-10, atol=1e-12)
    np.testing.assert_allclose(got, np.sqrt((dense**2) @ _SIGMA**2), rtol=1e-10, atol=1e-14)
    chain = lambda y: cumulative_integral(_X, smooth_data(y, method="gaussian", window=3))  # noqa: E731
    np.testing.assert_allclose(got[1:], _monte_carlo_std(chain)[1:], rtol=0.06)


def test_nan_handling_matches_the_transforms() -> None:
    y = _Y.copy()
    y[10] = np.nan
    integral = cumulative_integral(_X, y)
    sigma = cumulative_trapezoid_sigma(_X, _SIGMA, y)
    assert np.isnan(integral[10]) and np.isnan(sigma[10])
    assert np.isfinite(sigma[11:]).all()  # a NaN row is integrated as 0, not poison
    unknown = _SIGMA.copy()
    unknown[5] = np.nan  # an unknown uncertainty propagates as unknown
    grad_sigma = linear_sigma(gradient_operator(_X), unknown)
    assert np.isnan(grad_sigma[[4, 6]]).all() and np.isfinite(grad_sigma[5])
