"""convertUnits: golden parity vs MATLAB +utilities/convertUnits."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.units import convert_units


@pytest.mark.golden
def test_convert_units_matches_matlab(
    load_golden: Callable[[str], Any],
) -> None:
    cases = load_golden("calc_convert.json")
    assert len(cases) >= 6
    for case in cases:
        out, unit = convert_units(case["value"], case["from"], case["to"])
        assert_allclose(float(np.asarray(out)), case["out"], rtol=1e-12, atol=1e-12)
        assert unit == case["unit"], f"{case['from']}->{case['to']}: {unit!r} != {case['unit']!r}"


def test_convert_units_field_roundtrip() -> None:
    oe = 1234.5
    tesla, unit = convert_units(oe, "Oe", "T")
    assert unit == "T"
    back, _ = convert_units(tesla, "T", "Oe")
    assert_allclose(float(np.asarray(back)), oe, rtol=1e-12)


def test_convert_units_array_input() -> None:
    out, unit = convert_units(np.array([0.0, 100.0, 273.15]), "C", "K")
    assert unit == "K"
    assert_allclose(out, [273.15, 373.15, 546.30])


def test_convert_units_same_unit_lowercased() -> None:
    out, unit = convert_units(42.0, "Oe", "Oe")
    assert unit == "oe"  # MATLAB returns char(lower(toUnit)) on the same-unit path
    assert_allclose(float(np.asarray(out)), 42.0)


def test_convert_units_cross_family_raises() -> None:
    with pytest.raises(ValueError, match="cannot convert"):
        convert_units(1.0, "Oe", "nm")
