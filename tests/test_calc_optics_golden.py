"""Optics calculators (calc.optics) -- golden parity vs quantized_matlab.

DIRACULATOR_AUDIT P1 evidence. Golden fixtures are STAGED: run
tools/matlab/freeze_diraculator_values.m against ../quantized_matlab, then
these tests exercise for real; until then they SKIP via load_golden.

Classification: class (a) for all seven ops -- calc/optics.py is a direct,
verbatim port of the seven +calc/+optics/*.m files (confirmed by source
comparison: formulas match term-for-term, including the k=0 -> Inf branch
in penetrationDepth.m and the n2>=n1 -> NaN branch in criticalAngle.m).
Fresnel outputs are frozen as real reflectance/transmittance (|r|^2, energy
form) since jsonencode cannot serialize the complex amplitude coefficients
(rs/rp/ts/tp) -- matching fresnel_coefficients' own return contract, which
only exposes Rs/Rp/Ts/Tp for the same reason.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.optics import (
    brewster_angle,
    critical_angle,
    dielectric_to_refractive,
    fresnel_coefficients,
    penetration_depth,
    refractive_to_dielectric,
    skin_depth,
)


@pytest.mark.golden
def test_fresnel_coefficients_normal_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.fresnelCoefficients(1.0, 1.5, 30) -> Rs/Rp/Ts/Tp."""
    g = load_golden("calc_dira_optics_fresnel_normal.json")
    out = fresnel_coefficients(1.0, 1.5, 30.0)
    compare_calc(out["Rs"], g["output"]["Rs"])
    compare_calc(out["Rp"], g["output"]["Rp"])
    compare_calc(out["Ts"], g["output"]["Ts"])
    compare_calc(out["Tp"], g["output"]["Tp"])


@pytest.mark.golden
def test_fresnel_coefficients_tir_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.fresnelCoefficients(1.5, 1.0, 50) -- beyond critical angle
    (evanescent transmission branch, generalised Snell's law)."""
    g = load_golden("calc_dira_optics_fresnel_tir.json")
    out = fresnel_coefficients(1.5, 1.0, 50.0)
    compare_calc(out["Rs"], g["output"]["Rs"])
    compare_calc(out["Rp"], g["output"]["Rp"])
    compare_calc(out["Ts"], g["output"]["Ts"])
    compare_calc(out["Tp"], g["output"]["Tp"])


@pytest.mark.golden
def test_critical_angle_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.criticalAngle(1.5, 1.0) -> thetaC (TIR exists)."""
    g = load_golden("calc_dira_optics_critical_angle.json")
    out = critical_angle(1.5, 1.0)
    compare_calc(out["theta_c"], g["output"]["thetaC"])


@pytest.mark.golden
def test_critical_angle_nan_branch_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.criticalAngle(1.0, 1.5) -> NaN (n2 >= n1, no TIR).

    Exercises the jsonencode NaN -> null golden quirk (compare_calc treats
    a null/NaN expected value as NaN-equal).
    """
    g = load_golden("calc_dira_optics_critical_angle_nan.json")
    out = critical_angle(1.0, 1.5)
    compare_calc(out["theta_c"], g["output"]["thetaC"])


@pytest.mark.golden
def test_brewster_angle_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.brewsterAngle(1.0, 1.5) -> thetaB."""
    g = load_golden("calc_dira_optics_brewster.json")
    out = brewster_angle(1.0, 1.5)
    compare_calc(out["theta_b"], g["output"]["thetaB"])


@pytest.mark.golden
def test_penetration_depth_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.penetrationDepth(5.6, 0.39, 400) -> depth/absCoeff/absLength (Si @ 400nm)."""
    g = load_golden("calc_dira_optics_penetration_depth.json")
    out = penetration_depth(5.6, 0.39, 400.0)
    compare_calc(out["depth"], g["output"]["depth"])
    compare_calc(out["abs_coeff"], g["output"]["absCoeff"])
    compare_calc(out["abs_length"], g["output"]["absLength"])


@pytest.mark.golden
def test_skin_depth_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.skinDepth(1.68e-8, 1e9) -> delta/deltaUm/deltaNm (Cu @ 1 GHz)."""
    g = load_golden("calc_dira_optics_skin_depth.json")
    out = skin_depth(1.68e-8, 1e9)
    compare_calc(out["delta"], g["output"]["delta"])
    compare_calc(out["delta_um"], g["output"]["deltaUm"])
    compare_calc(out["delta_nm"], g["output"]["deltaNm"])


@pytest.mark.golden
def test_dielectric_to_refractive_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.dielectricToRefractive(12.25, 0) -> n/k (Si, lossless)."""
    g = load_golden("calc_dira_optics_dielectric_to_refractive.json")
    out = dielectric_to_refractive(12.25, 0.0)
    compare_calc(out["n"], g["output"]["n"])
    compare_calc(out["k"], g["output"]["k"])


@pytest.mark.golden
def test_dielectric_to_refractive_metal_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.dielectricToRefractive(-10, 2) -> n/k (metallic regime, eps1<0)."""
    g = load_golden("calc_dira_optics_dielectric_to_refractive_metal.json")
    out = dielectric_to_refractive(-10.0, 2.0)
    compare_calc(out["n"], g["output"]["n"])
    compare_calc(out["k"], g["output"]["k"])


@pytest.mark.golden
def test_refractive_to_dielectric_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.refractiveToDielectric(3.5, 0) -> eps1/eps2 (Si, IR)."""
    g = load_golden("calc_dira_optics_refractive_to_dielectric.json")
    out = refractive_to_dielectric(3.5, 0.0)
    compare_calc(out["eps1"], g["output"]["eps1"])
    compare_calc(out["eps2"], g["output"]["eps2"])


@pytest.mark.golden
def test_refractive_to_dielectric_gold_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.optics.refractiveToDielectric(0.15, 3.6) -> eps1/eps2 (gold @ ~600nm)."""
    g = load_golden("calc_dira_optics_refractive_to_dielectric_gold.json")
    out = refractive_to_dielectric(0.15, 3.6)
    compare_calc(out["eps1"], g["output"]["eps1"])
    compare_calc(out["eps2"], g["output"]["eps2"])
