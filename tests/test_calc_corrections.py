"""Correction pipeline: golden parity vs MATLAB bosonPlotter.applyCorrections."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.corrections import apply_corrections
from quantized.datastruct import DataStruct


def _raw(g: dict[str, Any], labels: list[str], units: list[str]) -> DataStruct:
    return DataStruct.create(
        np.asarray(g["input"]["time"], dtype=float),
        np.asarray(g["input"]["values"], dtype=float),
        labels=labels,
        units=units,
    )


@pytest.mark.golden
def test_corrections_xrd_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_corrections_xrd.json")
    out = apply_corrections(
        _raw(g, ["I"], ["cps"]),
        {
            "xOff": 2.0, "yOff": 5.0, "bgSlope": 0.5, "bgInt": 100,
            "xTrimMin": 15, "xTrimMax": 75, "smoothEnabled": True, "smoothWindow": 5,
            "smoothMethod": "moving", "normMethod": "Peak (max=1)", "derivativeMode": "None",
        },
    )
    assert_allclose(out.time, np.asarray(g["output"]["time"], dtype=float), rtol=1e-9, atol=1e-9)
    assert_allclose(
        out.values[:, 0], np.asarray(g["output"]["values"], dtype=float), rtol=1e-9, atol=1e-9
    )


@pytest.mark.golden
def test_corrections_derivative_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_corrections_deriv.json")
    out = apply_corrections(
        _raw(g, ["I"], ["cps"]),
        {"bgSlope": 0.5, "bgInt": 100, "derivativeMode": "dY/dX"},
    )
    assert_allclose(out.values[:, 0], np.asarray(g["output"]["values"], dtype=float),
                    rtol=1e-9, atol=1e-9)


@pytest.mark.golden
def test_corrections_magnetometry_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_corrections_mag.json")
    out = apply_corrections(
        _raw(g, ["M"], ["emu"]),
        {
            "bgSlope": 0.001, "bgInt": 0, "isMag": True,
            "fieldUnit": "T", "momentUnit": "emu/g", "sampleMass": 2.0,
        },
    )
    assert_allclose(out.time, np.asarray(g["output"]["time"], dtype=float), rtol=1e-9, atol=1e-12)
    assert_allclose(out.values[:, 0], np.asarray(g["output"]["values"], dtype=float),
                    rtol=1e-9, atol=1e-12)


@pytest.mark.golden
def test_corrections_bg_from_file_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """BG-from-file: subtract an interpolated reference-background dataset.

    Covers applyCorrections step 4 across all three interp methods. The active
    x-range [0,10] overhangs the bg range [2,8], so the 0-fill extrapolation
    outside the bg domain is exercised; two channels cover the per-channel loop.
    """
    g = load_golden("calc_bgfromfile.json")
    active = DataStruct.create(
        np.asarray(g["input"]["active"]["time"], dtype=float),
        np.asarray(g["input"]["active"]["values"], dtype=float),
        labels=["A", "B"],
        units=["u", "u"],
    )
    bg = DataStruct.create(
        np.asarray(g["input"]["bg"]["time"], dtype=float),
        np.asarray(g["input"]["bg"]["values"], dtype=float),
        labels=["bg"],
        units=["u"],
    )
    for case in g["cases"]:
        out = apply_corrections(active, {}, bg_dataset=bg, bg_interp=case["interp"])
        exp_time = np.asarray(case["time"], dtype=float)
        exp_vals = np.asarray(case["values"], dtype=float)  # (60, 2)
        assert_allclose(out.time, exp_time, rtol=1e-9, atol=1e-9,
                        err_msg=f"time mismatch for interp={case['interp']}")
        assert_allclose(out.values, exp_vals, rtol=1e-9, atol=1e-9,
                        err_msg=f"values mismatch for interp={case['interp']}")


def test_corrections_bg_from_file_zero_fill_outside_range() -> None:
    """Outside the bg x-range the subtraction is 0, so those points pass through."""
    x = np.linspace(0.0, 10.0, 21)
    y = np.full_like(x, 100.0)
    active = DataStruct.create(x, y, labels=["I"], units=["cps"])
    bg = DataStruct.create(np.array([4.0, 5.0, 6.0]), np.array([10.0, 10.0, 10.0]))
    out = apply_corrections(active, {}, bg_dataset=bg, bg_interp="linear")
    # x < 4 and x > 6 -> 0-fill -> unchanged 100; inside [4,6] -> 100 - 10 = 90.
    inside = (x >= 4.0) & (x <= 6.0)
    assert_allclose(out.values[~inside, 0], 100.0)
    assert_allclose(out.values[inside, 0], 90.0)


def test_corrections_trim_and_offset() -> None:
    x = np.linspace(0.0, 10.0, 11)
    y = np.arange(11.0)
    ds = DataStruct.create(x, y)
    out = apply_corrections(ds, {"xTrimMin": 2.0, "xTrimMax": 8.0, "xOff": 1.0})
    # trim keeps x in [2,8] (7 points), then x -= 1
    assert out.time[0] == pytest.approx(1.0)
    assert out.time[-1] == pytest.approx(7.0)
    assert out.n_points == 7


def test_corrections_neutron_scales_r() -> None:
    x = np.linspace(0.01, 0.2, 20)
    r = np.linspace(1.0, 0.01, 20)
    ds = DataStruct.create(x, r, labels=["R"], units=[""])
    out = apply_corrections(ds, {"isNeutron": True, "yOff": 2.0})
    assert_allclose(out.values[:, 0], r * 2.0)  # R-scale, not BG subtraction


def test_corrections_identity() -> None:
    x = np.linspace(0.0, 5.0, 50)
    y = np.sin(x)
    ds = DataStruct.create(x, y)
    out = apply_corrections(ds, {})  # all defaults -> no-op (bgSlope/bgInt/yOff = 0)
    assert_allclose(out.values[:, 0], y, atol=1e-12)
