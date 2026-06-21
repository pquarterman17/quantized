"""Cumulative integral + log-derivative: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.processing import cumulative_integral, log_derivative


@pytest.mark.golden
def test_cumulative_integral_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_cumint.json")
    out = cumulative_integral(
        np.asarray(g["input"]["x"], dtype=float), np.asarray(g["input"]["y"], dtype=float)
    )
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_log_derivative_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_logderiv.json")
    out = log_derivative(
        np.asarray(g["input"]["x"], dtype=float), np.asarray(g["input"]["y"], dtype=float)
    )
    compare_calc(out, g["output"])


def test_log_derivative_of_power_law() -> None:
    # d(log x^2)/d(log x) = 2, i.e. (x/y)·dy/dx = 2 for y = x^2
    x = np.arange(1.0, 11.0)
    out = log_derivative(x, x**2)
    assert_allclose(out[2:-2], 2.0, rtol=1e-9)
