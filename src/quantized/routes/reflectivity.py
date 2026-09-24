"""Thin specular-reflectivity routes.

Wraps the finished W3 calc helpers (``calc.reflectivity.parratt_refl`` — golden vs
MATLAB parrattRefl — and ``calc.sld`` SLD profile / presets). The route builds the
Q grid, validates the layer stack, calls the pure functions, and serializes. No
physics here; the recursion + Névot-Croce roughness live in ``calc/``.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.refl_fit import fit_reflectivity
from quantized.calc.reflectivity import parratt_refl
from quantized.calc.sld import refl_sld_presets, sld_profile
from quantized.routes._errors import call_calc
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
    r = call_calc(parratt_refl,
        q,
        req.layers,
        roughness=req.roughness,
        scale=req.scale,
        background=req.background,
        resolution=req.resolution,
    )
    return {"q": to_jsonable(q), "r": to_jsonable(r)}


@router.post("/sld-profile")
def sld_profile_route(req: SldProfileRequest) -> dict[str, Any]:
    """SLD(z) depth profile (error-function interfaces) for the layer stack."""
    _validate_layers(req.layers)
    z, sld = call_calc(sld_profile, req.layers, n_points=req.n_points, padding=req.padding)
    return {"z": to_jsonable(z), "sld": to_jsonable(sld)}


# ── fit to measured data (audit P2.2) ────────────────────────────────────────

# A fit evaluates the model ~10-100 times per free parameter, and a resolution-
# smeared evaluation costs 21x a plain one; these caps keep one request to
# seconds, not minutes.
FIT_MAX_POINTS = 20_000
FIT_MAX_PARAMETERS = 200
FIT_MAX_CHANNELS = 4

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]


class FitParameter(BaseModel):
    """One model parameter: ``L{i}.{thickness|sld|isld|roughness|msld}``,
    ``scale``, ``background`` or a per-channel scale/background name."""

    name: str = Field(min_length=1, max_length=64)
    value: FiniteFloat
    vary: bool = False
    min: FiniteFloat | None = None
    max: FiniteFloat | None = None
    tie: str | None = Field(default=None, max_length=64)


class FitChannel(BaseModel):
    """One measured curve. ``dq`` is a per-point 1-sigma resolution unless
    ``dq_is_fwhm``; ``resolution`` is a constant dQ/Q used when ``dq`` is absent."""

    q: list[FiniteFloat] = Field(min_length=2, max_length=FIT_MAX_POINTS)
    r: list[FiniteFloat] = Field(min_length=2, max_length=FIT_MAX_POINTS)
    dr: list[FiniteFloat] | None = Field(default=None, max_length=FIT_MAX_POINTS)
    dq: list[FiniteFloat] | None = Field(default=None, max_length=FIT_MAX_POINTS)
    dq_is_fwhm: bool = False
    resolution: float | None = Field(default=None, ge=0.0, le=0.5, allow_inf_nan=False)
    spin: Literal["+", "-"] | None = None
    q_min: FiniteFloat | None = None
    q_max: FiniteFloat | None = None
    scale: str = Field(default="scale", max_length=64)
    background: str = Field(default="background", max_length=64)
    label: str | None = Field(default=None, max_length=120)


class FitRequest(BaseModel):
    parameters: list[FitParameter] = Field(min_length=1, max_length=FIT_MAX_PARAMETERS)
    channels: list[FitChannel] = Field(min_length=1, max_length=FIT_MAX_CHANNELS)
    weighting: Literal["dr", "log"] = "dr"
    max_nfev: int = Field(default=2000, ge=1, le=20_000)


@router.post("/fit")
def fit_route(req: FitRequest) -> dict[str, Any]:
    """Fit the layer model to one or more measured reflectivity curves."""
    channels = []
    for ch in req.channels:
        c = ch.model_dump()
        for key in ("q_min", "q_max"):
            if c[key] is None:
                del c[key]
        channels.append(c)
    out = call_calc(
        fit_reflectivity,
        [p.model_dump() for p in req.parameters],
        channels,
        weighting=req.weighting,
        max_nfev=req.max_nfev,
    )
    result: dict[str, Any] = to_jsonable(out)
    return result
