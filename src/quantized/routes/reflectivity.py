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
from quantized.calc.refl_model import layer_field
from quantized.calc.reflectivity import parratt_refl
from quantized.calc.sld import refl_sld_presets, sld_profile
from quantized.routes._errors import call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/reflectivity", tags=["reflectivity"])

# A layer row is [thickness Å, SLD_real Å⁻², SLD_imag Å⁻², roughness Å], with
# SLD_imag POSITIVE = absorption (the SLD presets' and sld_formula's
# convention). The golden Parratt engine uses the opposite sign, so the
# routes negate it before calling it — see BUG-029.
Layer = list[float]


def _engine_layers(layers: list[Layer]) -> list[Layer]:
    return [[t, re, -im, sig] for t, re, im, sig in layers]


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
        _engine_layers(req.layers),
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

# Cost caps. One model evaluation costs ~0.2 us per (point x layer), 21x that
# with resolution smearing (0.45 s for 20k smeared points in 5 layers,
# measured 2026-09-24), and a fit makes ~(n_free + 1) evaluations per TRF
# step. The per-evaluation cap keeps one evaluation near a second; the
# deadline stops any fit at a wall-clock budget and returns its best point.
FIT_MAX_POINTS = 20_000
FIT_MAX_PARAMETERS = 200
FIT_MAX_CHANNELS = 4
FIT_MAX_EVAL_UNITS = 4_000_000  # points x layers x (21 if smeared), summed
FIT_DEADLINE_S = 30.0
_SMEAR_SAMPLES = 21

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]


class ReflFitParameter(BaseModel):
    """One model parameter: ``L{i}.{thickness|sld|isld|roughness|msld}``,
    ``scale``, ``background`` or a per-channel scale/background name."""

    name: str = Field(min_length=1, max_length=64)
    value: FiniteFloat
    vary: bool = False
    min: FiniteFloat | None = None
    max: FiniteFloat | None = None
    tie: str | None = Field(default=None, max_length=64)


class ReflFitChannel(BaseModel):
    """One measured curve. ``dq`` is a per-point 1-sigma resolution unless
    ``dq_is_fwhm``; ``resolution`` is a constant 1-sigma dQ/Q, used instead of
    ``dq`` (never together)."""

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


class ReflFitRequest(BaseModel):
    parameters: list[ReflFitParameter] = Field(min_length=1, max_length=FIT_MAX_PARAMETERS)
    channels: list[ReflFitChannel] = Field(min_length=1, max_length=FIT_MAX_CHANNELS)
    weighting: Literal["dr", "log"] = "dr"
    max_nfev: int = Field(default=200, ge=1, le=2000)


def _eval_units(req: ReflFitRequest) -> int:
    idx = [lf[0] for p in req.parameters if (lf := layer_field(p.name))]
    layers = 1 + max(idx, default=0)
    units = 0
    for ch in req.channels:
        smeared = ch.dq is not None or (ch.resolution or 0.0) > 0
        units += len(ch.q) * layers * (_SMEAR_SAMPLES if smeared else 1)
    return units


@router.post("/fit")
def fit_route(req: ReflFitRequest) -> dict[str, Any]:
    """Fit the layer model to one or more measured reflectivity curves."""
    units = _eval_units(req)
    if units > FIT_MAX_EVAL_UNITS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"this fit would cost {units:,} point-layer evaluations per model "
                f"evaluation (limit {FIT_MAX_EVAL_UNITS:,}); narrow the Q window, "
                "use fewer points or layers, or drop resolution smearing"
            ),
        )
    out = call_calc(
        fit_reflectivity,
        [p.model_dump() for p in req.parameters],
        [c.model_dump() for c in req.channels],
        weighting=req.weighting,
        max_nfev=req.max_nfev,
        deadline_s=FIT_DEADLINE_S,
    )
    result: dict[str, Any] = to_jsonable(out)
    return result
