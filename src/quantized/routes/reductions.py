"""Thin reductions route. Wraps ``calc.reductions`` (PORT_PLAN #19).

Williamson-Hall size/strain separation, FFT film thickness (Laue fringes),
reflectivity FFT (Kiessig fringes + superlattice analysis), and neutron
spin asymmetry. All math lives in calc; this only validates + serializes.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

from quantized.calc.pawley import pawley_refine
from quantized.calc.reductions import (
    fft_thickness,
    reflectivity_fft,
    spin_asymmetry,
    williamson_hall,
)
from quantized.routes._errors import call_calc

router = APIRouter(prefix="/api/reductions", tags=["reductions"])


class WilliamsonHallRequest(BaseModel):
    two_theta_deg: list[float]
    fwhm_deg: list[float]
    wavelength_a: float = 1.5406
    k_factor: float = 0.9
    instrumental_broadening_deg: float = 0.0


@router.post("/williamson-hall")
def williamson_hall_route(req: WilliamsonHallRequest) -> dict[str, Any]:
    """Crystallite size + microstrain from XRD peak positions and widths."""
    return call_calc(williamson_hall,
        req.two_theta_deg,
        req.fwhm_deg,
        wavelength_a=req.wavelength_a,
        k_factor=req.k_factor,
        instrumental_broadening_deg=req.instrumental_broadening_deg,
    )


class FFTThicknessRequest(BaseModel):
    two_theta_deg: list[float]
    intensity: list[float]
    wavelength_a: float
    two_theta_min: float | None = None
    two_theta_max: float | None = None
    window: str = "hann"
    max_thickness_nm: float = 200.0


@router.post("/fft-thickness")
def fft_thickness_route(req: FFTThicknessRequest) -> dict[str, Any]:
    """Film thickness from Laue-fringe periodicity (XRD FFT)."""
    return call_calc(fft_thickness,
        req.two_theta_deg,
        req.intensity,
        req.wavelength_a,
        two_theta_min=req.two_theta_min,
        two_theta_max=req.two_theta_max,
        window=req.window,
        max_thickness_nm=req.max_thickness_nm,
    )


class ReflectivityFFTRequest(BaseModel):
    x: list[float]
    reflectivity: list[float]
    is_neutron: bool = False
    wavelength_a: float | None = None
    x_min: float | None = None
    x_max: float | None = None
    window: str = "hann"
    preprocess: str = "logR"
    max_thickness_nm: float = 500.0
    peak_prominence_threshold: float = 0.05


@router.post("/reflectivity-fft")
def reflectivity_fft_route(req: ReflectivityFFTRequest) -> dict[str, Any]:
    """Kiessig-fringe FFT thickness(es) + superlattice analysis."""
    return call_calc(reflectivity_fft,
        req.x,
        req.reflectivity,
        is_neutron=req.is_neutron,
        wavelength_a=req.wavelength_a,
        x_min=req.x_min,
        x_max=req.x_max,
        window=req.window,
        preprocess=req.preprocess,
        max_thickness_nm=req.max_thickness_nm,
        peak_prominence_threshold=req.peak_prominence_threshold,
    )


class SpinAsymmetryRequest(BaseModel):
    r_pp: list[float]
    r_mm: list[float]
    dr_pp: list[float] | None = None
    dr_mm: list[float] | None = None


@router.post("/spin-asymmetry")
def spin_asymmetry_route(req: SpinAsymmetryRequest) -> dict[str, Any]:
    """Neutron spin asymmetry (R++ - R--)/(R++ + R--) with propagated error."""
    return call_calc(spin_asymmetry, req.r_pp, req.r_mm, req.dr_pp, req.dr_mm)


class PawleyRequest(BaseModel):
    two_theta: list[float]
    intensity: list[float]
    a: float
    b: float
    c: float
    symmetry: str = "P"
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    hkl_max: int = 6
    wavelength: float = 1.5406
    max_two_theta: float = 120.0
    profile_fwhm: float = 0.05
    refine_cell: bool = True
    max_iter: int = 20


@router.post("/pawley")
def pawley_route(req: PawleyRequest) -> dict[str, Any]:
    """Whole-pattern Pawley unit-cell refinement for powder XRD."""
    out = call_calc(
        pawley_refine,
        req.two_theta,
        req.intensity,
        {
            "a": req.a,
            "b": req.b,
            "c": req.c,
            "alpha": req.alpha,
            "beta": req.beta,
            "gamma": req.gamma,
            "symmetry": req.symmetry,
            "hklMax": req.hkl_max,
        },
        wavelength=req.wavelength,
        max_two_theta=req.max_two_theta,
        profile_fwhm=req.profile_fwhm,
        refine_cell=req.refine_cell,
        max_iter=req.max_iter,
    )
    # Pure calc returns ndarrays + a NaN scale placeholder; normalize only at
    # the transport boundary so the calc contract stays untouched.
    return {
        **out,
        "scale": out["scale"] if math.isfinite(float(out["scale"])) else None,
        "rwp": out["rwp"] if math.isfinite(float(out["rwp"])) else None,
        "background": np.asarray(out["background"], dtype=float).tolist(),
        "model": np.asarray(out["model"], dtype=float).tolist(),
        "residual": np.asarray(out["residual"], dtype=float).tolist(),
    }
