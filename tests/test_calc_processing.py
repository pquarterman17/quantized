"""Processing utilities: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.processing import derivative, normalize


@pytest.mark.golden
def test_normalize_range_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_normalize_range.json")
    out = normalize(np.asarray(g["input"], dtype=float), method=g["params"]["method"])
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_derivative_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_derivative.json")
    out = derivative(
        np.asarray(g["input"]["x"], dtype=float),
        np.asarray(g["input"]["y"], dtype=float),
        order=g["params"]["order"],
    )
    compare_calc(out, g["output"])


def test_normalize_peak_and_zscore() -> None:
    y = np.array([1.0, 2.0, 3.0, 4.0])
    assert_allclose(normalize(y, method="peak"), y / 4.0)
    z = normalize(y, method="zscore")
    assert_allclose(z.mean(), 0.0, atol=1e-12)
    assert_allclose(z.std(ddof=1), 1.0)


def test_derivative_second_order_constant_curvature() -> None:
    x = np.arange(0, 10, dtype=float)
    d2 = derivative(x, x**2, order=2)
    # d2/dx2 of x^2 is 2 in the interior
    assert_allclose(d2[2:-2], 2.0)


# ── degenerate-input robustness (corpus/edge audit) ──────────────────────────


def test_derivative_empty_input_is_empty_not_crash() -> None:
    """An empty x/y (e.g. after impossible trim bounds) must not IndexError."""
    assert derivative(np.array([]), np.array([])).size == 0


def test_derivative_single_point_is_zero() -> None:
    assert_allclose(derivative(np.array([1.0]), np.array([5.0])), [0.0])


@pytest.mark.parametrize("method", ["range", "peak", "zscore"])
def test_normalize_empty_input_is_empty_not_crash(method: str) -> None:
    """An empty column must return empty, not raise on np.nanmin of []."""
    assert normalize(np.array([]), method=method).size == 0
