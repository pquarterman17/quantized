"""Optics calculators (calc.optics).

Reference-value tested against the closed-form physics and the docstring
examples in ``quantized_matlab/+calc/+optics`` — universal optics formulas, not
MATLAB-idiosyncratic, so reference-value rather than golden-frozen (same
rationale as test_electrical / test_crystallography).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import optics
from quantized.calc.constants import constants


def test_fresnel_normal_incidence_air_glass() -> None:
    # Normal incidence air/glass: Rs = Rp = ((n1-n2)/(n1+n2))^2 = 0.04.
    r = optics.fresnel_coefficients(1.0, 1.5, 0.0)
    assert r["Rs"] == pytest.approx(0.04, rel=1e-12)
    assert r["Rp"] == pytest.approx(0.04, rel=1e-12)
    # Energy conservation at the interface: R + T = 1 (lossless media).
    assert r["Rs"] + r["Ts"] == pytest.approx(1.0, rel=1e-12)
    assert r["Rp"] + r["Tp"] == pytest.approx(1.0, rel=1e-12)


def test_fresnel_brewster_zeroes_rp() -> None:
    # At the Brewster angle, p-pol reflectance vanishes.
    theta_b = math.degrees(math.atan(1.5 / 1.0))
    r = optics.fresnel_coefficients(1.0, 1.5, theta_b)
    assert r["Rp"] == pytest.approx(0.0, abs=1e-12)
    assert r["Rs"] > 0.0


def test_fresnel_total_internal_reflection() -> None:
    # Above the critical angle (glass->air) both reflectances saturate at 1.
    r = optics.fresnel_coefficients(1.5, 1.0, 60.0)  # theta_c ~ 41.8 deg
    assert r["Rs"] == pytest.approx(1.0, rel=1e-12)
    assert r["Rp"] == pytest.approx(1.0, rel=1e-12)


def test_fresnel_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        optics.fresnel_coefficients(0.0, 1.5, 0.0)
    with pytest.raises(ValueError):
        optics.fresnel_coefficients(1.0, 1.5, -5.0)


def test_critical_angle_glass_air() -> None:
    # asin(1.0/1.5) = 41.81 deg.
    assert optics.critical_angle(1.5, 1.0)["theta_c"] == pytest.approx(41.8103, abs=1e-3)
    # diamond/air -> ~24.6 deg.
    assert optics.critical_angle(2.4, 1.0)["theta_c"] == pytest.approx(24.6243, abs=1e-3)


def test_critical_angle_nan_when_no_tir() -> None:
    assert math.isnan(optics.critical_angle(1.0, 1.5)["theta_c"])


def test_brewster_angle_air_glass() -> None:
    # atan(1.5) = 56.31 deg.
    assert optics.brewster_angle(1.0, 1.5)["theta_b"] == pytest.approx(56.3099, abs=1e-3)
    # air/diamond -> atan(2.4) = 67.38 deg.
    assert optics.brewster_angle(1.0, 2.4)["theta_b"] == pytest.approx(67.3801, abs=1e-3)


def test_penetration_depth_silicon() -> None:
    # Si at 400 nm (k = 0.39): depth = 400 / (4*pi*0.39) ~ 81.6 nm.
    r = optics.penetration_depth(5.6, 0.39, 400.0)
    assert r["depth"] == pytest.approx(400.0 / (4 * math.pi * 0.39), rel=1e-12)
    assert r["depth"] == pytest.approx(81.6, abs=0.1)
    # abs_length = depth / 2.
    assert r["abs_length"] == pytest.approx(r["depth"] / 2, rel=1e-12)


def test_penetration_depth_lossless_is_infinite() -> None:
    r = optics.penetration_depth(1.5, 0.0, 500.0)
    assert math.isinf(r["depth"])
    assert r["abs_coeff"] == 0.0


def test_penetration_depth_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        optics.penetration_depth(0.0, 0.1, 500.0)
    with pytest.raises(ValueError):
        optics.penetration_depth(1.5, -0.1, 500.0)
    with pytest.raises(ValueError):
        optics.penetration_depth(1.5, 0.1, 0.0)


def test_skin_depth_copper_1ghz() -> None:
    # Cu (rho = 1.68e-8 Ohm*m) at 1 GHz -> ~2.06 um.
    mu0 = constants()["mu0"]
    expected = math.sqrt(2 * 1.68e-8 / (2 * math.pi * 1e9 * mu0))
    r = optics.skin_depth(1.68e-8, 1e9)
    assert r["delta"] == pytest.approx(expected, rel=1e-12)
    assert r["delta_um"] == pytest.approx(2.06, abs=0.02)
    assert r["delta_nm"] == pytest.approx(r["delta"] * 1e9, rel=1e-12)


def test_skin_depth_copper_50hz() -> None:
    # Cu at 50 Hz mains -> ~9.2 mm.
    r = optics.skin_depth(1.68e-8, 50.0)
    assert r["delta"] == pytest.approx(9.22e-3, abs=0.1e-3)


def test_skin_depth_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        optics.skin_depth(0.0, 1e9)
    with pytest.raises(ValueError):
        optics.skin_depth(1.68e-8, 0.0)


def test_refractive_to_dielectric_silicon() -> None:
    # n = 3.5, k = 0 -> eps1 = 12.25, eps2 = 0.
    r = optics.refractive_to_dielectric(3.5, 0.0)
    assert r["eps1"] == pytest.approx(12.25, rel=1e-12)
    assert r["eps2"] == pytest.approx(0.0, abs=1e-12)
    # Gold at ~600 nm (n=0.15, k=3.6): eps1 = 0.0225 - 12.96, eps2 = 1.08.
    g = optics.refractive_to_dielectric(0.15, 3.6)
    assert g["eps1"] == pytest.approx(0.15**2 - 3.6**2, rel=1e-12)
    assert g["eps2"] == pytest.approx(2 * 0.15 * 3.6, rel=1e-12)


def test_refractive_to_dielectric_rejects_negative_k() -> None:
    with pytest.raises(ValueError):
        optics.refractive_to_dielectric(1.5, -0.1)


def test_dielectric_to_refractive_inverse() -> None:
    # eps1 = 12.25 -> n = 3.5, k = 0.
    r = optics.dielectric_to_refractive(12.25, 0.0)
    assert r["n"] == pytest.approx(3.5, rel=1e-9)
    assert r["k"] == pytest.approx(0.0, abs=1e-12)
    # Metallic regime: eps1 < 0, eps2 = 0 -> n = 0, k = sqrt(-eps1).
    m = optics.dielectric_to_refractive(-10.0, 0.0)
    assert m["n"] == pytest.approx(0.0, abs=1e-12)
    assert m["k"] == pytest.approx(math.sqrt(10.0), rel=1e-12)


def test_refractive_dielectric_roundtrip() -> None:
    # (n, k) -> (eps1, eps2) -> (n, k) recovers the original index.
    fwd = optics.refractive_to_dielectric(0.15, 3.6)
    back = optics.dielectric_to_refractive(fwd["eps1"], fwd["eps2"])
    assert back["n"] == pytest.approx(0.15, rel=1e-9)
    assert back["k"] == pytest.approx(3.6, rel=1e-9)
