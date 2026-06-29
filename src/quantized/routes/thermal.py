"""Thin thermal-property routes. Wraps ``calc.thermal`` (pure formulas):
Wiedemann-Franz law / Debye temperature / thermal diffusivity. Validate ->
call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import thermal

router = APIRouter(prefix="/api/thermal", tags=["thermal"])


class WiedemannFranzRequest(BaseModel):
    sigma: float  # electrical conductivity (S/cm)
    temperature: float  # K


class DebyeRequest(BaseModel):
    v_s: float  # average sound velocity (m/s)
    n: float  # atomic number density (atoms/m^3)


class DiffusivityRequest(BaseModel):
    kappa: float  # thermal conductivity (W/m/K)
    rho: float  # mass density (kg/m^3)
    cp: float  # specific heat (J/kg/K)


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/wiedemann-franz")
def wiedemann_franz(req: WiedemannFranzRequest) -> dict[str, Any]:
    """κ = L₀·σ·T (W/(m·K))."""
    return _call(thermal.wiedemann_franz, req.sigma, req.temperature)


@router.post("/debye")
def debye(req: DebyeRequest) -> dict[str, Any]:
    """Θ_D = (ħ/k_B)·v_s·(6π²·n)^(1/3) (K)."""
    return _call(thermal.debye_temperature, req.v_s, req.n)


@router.post("/diffusivity")
def diffusivity(req: DiffusivityRequest) -> dict[str, Any]:
    """α = κ/(ρ·c_p) (m²/s)."""
    return _call(thermal.thermal_diffusivity, req.kappa, req.rho, req.cp)
