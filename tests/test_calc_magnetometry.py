"""Magnetometry (subtractMagBackground + convertMagUnits): golden parity vs MATLAB."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.magnetometry import (
    convert_mag_units,
    subtract_hysteresis_background,
    subtract_mag_background,
)


@pytest.mark.golden
@pytest.mark.parametrize(
    ("name", "kwargs"),
    [
        ("calc_submagbg_auto.json", {}),
        ("calc_submagbg_range.json", {"fit_range": (200.0, 300.0)}),
    ],
)
def test_subtract_mag_background_matches_matlab(
    name: str,
    kwargs: dict[str, Any],
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden(name)
    t = np.asarray(g["input"]["T"], dtype=float)
    m = np.asarray(g["input"]["M"], dtype=float)
    corrected, slope, intercept = subtract_mag_background(t, m, **kwargs)
    out = g["output"]
    assert_allclose(corrected, np.asarray(out["corrected"], dtype=float), rtol=1e-9, atol=1e-9)
    assert slope == pytest.approx(out["bgSlope"], rel=1e-9)
    assert intercept == pytest.approx(out["bgIntercept"], rel=1e-9)


@pytest.mark.golden
@pytest.mark.parametrize(
    "name", ["field_oe_t", "amts", "emu_g", "emu_cm3"]
)
def test_convert_mag_units_matches_matlab(
    name: str,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden(f"calc_convmag_{name}.json")
    p = g["params"]
    x = np.asarray(g["input"]["x"], dtype=float)
    y = np.asarray(g["input"]["y"], dtype=float)
    x_out, y_out, x_unit, y_unit, warn = convert_mag_units(
        x, y,
        from_field=p["fromField"], to_field=p["toField"],
        from_moment=p["fromMoment"], to_moment=p["toMoment"],
        sample_mass=float(p["mass"]), sample_volume=float(p["vol"]),
    )
    out = g["output"]
    assert_allclose(x_out, np.asarray(out["xOut"], dtype=float), rtol=1e-9, atol=1e-9)
    assert_allclose(y_out, np.asarray(out["yOut"], dtype=float), rtol=1e-9, atol=1e-9)
    assert x_unit == out["xUnit"]
    assert y_unit == out["yUnit"]
    assert warn == (out["warn"] if out["warn"] else "")


def test_subtract_mag_background_removes_linear() -> None:
    t = np.linspace(2.0, 300.0, 100)
    m = 0.05 * t + 3.0  # pure linear background
    corrected, slope, intercept = subtract_mag_background(t, m)
    assert slope == pytest.approx(0.05, rel=1e-6)
    assert intercept == pytest.approx(3.0, rel=1e-6)
    assert_allclose(corrected, 0.0, atol=1e-9)


def test_subtract_hysteresis_background_removes_slope_keeps_offset() -> None:
    # Pure linear dia/paramagnetic background + a vertical offset, no loop.
    h = np.linspace(-100.0, 100.0, 201)
    offset = 1.5
    m = 0.02 * h + offset
    corrected, slope = subtract_hysteresis_background(h, m)
    assert slope == pytest.approx(0.02, rel=1e-6)
    # The slope is removed but the offset is KEPT — the crucial difference from
    # subtract_mag_background (M-vs-T), which removes the intercept too. Keeping
    # it leaves M=0 crossings (coercivity) unchanged.
    assert_allclose(corrected, offset, atol=1e-9)


def test_subtract_hysteresis_background_matches_matlab_formula() -> None:
    # Loop signal + linear background + offset. Assert the port reproduces
    # subtractLinearBG.m exactly: mask |H|>0.7*max|H| (both tails), fit slope,
    # subtract slope*H only.
    h = np.linspace(-50.0, 50.0, 101)
    m = 3.0 * np.sign(h) + 0.01 * h + 0.2
    corrected, slope = subtract_hysteresis_background(h, m)
    mask = np.abs(h) > 0.7 * np.max(np.abs(h))
    expected_slope = float(np.polyfit(h[mask], m[mask], 1)[0])
    assert slope == pytest.approx(expected_slope)
    assert_allclose(corrected, m - expected_slope * h, atol=1e-12)


def test_subtract_hysteresis_background_noop_too_few_tail_points() -> None:
    # Only 1-2 points exceed 0.7*max|H| → below min_points → no-op.
    h = np.array([-1.0, 0.0, 1.0, 2.0, 3.0])
    m = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    corrected, slope = subtract_hysteresis_background(h, m, min_points=4)
    assert slope == 0.0
    assert_allclose(corrected, m)


def test_convert_mag_units_missing_mass_warns() -> None:
    x = np.array([1.0, 2.0])
    y = np.array([10.0, 20.0])
    x_out, y_out, x_unit, y_unit, warn = convert_mag_units(
        x, y, to_moment="emu/g", sample_mass=0.0
    )
    assert "mass" in warn
    assert y_unit == "emu"  # reverted to source
    assert_allclose(y_out, y)  # data unchanged


def test_convert_mag_units_field_only() -> None:
    x = np.array([0.0, 10000.0])  # Oe
    y = np.array([1.0, 2.0])
    x_out, _, x_unit, _, warn = convert_mag_units(x, y, from_field="Oe", to_field="T")
    assert x_unit == "T"
    assert warn == ""
    assert_allclose(x_out, [0.0, 1.0])  # 1e4 Oe = 1 T
