"""Semiconductor device-physics calculators (calc.semiconductor).

Reference-value tested against the closed-form physics and the docstring
examples in ``quantized_matlab/+calc/+semiconductor`` — universal device-physics
formulas, not MATLAB-idiosyncratic, so reference-value rather than golden-frozen
(same rationale as test_electrical / test_crystallography). No MATLAB is
available here, so each assertion either recomputes the closed form from the
shared CODATA constants or checks a published order-of-magnitude.
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import semiconductor as s
from quantized.calc.constants import constants

C = constants()


def test_material_presets_values() -> None:
    m = s.material_presets()
    assert m["Si"]["Eg"] == 1.12
    assert m["GaAs"]["me"] == 0.067
    assert math.isnan(float(m["SiO2"]["mh"]))


def test_intrinsic_carrier_conc_closed_form() -> None:
    r = s.intrinsic_carrier_conc(eg=1.12, me_star=1.08, mh_star=0.81, t=300.0)
    nc = 2.0 * (2.0 * math.pi * 1.08 * C["m_e"] * C["kB"] * 300.0 / C["h"] ** 2) ** 1.5 * 1e-6
    nv = 2.0 * (2.0 * math.pi * 0.81 * C["m_e"] * C["kB"] * 300.0 / C["h"] ** 2) ** 1.5 * 1e-6
    ni = math.sqrt(nc * nv) * math.exp(-1.12 * C["e"] / (2.0 * C["kB"] * 300.0))
    assert r["ni"] == pytest.approx(ni, rel=1e-12)
    assert r["Nc"] == pytest.approx(nc, rel=1e-12)
    # Si n_i at 300 K is ~1e10 cm^-3 (textbook range).
    assert 5e9 < r["ni"] < 2e10


def test_intrinsic_material_preset_matches_explicit() -> None:
    by_name = s.intrinsic_carrier_conc(material="Si")
    explicit = s.intrinsic_carrier_conc(eg=1.12, me_star=1.08, mh_star=0.81)
    assert by_name["ni"] == pytest.approx(explicit["ni"], rel=1e-12)


def test_intrinsic_requires_params_or_material() -> None:
    with pytest.raises(ValueError):
        s.intrinsic_carrier_conc(eg=1.12, me_star=1.08)  # mh_star missing
    with pytest.raises(ValueError):
        s.intrinsic_carrier_conc(material="Nonexistium")


def test_carrier_concentration_extrinsic_n_type() -> None:
    # MATLAB example: carrierConcentration(1e16, 0, 1.5e10).
    r = s.carrier_concentration(1e16, 0.0, 1.5e10)
    net = 1e16
    n = 0.5 * (net + math.sqrt(net**2 + 4.0 * 1.5e10**2))
    assert r["n"] == pytest.approx(n, rel=1e-12)
    assert r["p"] == pytest.approx(1.5e10**2 / n, rel=1e-12)
    assert r["type"] == "n"
    # mass-action law preserved
    assert r["n"] * r["p"] == pytest.approx(1.5e10**2, rel=1e-9)


def test_carrier_concentration_intrinsic_and_p_type() -> None:
    assert s.carrier_concentration(0.0, 0.0, 1.5e10)["type"] == "intrinsic"
    assert s.carrier_concentration(0.0, 1e16, 1.5e10)["type"] == "p"


def test_built_in_potential_reference() -> None:
    r = s.built_in_potential(1e17, 1e17, 9.65e9, 300.0)
    kt = C["kB"] * 300.0 / C["e"]
    assert r["Vbi"] == pytest.approx(kt * math.log(1e17 * 1e17 / 9.65e9**2), rel=1e-12)
    assert r["Vbi"] == pytest.approx(0.835, abs=2e-3)


def test_depletion_width_partition_and_units() -> None:
    r = s.depletion_width(0.7, 1e16, 1e17, epsilon_r=11.7)
    # x_n + x_p == W, and Wcm is W in cm.
    assert r["xn"] + r["xp"] == pytest.approx(r["W"], rel=1e-12)
    assert r["Wcm"] * 1e7 == pytest.approx(r["W"], rel=1e-9)
    # Lighter-doped (n) side holds the wider depletion region.
    assert r["xp"] > r["xn"]
    # Material preset fills epsilon_r identically.
    by_mat = s.depletion_width(0.7, 1e16, 1e17, material="Si")
    assert by_mat["W"] == pytest.approx(r["W"], rel=1e-12)


def test_depletion_width_kt_correction() -> None:
    # Vbi below 2kT/q collapses the depletion width to zero (Vbi_eff clamped).
    tiny = 2.0 * C["kB"] * 300.0 / C["e"] * 0.5
    assert s.depletion_width(tiny, 1e16, 1e17, epsilon_r=11.7)["W"] == 0.0


def test_diffusion_coeff_einstein() -> None:
    r = s.diffusion_coeff(1400.0, 300.0)
    assert r["D"] == pytest.approx(1400.0 * C["kB"] * 300.0 / C["e"], rel=1e-12)


def test_diffusion_length_reference() -> None:
    # MATLAB example: diffusionLength(25, 1e-6) -> 50 um.
    r = s.diffusion_length(25.0, 1e-6)
    assert r["L"] == pytest.approx(math.sqrt(25.0 * 1e-6), rel=1e-12)
    assert r["Lum"] == pytest.approx(50.0, rel=1e-12)


def test_dos_effective_mass_lookup() -> None:
    assert s.dos_effective_mass("GaAs", "e")["mStar"] == 0.067
    assert s.dos_effective_mass("Si", "h")["mStar"] == 0.81
    with pytest.raises(ValueError):
        s.dos_effective_mass("SiO2", "h")  # hole mass NaN


def test_fermi_level_n_type_above_ei() -> None:
    r = s.fermi_level(material="Si", nd=1e16)
    ni = s.intrinsic_carrier_conc(material="Si")["ni"]
    kt = C["kB"] * 300.0 / C["e"]
    assert r["EF"] == pytest.approx(kt * math.asinh(1e16 / (2.0 * ni)), rel=1e-12)
    assert r["EF"] > 0
    assert r["type"] == "n"
    # Symmetry: p-type doping gives the mirror-image (negative) Fermi level.
    assert s.fermi_level(material="Si", na=1e16)["EF"] == pytest.approx(-r["EF"], rel=1e-9)


def test_hall_coefficient_mixed_conduction() -> None:
    r = s.hall_coefficient(1e16, 1e4, 1400.0, 450.0)
    denom = (1e4 * 450.0 + 1e16 * 1400.0) ** 2
    expected = (1.0 / C["e"]) * (1e4 * 450.0**2 - 1e16 * 1400.0**2) / denom
    assert r["RH"] == pytest.approx(expected, rel=1e-12)
    assert r["apparent_type"] == "n"
    # Hole-dominated sample flips the apparent type.
    assert s.hall_coefficient(1e4, 1e16, 1400.0, 450.0)["apparent_type"] == "p"


def test_debye_length_closed_form() -> None:
    r = s.debye_length(1e16, epsilon_r=11.7, t=300.0)
    ld_m = math.sqrt(C["eps0"] * 11.7 * C["kB"] * 300.0 / (C["e"] ** 2 * 1e16 * 1e6))
    assert r["LDcm"] == pytest.approx(ld_m * 100.0, rel=1e-12)
    assert r["LD"] == pytest.approx(ld_m * 1e9, rel=1e-12)
    assert s.debye_length(1e16, material="Si")["LD"] == pytest.approx(r["LD"], rel=1e-12)


def test_mobility_model_si_limits() -> None:
    # N -> 0 approaches mu_max; heavy doping drops below it.
    light = s.mobility_model("Si", 300.0, 0.0)
    assert light["muE"] == pytest.approx(1252.0, rel=1e-9)
    assert light["muH"] == pytest.approx(407.0, rel=1e-9)
    heavy = s.mobility_model("Si", 300.0, 1e19)
    assert heavy["muE"] < light["muE"]


def test_mobility_model_temperature_scaling() -> None:
    base = s.mobility_model("Si", 300.0, 1e16)["muE"]
    hot = s.mobility_model("Si", 400.0, 1e16)["muE"]
    # beta_e = -2.4 -> hotter is lower mobility.
    assert hot < base


def test_sheet_carrier_density_reference() -> None:
    r = s.sheet_carrier_density(1e17, 1e-6)  # 100 nm = 1e-6 cm
    assert r["ns"] == pytest.approx(1e11, rel=1e-12)


def test_thermal_velocity_closed_form() -> None:
    r = s.thermal_velocity(0.26, 300.0)
    vth = math.sqrt(3.0 * C["kB"] * 300.0 / (0.26 * C["m_e"])) * 100.0
    assert r["vth"] == pytest.approx(vth, rel=1e-12)
    # Si electron thermal velocity ~2.3e7 cm/s.
    assert 1e7 < r["vth"] < 5e7


def test_invalid_inputs_rejected() -> None:
    with pytest.raises(ValueError):
        s.built_in_potential(0.0, 1e17, 1e10)
    with pytest.raises(ValueError):
        s.diffusion_coeff(-1.0)
    with pytest.raises(ValueError):
        s.thermal_velocity(0.0)
    with pytest.raises(ValueError):
        s.sheet_carrier_density(1e17, 0.0)
    with pytest.raises(ValueError):
        s.debye_length(1e16)  # neither epsilon_r nor material
