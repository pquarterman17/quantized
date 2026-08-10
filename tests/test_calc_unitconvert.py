"""calc.unitConvert: golden parity vs MATLAB +calc/unitConvert."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.unit_convert import _parse_exponent, unit_convert


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


# ── exponent parsing (ReDoS-safe replacement for the old regex) ───────────────


@pytest.mark.parametrize(
    ("s", "expected"),
    [
        ("2", 2.0),
        ("-3", -3.0),
        ("+4", 4.0),
        ("2.5", 2.5),
        ("2.", 2.0),
        ("10", 10.0),
    ],
)
def test_parse_exponent_accepts(s: str, expected: float) -> None:
    assert _parse_exponent(s) == pytest.approx(expected)


@pytest.mark.parametrize(
    "s",
    ["", ".", ".5", "2.5.6", "2^3", "abc", "1e3", "inf", "nan", "2 ", "²"],
)
def test_parse_exponent_rejects(s: str) -> None:
    assert _parse_exponent(s) is None


def test_parse_exponent_no_redos_on_adversarial_input() -> None:
    """The old regex was O(n²) on 'a^9' + '99'*n; the scan must stay linear.

    A 200k-char adversarial exponent body would hang a backtracking regex for
    seconds; here it returns immediately."""
    import time

    payload = "9" * 200_000 + "x"  # long digit run then a non-digit -> reject
    start = time.perf_counter()
    # The load-INVARIANT half: the scan must reject invalid input correctly.
    assert _parse_exponent(payload) is None
    # The wall-clock half is a smoke ceiling only, deliberately far above the
    # measured runtime (~0.02s on this machine). The 0.5s bound was NOT tightened
    # because a lower ceiling only adds flake risk under load. A ReDoS regression
    # takes minutes, not 0.3s — this loose ceiling catches it just as reliably.
    # The REJECTION assertion above is the real protection.
    assert time.perf_counter() - start < 0.5


def test_unit_convert_still_parses_exponents_end_to_end() -> None:
    # m^2 -> cm^2 exercises the exponent path end-to-end (1 m² = 1e4 cm²).
    result, _ = unit_convert(1.0, "m^2", "cm^2")
    assert float(np.asarray(result)) == pytest.approx(1e4)


# ── DiraCulator units-converter expansion: authoritative factor spot-checks ──


def test_eV_to_J_is_exact_codata_charge() -> None:
    result, _ = unit_convert(1.0, "eV", "J")
    assert float(np.asarray(result)) == pytest.approx(1.602176634e-19, rel=1e-15)


def test_torr_to_pa_760_is_one_atm() -> None:
    # The registered Torr factor (133.322 Pa) is the standard 6-sig-fig
    # rounded constant, not the exact 101325/760 ratio -- match at that
    # precision rather than demanding exactness the source constant doesn't have.
    result, _ = unit_convert(760.0, "Torr", "Pa")
    assert float(np.asarray(result)) == pytest.approx(101325.0, rel=1e-5)


def test_angstrom_to_nm() -> None:
    result, _ = unit_convert(1.0, "Ang", "nm")
    assert float(np.asarray(result)) == pytest.approx(0.1)


def test_celsius_fahrenheit_affine_roundtrip() -> None:
    c_val = 37.0
    f_val, _ = unit_convert(c_val, "C", "F")
    back, _ = unit_convert(float(np.asarray(f_val)), "F", "C")
    assert float(np.asarray(back)) == pytest.approx(c_val, abs=1e-9)


def test_ev_to_nm_wavelength() -> None:
    result, _ = unit_convert(1.0, "eV", "nm")
    assert float(np.asarray(result)) == pytest.approx(1239.841984, rel=1e-7)


def test_ev_to_wavenumber() -> None:
    result, _ = unit_convert(1.0, "eV", "cm^-1")
    assert float(np.asarray(result)) == pytest.approx(8065.543937, rel=1e-6)


def test_ev_to_kelvin_thermal_equivalent() -> None:
    result, _ = unit_convert(1.0, "eV", "K")
    assert float(np.asarray(result)) == pytest.approx(11604.518, rel=1e-6)


def test_kelvin_to_ev_is_inverse() -> None:
    result, _ = unit_convert(11604.518, "K", "eV")
    assert float(np.asarray(result)) == pytest.approx(1.0, rel=1e-6)


@pytest.mark.parametrize(
    ("to_unit",),
    [("nm",), ("cm^-1",), ("THz",), ("K",)],
)
def test_photon_energy_zero_value_raises(to_unit: str) -> None:
    with pytest.raises(ValueError, match="positive"):
        unit_convert(0.0, "eV", to_unit)


@pytest.mark.parametrize(
    ("to_unit",),
    [("nm",), ("cm^-1",), ("THz",), ("K",)],
)
def test_photon_energy_negative_value_raises(to_unit: str) -> None:
    with pytest.raises(ValueError, match="positive"):
        unit_convert(-1.0, "eV", to_unit)


def test_photon_energy_error_message_is_ascii() -> None:
    with pytest.raises(ValueError) as exc_info:
        unit_convert(0.0, "eV", "nm")
    assert str(exc_info.value).isascii()


def test_photon_energy_reverse_direction_also_guarded() -> None:
    # nm -> eV with a non-positive wavelength is equally undefined.
    with pytest.raises(ValueError, match="positive"):
        unit_convert(0.0, "nm", "eV")


def test_hb_bridge_allows_zero_and_negative() -> None:
    # H<->B fields legitimately take either sign (unlike photon energy).
    result, _ = unit_convert(0.0, "Oe", "T")
    assert float(np.asarray(result)) == pytest.approx(0.0)
    result, _ = unit_convert(-5.0, "Oe", "T")
    assert float(np.asarray(result)) < 0.0


def test_unknown_unit_raises() -> None:
    with pytest.raises(ValueError, match="unknown unit"):
        unit_convert(1.0, "banana", "J")


def test_unknown_unit_on_both_sides_still_raises() -> None:
    # Previously two unrecognized tokens both fell back to dimensionless and
    # "matched" each other silently -- must raise, not return a no-op 1:1.
    with pytest.raises(ValueError):
        unit_convert(1.0, "banana", "apple")


# ── New base units (length, energy, angle, time, mass, volume, frequency) ───


@pytest.mark.parametrize(
    ("value", "from_u", "to_u", "expected"),
    [
        (1.0, "in", "m", 0.0254),
        (1.0, "ft", "m", 0.3048),
        (1.0, "ft", "in", 12.0),
        (1000.0, "mil", "in", 1.0),
        (1.0, "lb", "kg", 0.45359237),
        (1.0, "h", "s", 3600.0),
        (1.0, "h", "min", 60.0),
        (1.0, "arcmin", "arcsec", 60.0),
        (60.0, "arcsec", "arcmin", 1.0),
        (1.0, "deg", "arcmin", 60.0),
        (1.0, "L", "m^3", 1e-3),
        (1000.0, "mL", "L", 1.0),
        (1.0, "kWh", "J", 3.6e6),
        (1.0, "kWh", "Wh", 1000.0),
        (1.0, "rpm", "Hz", 1.0 / 60.0),
        (60.0, "rpm", "Hz", 1.0),
    ],
)
def test_new_base_unit_factors(value: float, from_u: str, to_u: str, expected: float) -> None:
    result, _ = unit_convert(value, from_u, to_u)
    assert float(np.asarray(result)) == pytest.approx(expected, rel=1e-9)


def test_rydberg_hartree_ratio() -> None:
    # 1 Ha = 2 Ry (exact, by definition).
    ry, _ = unit_convert(1.0, "Ry", "J")
    ha, _ = unit_convert(1.0, "Ha", "J")
    assert float(np.asarray(ha)) == pytest.approx(2.0 * float(np.asarray(ry)), rel=1e-12)


def test_ry_to_ev() -> None:
    result, _ = unit_convert(1.0, "Ry", "eV")
    assert float(np.asarray(result)) == pytest.approx(13.605693122994, rel=1e-9)


# ── Compound magnetization / resistivity units (already-supported via the
# dimensional engine -- pinned here so a future refactor can't silently
# regress the CGS<->SI equivalences the units-converter UI now exposes) ─────


def test_emu_per_cm3_to_a_per_m() -> None:
    # 1 emu/cm^3 = 1000 A/m (standard CGS<->SI volume-magnetization factor).
    result, _ = unit_convert(1.0, "emu/cm^3", "A/m")
    assert float(np.asarray(result)) == pytest.approx(1000.0, rel=1e-9)


def test_emu_per_g_to_am2_per_kg() -> None:
    # 1 emu/g = 1 A*m^2/kg exactly (both CGS factors are 1e-3 and cancel).
    result, _ = unit_convert(1.0, "emu/g", "A*m^2/kg")
    assert float(np.asarray(result)) == pytest.approx(1.0)


def test_resistivity_uohm_cm_to_ohm_m() -> None:
    # 1 uOhm*cm = 1e-8 Ohm*m.
    result, _ = unit_convert(1.0, "uOhm*cm", "Ohm*m")
    assert float(np.asarray(result)) == pytest.approx(1e-8, rel=1e-9)


def test_magnetic_field_a_per_m_matches_oe() -> None:
    result, _ = unit_convert(1000.0 / (4 * np.pi), "A/m", "Oe")
    assert float(np.asarray(result)) == pytest.approx(1.0, rel=1e-9)


def test_kilogauss_to_tesla() -> None:
    result, _ = unit_convert(1.0, "kG", "T")
    assert float(np.asarray(result)) == pytest.approx(0.1)


# ── Photon-energy hub: any pair converts directly, not just eV<->X ─────────


def test_nm_to_wavenumber_direct() -> None:
    # No eV round-trip needed: 500 nm -> 1/(500nm in cm) = 20000 cm^-1.
    result, _ = unit_convert(500.0, "nm", "cm^-1")
    assert float(np.asarray(result)) == pytest.approx(20000.0, rel=1e-9)


def test_nm_to_kelvin_direct() -> None:
    ev, _ = unit_convert(500.0, "nm", "eV")
    expected_k, _ = unit_convert(float(np.asarray(ev)), "eV", "K")
    result, _ = unit_convert(500.0, "nm", "K")
    assert float(np.asarray(result)) == pytest.approx(float(np.asarray(expected_k)), rel=1e-9)


def test_thz_to_kelvin_direct() -> None:
    result, _ = unit_convert(1.0, "THz", "K")
    ev, _ = unit_convert(1.0, "THz", "eV")
    expected, _ = unit_convert(float(np.asarray(ev)), "eV", "K")
    assert float(np.asarray(result)) == pytest.approx(float(np.asarray(expected)), rel=1e-9)


def test_wavenumber_to_nm_roundtrip() -> None:
    wn, _ = unit_convert(500.0, "nm", "cm^-1")
    back, _ = unit_convert(float(np.asarray(wn)), "cm^-1", "nm")
    assert float(np.asarray(back)) == pytest.approx(500.0, rel=1e-6)
