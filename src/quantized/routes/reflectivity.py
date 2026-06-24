"""Thin specular-reflectivity routes.

Wraps the finished W3 calc helpers (``calc.reflectivity.parratt_refl`` — golden vs
MATLAB parrattRefl — and ``calc.sld`` SLD profile / presets). The route builds the
Q grid, validates the layer stack, calls the pure functions, and serializes. No
physics here; the recursion + Névot-Croce roughness live in ``calc/``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.reflectivity import parratt_refl
from quantized.calc.sld import refl_sld_presets, sld_profile
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/reflectivity", tags=["reflectivity"])

# A layer row is [thickness Å, SLD_real Å⁻², SLD_imag Å⁻², roughness Å].
Layer = list[float]


class SimulateRequest(BaseModel):
    """Simulate R(Q) from a layer stack over a linear Q grid."""

    layers: list[Layer] = Field(min_length=2)
    q_min: float = Field(default=0.005, gt=0.0)
    q_max: float = Field(default=0.25, gt=0.0)
    n_points: int = Field(default=400, ge=2, le=20000)
    roughness: bool = True
    scale: float = 1.0
    background: float = 0.0
    resolution: float | None = None  # dQ/Q (constant relative resolution)


class SldProfileRequest(BaseModel):
    """SLD(z) depth profile from a layer stack (error-function interfaces)."""

    layers: list[Layer] = Field(min_length=2)
    n_points: int = Field(default=500, ge=2, le=20000)
    padding: float = Field(default=50.0, ge=0.0)


def _validate_layers(layers: list[Layer]) -> None:
    if any(len(row) != 4 for row in layers):
        raise HTTPException(
            status_code=422,
            detail="each layer must be [thickness, sld_real, sld_imag, roughness]",
        )


@router.get("/presets")
def get_presets() -> dict[str, Any]:
    """Material SLD presets (name/formula/sldX/sldN/sldImag/density)."""
    return {"presets": to_jsonable(refl_sld_presets())}


@router.post("/simulate")
def simulate(req: SimulateRequest) -> dict[str, Any]:
    """Specular reflectivity R(Q) for the layer stack over [q_min, q_max]."""
    _validate_layers(req.layers)
    if req.q_max <= req.q_min:
        raise HTTPException(status_code=422, detail="q_max must exceed q_min")
    q = np.linspace(req.q_min, req.q_max, req.n_points)
    try:
        r = parratt_refl(
            q,
            req.layers,
            roughness=req.roughness,
            scale=req.scale,
            background=req.background,
            resolution=req.resolution,
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"q": to_jsonable(q), "r": to_jsonable(r)}


@router.post("/sld-profile")
def sld_profile_route(req: SldProfileRequest) -> dict[str, Any]:
    """SLD(z) depth profile (error-function interfaces) for the layer stack."""
    _validate_layers(req.layers)
    try:
        z, sld = sld_profile(req.layers, n_points=req.n_points, padding=req.padding)
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"z": to_jsonable(z), "sld": to_jsonable(sld)}
