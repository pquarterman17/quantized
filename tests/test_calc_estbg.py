"""estimateBackground (snip / polynomial / iterative): golden parity vs MATLAB."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.baseline import estimate_background


def _xy(g: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    return np.asarray(g["input"]["x"], dtype=float), np.asarray(g["input"]["y"], dtype=float)


@pytest.mark.golden
def test_estbg_snip_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_estbg_snip.json")
    x, y = _xy(g)
    compare_calc(estimate_background(x, y), g["output"])


@pytest.mark.golden
def test_estbg_poly_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_estbg_poly.json")
    x, y = _xy(g)
    compare_calc(estimate_background(x, y, method="polynomial"), g["output"])


@pytest.mark.golden
def test_estbg_iterative_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_estbg_iter.json")
    x, y = _xy(g)
    compare_calc(estimate_background(x, y, iterative=True), g["output"])


def test_estbg_clamped_below_data() -> None:
    x = np.linspace(0.0, 10.0, 200)
    y = 5.0 + 0.3 * x + 50.0 * np.exp(-((x - 5.0) ** 2) / 0.1)
    bg = estimate_background(x, y)
    assert bg.shape == y.shape
    assert np.all(bg <= y + 1e-9)  # clamped to min(bg, y)
    # Background should sit far below the peak apex.
    assert bg[np.argmax(y)] < y.max() / 2


def test_estbg_short_signal_returns_input() -> None:
    y = np.array([1.0, 2.0])
    np.testing.assert_array_equal(estimate_background([0.0, 1.0], y), y)
