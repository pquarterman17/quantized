"""calc.constants: golden parity vs MATLAB +calc/constants."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.constants import constants


@pytest.mark.golden
def test_constants_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_constants.json")
    compare_calc(constants(), g["output"])


def test_constants_known_values() -> None:
    c = constants()
    assert c["c"] == 299792458.0
    assert c["NA"] == 6.02214076e23
    assert c["mu0"] == pytest.approx(4 * math.pi * 1e-7)
    # e = h / (2 * Phi0) is an identity among these constants.
    assert c["e"] == pytest.approx(c["h"] / (2 * c["Phi0"]), rel=1e-6)
