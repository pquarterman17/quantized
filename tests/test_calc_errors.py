"""Error propagation: golden parity vs MATLAB +utilities."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.errors import error_add, error_div, error_func, error_mul


@pytest.mark.golden
def test_error_add_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    compare_calc(list(error_add(2, 0.1, 3, 0.2)), load_golden("calc_erroradd.json")["output"])


@pytest.mark.golden
def test_error_mul_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    compare_calc(list(error_mul(2, 0.1, 3, 0.2)), load_golden("calc_errormul.json")["output"])


@pytest.mark.golden
def test_error_div_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    compare_calc(list(error_div(6, 0.1, 3, 0.2)), load_golden("calc_errordiv.json")["output"])


def test_error_func_central_difference() -> None:
    val, err = error_func(lambda a: a**2, 3.0, 0.1)
    assert math.isclose(val, 9.0)
    # d(a^2)/da = 2a = 6; err = 6 * 0.1 = 0.6
    assert math.isclose(err, 0.6, rel_tol=1e-5)
