"""Thin optics routes. Wraps ``calc.optics`` (pure formulas): Fresnel
coefficients / critical angle / Brewster angle / penetration depth / skin depth
/ refractive-index <-> dielectric conversion. Validate -> call pure fn ->
serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import optics

router = APIRouter(prefix="/api/optics", tags=["optics"])


class FresnelRequest(BaseModel):
    n1: float
    n2: float
    theta: float  # angle of incidence (deg)


class AngleRequest(BaseModel):
    n1: float
    n2: float


class PenetrationDepthRequest(BaseModel):
    n: float
    k: float
    wavelength: float


class SkinDepthRequest(BaseModel):
    rho: float  # resistivity (Ohm*m, SI)
    f: float  # frequency (Hz)


class RefractiveToDielectricRequest(BaseModel):
    n: float
    k: float = 0.0


class DielectricToRefractiveRequest(BaseModel):
    eps1: float
    eps2: float = 0.0


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/fresnel")
def fresnel(req: FresnelRequest) -> dict[str, Any]:
    """Rs, Rp, Ts, Tp at an interface."""
    return _call(optics.fresnel_coefficients, req.n1, req.n2, req.theta)


@router.post("/critical-angle")
def critical_angle(req: AngleRequest) -> dict[str, Any]:
    """θ_c = arcsin(n₂/n₁) (deg); NaN if n₂ >= n₁."""
    return _call(optics.critical_angle, req.n1, req.n2)


@router.post("/brewster-angle")
def brewster_angle(req: AngleRequest) -> dict[str, Any]:
    """θ_B = arctan(n₂/n₁) (deg)."""
    return _call(optics.brewster_angle, req.n1, req.n2)


@router.post("/penetration-depth")
def penetration_depth(req: PenetrationDepthRequest) -> dict[str, Any]:
    """δ = λ/(4πk) (same unit as λ)."""
    return _call(optics.penetration_depth, req.n, req.k, req.wavelength)


@router.post("/skin-depth")
def skin_depth(req: SkinDepthRequest) -> dict[str, Any]:
    """δ = √(2ρ/(ωμ₀)) (m)."""
    return _call(optics.skin_depth, req.rho, req.f)


@router.post("/refractive-to-dielectric")
def refractive_to_dielectric(req: RefractiveToDielectricRequest) -> dict[str, Any]:
    """ε₁ = n²−k², ε₂ = 2nk."""
    return _call(optics.refractive_to_dielectric, req.n, req.k)


@router.post("/dielectric-to-refractive")
def dielectric_to_refractive(req: DielectricToRefractiveRequest) -> dict[str, Any]:
    """n, k from (ε₁, ε₂) via the physical square root."""
    return _call(optics.dielectric_to_refractive, req.eps1, req.eps2)
