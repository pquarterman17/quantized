"""Unit tests for calc.fit_findxy (MAIN #15 find X from Y / Y from X).

Closed-form cases: a Gaussian's half-max has exactly two symmetric crossings
(not just the first), a monotonic exponential decay has exactly one, and a
target the curve never reaches returns an empty list -- not an error.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.fit_findxy import find_x, find_y
from quantized.calc.fit_models import evaluate


def _gaussian(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return evaluate("Gaussian", x, p)


def _exp_decay(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return evaluate("Exponential Decay", x, p)


# ── find_y ───────────────────────────────────────────────────────────────────


def test_find_y_gaussian_peak() -> None:
    # A=2, mu=0, sigma=1 -> peak value 2 at x=0.
    assert find_y(_gaussian, [2.0, 0.0, 1.0], 0.0) == pytest.approx(2.0)


def test_find_y_linear() -> None:
    def linear(x: np.ndarray, p: np.ndarray) -> np.ndarray:
        return evaluate("Linear", x, p)

    assert find_y(linear, [2.0, 1.0], 3.0) == pytest.approx(7.0)


# ── find_x: Gaussian half-max -> two symmetric crossings ───────────────────


def test_find_x_gaussian_half_max_two_symmetric_crossings() -> None:
    # A=1, mu=0, sigma=1 -> half-max at x = +/- sigma*sqrt(2*ln2).
    roots = find_x(_gaussian, [1.0, 0.0, 1.0], 0.5, -5.0, 5.0)
    expected = math.sqrt(2.0 * math.log(2.0))
    assert len(roots) == 2
    assert roots[0] == pytest.approx(-expected, abs=1e-6)
    assert roots[1] == pytest.approx(expected, abs=1e-6)


def test_find_x_gaussian_off_center() -> None:
    # A=3, mu=2, sigma=0.5 -> half-max at mu +/- sigma*sqrt(2*ln2).
    roots = find_x(_gaussian, [3.0, 2.0, 0.5], 1.5, -5.0, 10.0)
    half = 0.5 * math.sqrt(2.0 * math.log(2.0))
    assert len(roots) == 2
    assert roots[0] == pytest.approx(2.0 - half, abs=1e-6)
    assert roots[1] == pytest.approx(2.0 + half, abs=1e-6)


# ── find_x: monotonic exponential -> single crossing ────────────────────────


def test_find_x_exp_decay_single_crossing() -> None:
    # y = exp(-x) (A=1, tau=1, C=0); target 0.5 -> x = ln(2).
    roots = find_x(_exp_decay, [1.0, 1.0, 0.0], 0.5, 0.0, 10.0)
    assert len(roots) == 1
    assert roots[0] == pytest.approx(math.log(2.0), abs=1e-6)


# ── find_x: no crossing -> empty list, not an error ─────────────────────────


def test_find_x_no_crossing_returns_empty_list() -> None:
    # y = exp(-x) over [0, 1] never reaches 100.
    roots = find_x(_exp_decay, [1.0, 1.0, 0.0], 100.0, 0.0, 1.0)
    assert roots == []


def test_find_x_target_above_gaussian_peak_returns_empty() -> None:
    roots = find_x(_gaussian, [1.0, 0.0, 1.0], 5.0, -5.0, 5.0)
    assert roots == []


# ── validation ───────────────────────────────────────────────────────────────


def test_find_x_degenerate_range_raises() -> None:
    with pytest.raises(ValueError, match="x_max"):
        find_x(_gaussian, [1.0, 0.0, 1.0], 0.5, 5.0, 5.0)


def test_find_x_reversed_range_raises() -> None:
    with pytest.raises(ValueError, match="x_max"):
        find_x(_gaussian, [1.0, 0.0, 1.0], 0.5, 5.0, -5.0)


def test_find_x_too_few_grid_points_raises() -> None:
    with pytest.raises(ValueError, match="grid_points"):
        find_x(_gaussian, [1.0, 0.0, 1.0], 0.5, -5.0, 5.0, grid_points=1)


# ── custom-equation callables work identically (calc.fit_equation shape) ────


def test_find_x_works_with_a_parsed_equation_callable() -> None:
    from quantized.calc.fit_equation import equation_model

    fcn, names = equation_model("y = a*exp(-x/t)")
    assert names == ["a", "t"]
    roots = find_x(fcn, [1.0, 1.0], 0.5, 0.0, 10.0)
    assert len(roots) == 1
    assert roots[0] == pytest.approx(math.log(2.0), abs=1e-6)
