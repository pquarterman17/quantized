"""Thin reductions route. Wraps ``calc.reductions`` (PORT_PLAN #19).

Williamson-Hall size/strain separation, FFT film thickness (Laue fringes),
reflectivity FFT (Kiessig fringes + superlattice analysis), and neutron
spin asymmetry. All math lives in calc; this only validates + serializes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.reductions import (
    fft_thickness,
    reflectivity_fft,
    spin_asymmetry,
    williamson_hall,
)

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
    try:
        return williamson_hall(
            req.two_theta_deg,
            req.fwhm_deg,
            wavelength_a=req.wavelength_a,
            k_factor=req.k_factor,
            instrumental_broadening_deg=req.instrumental_broadening_deg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
    try:
        return fft_thickness(
            req.two_theta_deg,
            req.intensity,
            req.wavelength_a,
            two_theta_min=req.two_theta_min,
            two_theta_max=req.two_theta_max,
            window=req.window,
            max_thickness_nm=req.max_thickness_nm,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
    try:
        return reflectivity_fft(
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
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class SpinAsymmetryRequest(BaseModel):
    r_pp: list[float]
    r_mm: list[float]
    dr_pp: list[float] | None = None
    dr_mm: list[float] | None = None


@router.post("/spin-asymmetry")
def spin_asymmetry_route(req: SpinAsymmetryRequest) -> dict[str, Any]:
    """Neutron spin asymmetry (R++ - R--)/(R++ + R--) with propagated error."""
    try:
        return spin_asymmetry(req.r_pp, req.r_mm, req.dr_pp, req.dr_mm)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
