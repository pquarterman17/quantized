"""Magnetometry (subtractMagBackground + convertMagUnits): golden parity vs MATLAB."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.magnetometry import (
    convert_mag_units,
    subtract_hysteresis_background,
    subtract_mag_background,
)
from quantized.calc.magnetometry_demag import demag_correct_field
from quantized.io.registry import import_auto


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


def test_convert_moment_to_amperes_per_metre_uses_volume() -> None:
    # Deliberate SI extension beyond the frozen legacy MATLAB cases above:
    # 1 emu/cm³ = 1000 A/m, so 2 emu / 4 cm³ = 500 A/m.
    _, converted, _, unit, warning = convert_mag_units(
        [0.0], [2.0], from_moment="emu", to_moment="A/m", sample_volume=4.0
    )
    assert converted == pytest.approx([500.0])
    assert unit == "A/m"
    assert warning == ""


def test_demag_correction_matches_si_and_cgs_forms() -> None:
    h_si, sigma_si = demag_correct_field(
        [10_000.0], [2_000.0], n_factor=0.25,
        field_unit="A/m", magnetization_unit="A/m", magnetization_errors=[[40.0]],
    )
    assert h_si == pytest.approx([9_500.0])
    assert sigma_si[0] == pytest.approx([10.0])

    h_cgs, sigma_cgs = demag_correct_field(
        [10_000.0], [2.0], n_factor=0.25,
        field_unit="Oe", magnetization_unit="emu/cm³", magnetization_errors=[[-0.04]],
    )
    assert h_cgs == pytest.approx([10_000.0 - 4.0 * np.pi * 0.25 * 2.0])
    assert sigma_cgs[0] == pytest.approx([4.0 * np.pi * 0.25 * 0.04])


@pytest.mark.parametrize("unit", ["emu", "emu/g", "A·m²"])
def test_demag_correction_rejects_nonvolumetric_moment(unit: str) -> None:
    with pytest.raises(ValueError, match="volume-normalized"):
        demag_correct_field(
            [1.0], [1.0], n_factor=1 / 3, field_unit="Oe", magnetization_unit=unit
        )


def test_demag_correction_rejects_invalid_factor_and_lengths() -> None:
    with pytest.raises(ValueError, match="between 0 and 1"):
        demag_correct_field(
            [1.0], [1.0], n_factor=1.1, field_unit="Oe", magnetization_unit="emu/cm³"
        )
    with pytest.raises(ValueError, match="same length"):
        demag_correct_field(
            [1.0, 2.0], [1.0], n_factor=0.5, field_unit="Oe", magnetization_unit="emu/cm³"
        )


@pytest.mark.realdata
def test_demag_correction_preserves_real_qd_loop_order_and_source(corpus_dir: Path) -> None:
    path = corpus_dir / "quantum-design/magnetometry/vsm_mh_perp_a.dat"
    if not path.exists():
        pytest.skip("real Quantum Design loop is not installed")
    source = import_auto(path)
    field_before = source.time.copy()
    values_before = source.values.copy()
    moment = source.values[:, 0]
    _, magnetization, _, unit, warning = convert_mag_units(
        source.time,
        moment,
        from_field=str(source.metadata["x_column_unit"]),
        to_field=str(source.metadata["x_column_unit"]),
        from_moment=source.units[0],
        to_moment="emu/cm³",
        sample_volume=1.0,
    )
    corrected, _ = demag_correct_field(
        source.time,
        magnetization,
        n_factor=1.0,
        field_unit=str(source.metadata["x_column_unit"]),
        magnetization_unit=unit,
    )
    assert warning == ""
    assert corrected.shape == source.time.shape
    assert np.isfinite(corrected).sum() == np.isfinite(source.time).sum()
    # A loop is non-monotonic acquisition data: verify the transform row by
    # row rather than accepting a sorted set of scientifically plausible values.
    expected = source.time - 4.0 * np.pi * magnetization
    np.testing.assert_allclose(corrected, expected, equal_nan=True)
    assert np.any(np.diff(source.time[np.isfinite(source.time)]) < 0)
    np.testing.assert_array_equal(source.time, field_before)
    np.testing.assert_array_equal(source.values, values_before)


def test_subtract_mag_background_removes_linear() -> None:
    t = np.linspace(2.0, 300.0, 100)
    m = 0.05 * t + 3.0  # pure linear background
    corrected, slope, intercept = subtract_mag_background(t, m)
    assert slope == pytest.approx(0.05, rel=1e-6)
    assert intercept == pytest.approx(3.0, rel=1e-6)
    assert_allclose(corrected, 0.0, atol=1e-9)


def test_subtract_hysteresis_background_removes_slope_and_centers() -> None:
    # Pure linear dia/paramagnetic background + a vertical offset, no loop: BOTH
    # the slope and the vertical offset are removed, leaving a flat line on 0.
    h = np.linspace(-100.0, 100.0, 201)
    m = 0.02 * h + 1.5
    corrected, slope, offset = subtract_hysteresis_background(h, m)
    assert slope == pytest.approx(0.02, rel=1e-6)
    assert offset == pytest.approx(1.5, rel=1e-6)
    assert_allclose(corrected, 0.0, atol=1e-9)


def test_subtract_hysteresis_background_centers_saturated_loop() -> None:
    # A square loop (+/-Ms) + diamagnetic slope + a vertical offset c. After
    # correction the tails must land symmetrically on +/-Ms about M=0. The
    # per-tail slope recovers the TRUE chi (not chi+Ms/Hmax, which a single
    # both-tails fit would give and which would shear the saturation), and the
    # saturation-midpoint offset removes the vertical shift — this is exactly the
    # "don't leave a vertically-offset loop" fix.
    h = np.linspace(-100.0, 100.0, 401)
    ms, chi, c = 2.0, -0.01, 0.7
    m = ms * np.sign(h) + chi * h + c
    corrected, slope, offset = subtract_hysteresis_background(h, m)
    assert slope == pytest.approx(chi, abs=1e-6)
    assert offset == pytest.approx(c, abs=1e-6)
    assert corrected[-1] == pytest.approx(ms, abs=1e-6)  # +tail -> +Ms
    assert corrected[0] == pytest.approx(-ms, abs=1e-6)  # -tail -> -Ms
    assert corrected[-1] == pytest.approx(-corrected[0], abs=1e-9)  # symmetric about 0


def test_subtract_hysteresis_background_one_sided_fallback() -> None:
    # High field on the positive side only (a minor loop / partial sweep): a
    # symmetric vertical centre isn't defined, so fall back to a both-tails slope
    # with the offset KEPT (no centring) rather than mis-centring on one plateau.
    h = np.linspace(0.0, 100.0, 101)
    m = 0.02 * h + 1.0
    corrected, slope, offset = subtract_hysteresis_background(h, m)
    assert offset == 0.0
    assert slope == pytest.approx(0.02, rel=1e-6)
    assert_allclose(corrected, 1.0, atol=1e-9)  # slope removed, offset (1.0) kept


def test_subtract_hysteresis_background_noop_too_few_tail_points() -> None:
    # Only 1-2 points exceed 0.7*max|H| → below min_points → no-op.
    h = np.array([-1.0, 0.0, 1.0, 2.0, 3.0])
    m = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    corrected, slope, offset = subtract_hysteresis_background(h, m, min_points=4)
    assert slope == 0.0
    assert offset == 0.0
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
