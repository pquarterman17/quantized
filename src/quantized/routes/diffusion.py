"""Thin diffusion routes. Wraps ``calc.diffusion`` (pure formulas): Arrhenius
diffusion coefficient / diffusion length / Fick's first-law flux. Validate ->
call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import diffusion

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


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
