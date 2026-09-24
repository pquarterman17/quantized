"""Thin reductions route. Wraps ``calc.reductions`` (PORT_PLAN #19).

Williamson-Hall size/strain separation, FFT film thickness (Laue fringes),
reflectivity FFT (Kiessig fringes + superlattice analysis), and neutron
spin asymmetry. All math lives in calc; this only validates + serializes.
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

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


# Enumeration cost grows ~hkl_max³ per grid-search trial (0.19 s at 20, 0.6 s
# at 30, measured 2026-09-24), and a refinement runs ~100 trials. Past this the
# request would tie up a worker for minutes, so it is refused instead.
PAWLEY_HKL_LIMIT = 20
PAWLEY_MAX_POINTS = 50_000

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
Length = Annotated[float, Field(gt=0, le=1000, allow_inf_nan=False)]
Angle = Annotated[float, Field(gt=0, lt=180, allow_inf_nan=False)]


class PawleyRequest(BaseModel):
    two_theta: list[FiniteFloat] = Field(max_length=PAWLEY_MAX_POINTS)
    intensity: list[FiniteFloat] = Field(max_length=PAWLEY_MAX_POINTS)
    a: Length
    b: Length
    c: Length
    # Bravais centering. "R" is the hexagonal-axes (obverse) rule of
    # calc.crystallography.plane_spacings, not a rhombohedral-axes cell.
    symmetry: Literal["P", "F", "I", "A", "B", "C", "R"] = "P"
    alpha: Angle = 90.0
    beta: Angle = 90.0
    gamma: Angle = 90.0
    # Which axes move together; None keeps the engine's equality inference.
    tie: Literal["abc", "ab", "none"] | None = None
    # None → derived from the cell and max_two_theta (see _auto_hkl_max).
    hkl_max: int | None = Field(default=None, ge=1, le=PAWLEY_HKL_LIMIT)
    wavelength: float = Field(default=1.5406, gt=0, le=10, allow_inf_nan=False)
    min_two_theta: float = Field(default=0.0, ge=0, lt=180, allow_inf_nan=False)
    max_two_theta: float = Field(default=120.0, gt=0, le=180, allow_inf_nan=False)
    profile_fwhm: float = Field(default=0.05, gt=0, le=20, allow_inf_nan=False)
    refine_cell: bool = True
    max_iter: int = Field(default=20, ge=1, le=200)

    @model_validator(mode="after")
    def _physical_cell(self) -> PawleyRequest:
        ca, cb, cg = (math.cos(math.radians(v)) for v in (self.alpha, self.beta, self.gamma))
        if 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg <= 0:
            raise ValueError("alpha, beta and gamma do not describe a real (positive-volume) cell")
        if self.min_two_theta >= self.max_two_theta:
            raise ValueError("min_two_theta must be below max_two_theta")
        return self


def _auto_hkl_max(req: PawleyRequest) -> int:
    """Smallest index bound that enumerates every reflection up to max 2θ.

    ``|h| = |r*·a| ≤ a/d_min`` holds for any cell, with ``d_min = λ/(2 sin θ_max)``;
    5 % headroom covers the grid search growing the cell.
    """
    d_min = req.wavelength / (2.0 * math.sin(math.radians(req.max_two_theta / 2.0)))
    return max(1, math.ceil(1.05 * max(req.a, req.b, req.c) / d_min))


@router.post("/pawley")
def pawley_route(req: PawleyRequest) -> dict[str, Any]:
    """Whole-pattern Pawley unit-cell refinement for powder XRD."""
    hkl_max = req.hkl_max if req.hkl_max is not None else _auto_hkl_max(req)
    if hkl_max > PAWLEY_HKL_LIMIT:
        raise HTTPException(
            status_code=422,
            detail=(
                f"This cell needs Miller indices up to {hkl_max} to reach "
                f"{req.max_two_theta:g} deg 2theta (limit {PAWLEY_HKL_LIMIT}); "
                "refine over a narrower 2theta range."
            ),
        )
    phase: dict[str, Any] = {
        "a": req.a,
        "b": req.b,
        "c": req.c,
        "alpha": req.alpha,
        "beta": req.beta,
        "gamma": req.gamma,
        "symmetry": req.symmetry,
        "hklMax": hkl_max,
    }
    if req.tie is not None:
        phase["tie"] = req.tie
    out = call_calc(
        pawley_refine,
        req.two_theta,
        req.intensity,
        phase,
        wavelength=req.wavelength,
        min_two_theta=req.min_two_theta,
        max_two_theta=req.max_two_theta,
        profile_fwhm=req.profile_fwhm,
        refine_cell=req.refine_cell,
        max_iter=req.max_iter,
    )
    # Pure calc returns ndarrays + a NaN scale placeholder; normalize only at
    # the transport boundary so the calc contract stays untouched.
    return {
        **out,
        "hkl_max": hkl_max,
        "scale": None,
        "rwp": _finite_or_none(out["rwp"]),
        "rwp_initial": _finite_or_none(out["rwp_initial"]),
        "background": np.asarray(out["background"], dtype=float).tolist(),
        "model": np.asarray(out["model"], dtype=float).tolist(),
        "residual": np.asarray(out["residual"], dtype=float).tolist(),
    }


def _finite_or_none(v: float) -> float | None:
    return v if math.isfinite(float(v)) else None
