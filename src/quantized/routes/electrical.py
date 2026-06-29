"""Thin electrical-transport routes. Wraps ``calc.electrical`` (pure formulas):
resistivity / sheet resistance / conductivity / mobility / current density /
Hall effect / Wiedemann-Franz. Validate -> call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import electrical

router = APIRouter(prefix="/api/electrical", tags=["electrical"])


class ResistivityRequest(BaseModel):
    rs: float
    t: float  # thickness (cm)


class SheetResistanceRequest(BaseModel):
    rho: float
    t: float


class ConductivityRequest(BaseModel):
    rho: float


class MobilityRequest(BaseModel):
    rho: float
    n: float


class CurrentDensityRequest(BaseModel):
    i: float
    area: float


class HallRequest(BaseModel):
    v_h: float
    i: float
    b: float
    t: float  # thickness (cm)


class WiedemannFranzRequest(BaseModel):
    temperature: float | list[float]
    resistivity: float | list[float]


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/resistivity")
def resistivity(req: ResistivityRequest) -> dict[str, Any]:
    """ρ = R_s·t (Ω·cm)."""
    return _call(electrical.resistivity, req.rs, req.t)


@router.post("/sheet-resistance")
def sheet_resistance(req: SheetResistanceRequest) -> dict[str, Any]:
    """R_s = ρ/t (Ω/sq)."""
    return _call(electrical.sheet_resistance, req.rho, req.t)


@router.post("/conductivity")
def conductivity(req: ConductivityRequest) -> dict[str, Any]:
    """σ = 1/ρ (S/cm)."""
    return _call(electrical.conductivity, req.rho)


@router.post("/mobility")
def mobility(req: MobilityRequest) -> dict[str, Any]:
    """μ = 1/(q·n·ρ) (cm²/V·s)."""
    return _call(electrical.mobility, req.rho, req.n)


@router.post("/current-density")
def current_density(req: CurrentDensityRequest) -> dict[str, Any]:
    """J = I/A (A/cm²)."""
    return _call(electrical.current_density, req.i, req.area)


@router.post("/hall")
def hall(req: HallRequest) -> dict[str, Any]:
    """Single-point Hall: R_H, carrier density, carrier type."""
    return _call(electrical.hall_single_point, req.v_h, req.i, req.b, req.t)


@router.post("/wiedemann-franz")
def wiedemann_franz(req: WiedemannFranzRequest) -> dict[str, Any]:
    """κ_e = L₀·T/ρ (W/(cm·K))."""
    return _call(electrical.wiedemann_franz, req.temperature, req.resistivity)
