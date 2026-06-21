"""smoothData (moving / gaussian / savgol): golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.processing import smooth_data


@pytest.mark.golden
@pytest.mark.parametrize(
    ("name", "method", "kwargs"),
    [
        ("calc_smooth_moving.json", "moving", {"window": 5}),
        ("calc_smooth_gaussian.json", "gaussian", {"window": 5}),
        ("calc_smooth_savgol.json", "savitzky-golay", {"window": 5, "poly_order": 2}),
    ],
)
def test_smooth_matches_matlab(
    name: str,
    method: str,
    kwargs: dict[str, Any],
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(name)
    out = smooth_data(np.asarray(g["input"], dtype=float), method=method, **kwargs)
    compare_calc(out, g["output"])


def test_smooth_moving_preserves_constant() -> None:
    y = np.full(20, 3.5)
    assert_allclose(smooth_data(y, method="moving", window=3), 3.5)


def test_smooth_savgol_preserves_low_order_polynomial() -> None:
    # An order-2 SG filter reproduces a quadratic exactly (interior and edges).
    x = np.linspace(-3.0, 3.0, 41)
    y = 2.0 * x**2 - x + 1.0
    out = smooth_data(y, method="savitzky-golay", window=5, poly_order=2)
    assert_allclose(out, y, atol=1e-9)


def test_smooth_savgol_polyorder_too_large() -> None:
    with pytest.raises(ValueError, match="poly_order"):
        smooth_data(np.arange(20.0), method="savitzky-golay", window=2, poly_order=5)


def test_smooth_columns_independent() -> None:
    y = np.column_stack([np.full(15, 1.0), np.full(15, 9.0)])
    out = smooth_data(y, method="moving", window=3)
    assert out.shape == (15, 2)
    assert_allclose(out[:, 0], 1.0)
    assert_allclose(out[:, 1], 9.0)
