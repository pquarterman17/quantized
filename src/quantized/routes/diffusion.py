"""Thin diffusion routes. Wraps ``calc.diffusion`` (pure formulas): Arrhenius
diffusion coefficient / diffusion length / Fick's first-law flux. Validate ->
call the pure fn -> serialize.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from quantized.calc import diffusion
from quantized.routes._errors import call_calc as _call

router = APIRouter(prefix="/api/diffusion", tags=["diffusion"])


class ArrheniusRequest(BaseModel):
    d0: float  # pre-exponential factor (cm²/s)
    ea: float  # activation energy (eV)
    t: float  # temperature (K)


class DiffusionLengthRequest(BaseModel):
    d: float  # diffusion coefficient (cm²/s)
    t: float  # time (s)


class FickFluxRequest(BaseModel):
    d: float  # diffusion coefficient (cm²/s)
    dc: float  # concentration difference (cm⁻³)
    dx: float  # distance (cm)


class CProfileRequest(BaseModel):
    x: float | list[float]  # depth(s) from the surface (cm)
    t: float  # diffusion time (s)
    d: float  # diffusion coefficient (cm²/s)
    c0: float  # surface concentration


@router.post("/arrhenius")
def arrhenius(req: ArrheniusRequest) -> dict[str, Any]:
    """D = D0·exp(-Ea/(kB·T)) (cm²/s)."""
    return _call(diffusion.arrhenius, req.d0, req.ea, req.t)


@router.post("/diffusion-length")
def diffusion_length(req: DiffusionLengthRequest) -> dict[str, Any]:
    """L = √(D·t) (cm)."""
    return _call(diffusion.diffusion_length, req.d, req.t)


@router.post("/fick-flux")
def fick_flux(req: FickFluxRequest) -> dict[str, Any]:
    """J = -D·ΔC/Δx (atoms/(cm²·s))."""
    return _call(diffusion.fick_flux, req.d, req.dc, req.dx)


@router.post("/c-profile")
def c_profile(req: CProfileRequest) -> dict[str, Any]:
    """c(x,t) = c0·erfc(x / (2√(D·t))) — constant-source diffusion profile."""
    return _call(diffusion.c_profile, req.x, req.t, req.d, req.c0)
