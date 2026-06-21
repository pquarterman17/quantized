"""calc.unitConvert: golden parity vs MATLAB +calc/unitConvert."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.unit_convert import unit_convert


@pytest.mark.golden
@pytest.mark.parametrize("name", ["dim", "temp", "len", "ewl", "oet", "efreq"])
def test_unit_convert_matches_matlab(
    name: str,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden(f"calc_unitconv_{name}.json")
    inp = g["input"]
    result, info = unit_convert(inp["value"], inp["from"], inp["to"])
    out = g["output"]
    assert_allclose(float(np.asarray(result)), out["result"], rtol=1e-9, atol=1e-12)
    if out["factor"] is None:
        assert math.isnan(info["factor"])
    else:
        assert_allclose(info["factor"], out["factor"], rtol=1e-9)
    assert_allclose(info["fromParsed"]["dims"], np.asarray(out["fromDims"], dtype=float))
    assert_allclose(info["toParsed"]["dims"], np.asarray(out["toDims"], dtype=float))
    assert_allclose(info["fromParsed"]["scale"], out["fromScale"], rtol=1e-12)
    assert_allclose(info["toParsed"]["scale"], out["toScale"], rtol=1e-12)


def test_unit_convert_current_density() -> None:
    result, info = unit_convert(1.0, "mA/cm^2", "A/m^2")
    assert float(np.asarray(result)) == pytest.approx(10.0)
    assert info["factor"] == pytest.approx(10.0)


def test_unit_convert_temperature_offset() -> None:
    result, info = unit_convert(300.0, "K", "C")
    assert float(np.asarray(result)) == pytest.approx(26.85)
    assert math.isnan(info["factor"])  # nonlinear -> NaN factor


def test_unit_convert_energy_wavelength_bridge() -> None:
    result, _ = unit_convert(1.0, "eV", "nm")
    assert float(np.asarray(result)) == pytest.approx(1239.84198, rel=1e-5)


def test_unit_convert_array_input() -> None:
    result, _ = unit_convert(np.array([1.0, 10.0]), "Ang", "nm")
    assert_allclose(np.asarray(result), [0.1, 1.0])


def test_unit_convert_incompatible_raises() -> None:
    with pytest.raises(ValueError, match="incompatible"):
        unit_convert(1.0, "kg", "s")
