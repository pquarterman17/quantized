"""Thin-film deposition / implantation / metrology calculators (calc.thin_film).

Reference-value tested against the closed-form physics and the docstring
examples in ``quantized_matlab/+calc/+thinFilm`` — these are universal
formulas (Sauerbrey-style rates, Stoney, LSS), not MATLAB-idiosyncratic, so
reference-value rather than golden-frozen (same rationale as test_optics /
test_electrical). No MATLAB available at test time.
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import thin_film as tf
from quantized.calc.constants import constants


def test_deposition_rate_reference() -> None:
    # MATLAB example: 100 Å in 60 s -> 1.667 Å/s = 10 nm/min.
    r = tf.deposition_rate(100.0, 60.0)
    assert r["rate"] == pytest.approx(100.0 / 60.0, rel=1e-12)
    assert r["rate_nm_per_min"] == pytest.approx(10.0, rel=1e-12)


def test_diffusion_length_thermal_reference() -> None:
    # L = sqrt(D*t) = sqrt(1e-13 * 3600) cm; nm = cm*1e7, um = cm*1e4.
    r = tf.diffusion_length_thermal(1e-13, 3600.0)
    assert r["L"] == pytest.approx(math.sqrt(1e-13 * 3600.0), rel=1e-12)
    assert r["L_nm"] == pytest.approx(r["L"] * 1e7, rel=1e-12)
    assert r["L_um"] == pytest.approx(r["L"] * 1e4, rel=1e-12)


def test_dose_from_current_reference() -> None:
    # dose = I*t/(q*A); MATLAB example 1 uA, 60 s, 1 cm^2.
    q = constants()["e"]
    r = tf.dose_from_current(1e-6, 60.0, 1.0)
    assert r["dose"] == pytest.approx(1e-6 * 60.0 / (q * 1.0), rel=1e-12)


def test_dose_to_concentration_reference() -> None:
    # C_peak = dose / (sqrt(2*pi) * deltaRp_cm), deltaRp nm -> cm.
    r = tf.dose_to_concentration(1e15, 80.0, 25.0)
    expected = 1e15 / (math.sqrt(2 * math.pi) * 25.0 * 1e-7)
    assert r["Cpeak"] == pytest.approx(expected, rel=1e-12)


def test_kiessig_thickness_kinematic() -> None:
    # Uncorrected t = 2*pi/deltaQ; Qc reported as NaN.
    r = tf.kiessig_thickness(0.0628)
    assert r["thickness"] == pytest.approx(2 * math.pi / 0.0628, rel=1e-12)
    assert r["thickness_nm"] == pytest.approx(r["thickness"] * 0.1, rel=1e-12)
    assert math.isnan(r["Qc"])
    assert r["thickness_raw"] == pytest.approx(r["thickness"], rel=1e-12)


def test_kiessig_thickness_sld_correction() -> None:
    # Refraction-corrected: Qc = 4*sqrt(pi*SLD); t = 2*pi/sqrt(dQ^2 - 4*Qc^2).
    sld = 6.3e-6
    dq = 0.050
    r = tf.kiessig_thickness(dq, sld=sld)
    qc = 4 * math.sqrt(math.pi * sld)
    assert r["Qc"] == pytest.approx(qc, rel=1e-12)
    assert r["thickness"] == pytest.approx(2 * math.pi / math.sqrt(dq**2 - 4 * qc**2), rel=1e-12)
    # Corrected value exceeds the raw kinematic value near the edge.
    assert r["thickness"] > r["thickness_raw"]


def test_kiessig_thickness_qc_direct() -> None:
    # Passing Qc directly is equivalent to the SLD-derived branch.
    sld = 6.3e-6
    qc = 4 * math.sqrt(math.pi * sld)
    r = tf.kiessig_thickness(0.050, qc=qc)
    assert r["Qc"] == pytest.approx(qc, rel=1e-12)


def test_kiessig_thickness_below_edge_falls_back() -> None:
    # deltaQ at/below 2*Qc -> correction diverges -> kinematic fallback, Qc NaN.
    sld = 6.3e-6
    qc = 4 * math.sqrt(math.pi * sld)
    dq = 1.5 * qc  # < 2*Qc so arg = dq^2 - 4*Qc^2 < 0
    r = tf.kiessig_thickness(dq, sld=sld)
    assert math.isnan(r["Qc"])
    assert r["thickness"] == pytest.approx(2 * math.pi / dq, rel=1e-12)


def test_multilayer_thermal_conductivity_reference() -> None:
    # Series < min(k); parallel = thickness-weighted mean.
    r = tf.multilayer_thermal_conductivity([100.0, 50.0], [1.4, 148.0])
    k_series = 150.0 / (100.0 / 1.4 + 50.0 / 148.0)
    k_parallel = (1.4 * 100.0 + 148.0 * 50.0) / 150.0
    assert r["k_series"] == pytest.approx(k_series, rel=1e-12)
    assert r["k_parallel"] == pytest.approx(k_parallel, rel=1e-12)
    assert r["total_thickness"] == pytest.approx(150.0, rel=1e-12)
    assert r["n_layers"] == 2
    # Series bound below parallel, both bracketed by the layer extremes.
    assert r["k_series"] < r["k_parallel"]


def test_multilayer_thermal_size_mismatch_raises() -> None:
    with pytest.raises(ValueError):
        tf.multilayer_thermal_conductivity([100.0, 50.0], [1.4])


def test_projected_range_runs_and_is_positive() -> None:
    # LSS approximation: Rp positive, straggle smaller than the range.
    r = tf.projected_range("Ar", "Si", 100.0)
    assert r["Rp"] > 0
    assert 0 < r["deltaRp"] < r["Rp"]
    assert r["warning"].startswith("Approximate")


def test_projected_range_increases_with_energy() -> None:
    lo = tf.projected_range("B", "Si", 30.0)["Rp"]
    hi = tf.projected_range("B", "Si", 100.0)["Rp"]
    assert hi > lo


def test_projected_range_unknown_symbol_raises() -> None:
    with pytest.raises(ValueError):
        tf.projected_range("Zz", "Si", 100.0)


def test_sputter_rate_reference() -> None:
    # rate = Y * (J_A/q) * M / (rho*NA) * 1e7 nm/s; Au target, 1 mA/cm^2.
    c = constants()
    expected = 2.5 * (1.0e-3 / c["e"]) * 196.97 / (19.3 * c["NA"]) * 1e7
    r = tf.sputter_rate(2.5, 1.0, 19.3, 196.97)
    assert r["rate"] == pytest.approx(expected, rel=1e-12)
    assert r["rate_nm_per_min"] == pytest.approx(r["rate"] * 60, rel=1e-12)


def test_stoney_stress_reference() -> None:
    # sigma = Es*ts^2 / (6*(1-nu)*tf*R); 100 nm film on 500 um Si, R = 10 m.
    r = tf.stoney_stress(130e9, 0.28, 500e-6, 100e-9, 10.0)
    expected = (130e9 * (500e-6) ** 2) / (6 * (1 - 0.28) * 100e-9 * 10.0)
    assert r["stress"] == pytest.approx(expected, rel=1e-12)
    assert r["stress_MPa"] == pytest.approx(expected * 1e-6, rel=1e-12)
    assert r["stress_GPa"] == pytest.approx(expected * 1e-9, rel=1e-12)


def test_stoney_stress_sign_follows_curvature() -> None:
    tensile = tf.stoney_stress(130e9, 0.28, 500e-6, 100e-9, 10.0)["stress"]
    compressive = tf.stoney_stress(130e9, 0.28, 500e-6, 100e-9, -10.0)["stress"]
    assert tensile > 0 > compressive
    assert tensile == pytest.approx(-compressive, rel=1e-12)


def test_stoney_stress_zero_radius_raises() -> None:
    with pytest.raises(ValueError):
        tf.stoney_stress(130e9, 0.28, 500e-6, 100e-9, 0.0)


def test_thermal_mismatch_strain_only() -> None:
    # strain = (alphaFilm - alphaSub)*deltaT; no E -> stress NaN.
    r = tf.thermal_mismatch_strain(17e-6, 3e-6, -500.0)
    assert r["strain"] == pytest.approx((17e-6 - 3e-6) * -500.0, rel=1e-12)
    assert math.isnan(r["stress_MPa"])
    assert r["description"] == "compressive"


def test_thermal_mismatch_strain_with_stress() -> None:
    # stress = E*strain/(1-nu); MPa = Pa*1e-6.
    r = tf.thermal_mismatch_strain(17e-6, 3e-6, -500.0, e=200e9, nu=0.28)
    strain = (17e-6 - 3e-6) * -500.0
    assert r["stress_MPa"] == pytest.approx((200e9 * strain / (1 - 0.28)) * 1e-6, rel=1e-12)
    assert r["description"] == "compressive"


def test_thermal_mismatch_tensile_and_none() -> None:
    assert tf.thermal_mismatch_strain(17e-6, 3e-6, 500.0)["description"] == "tensile"
    assert tf.thermal_mismatch_strain(5e-6, 5e-6, 500.0)["description"] == "none"


def test_positive_input_validation() -> None:
    with pytest.raises(ValueError):
        tf.deposition_rate(0.0, 60.0)
    with pytest.raises(ValueError):
        tf.diffusion_length_thermal(1e-13, 0.0)
    with pytest.raises(ValueError):
        tf.dose_from_current(1e-6, 60.0, 0.0)
    with pytest.raises(ValueError):
        tf.kiessig_thickness(0.0)
    with pytest.raises(ValueError):
        tf.sputter_rate(0.0, 1.0, 19.3, 196.97)
