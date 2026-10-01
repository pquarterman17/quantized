"""Thin graded-SLD route: spline knots -> SLD(z) and its microslab stack.

Wraps ``calc.sld.spline_sld`` (knot interpolation, golden vs MATLAB
splineSLD) and ``calc.sld.profile_to_layers`` (SLD(z) -> midpoint slabs,
golden vs profileToLayers). The Reflectivity workshop models a graded layer
by splicing the returned slabs into its stack, then simulating as usual.
Fitting a graded layer goes through ``/fit`` with a ``graded`` spec, whose
knots are parameters (``calc.refl_graded`` builds the same slabs). No physics
here: validate, call calc, serialize.
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc.sld import profile_to_layers, spline_sld
from quantized.routes._errors import call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/reflectivity", tags=["reflectivity"])

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]

# One graded layer's knots, and the profile grid (the slab count is
# n_points - 1; each slab is one more Parratt layer per simulated point).
MAX_KNOTS = 64
MAX_POINTS = 2_001


class SplineSldRequest(BaseModel):
    """Knots (z Å, SLD Å⁻²) interpolated onto ``n_points`` over ``z_range``
    (default: 50 Å past each end knot); flat ambient/substrate outside."""

    z_knots: list[FiniteFloat] = Field(min_length=2, max_length=MAX_KNOTS)
    sld_knots: list[FiniteFloat] = Field(min_length=2, max_length=MAX_KNOTS)
    method: Literal["pchip", "spline", "makima", "linear"] = "pchip"
    sld_ambient: FiniteFloat | None = None
    sld_substrate: FiniteFloat | None = None
    z_range: tuple[FiniteFloat, FiniteFloat] | None = None
    n_points: int = Field(default=500, ge=2, le=MAX_POINTS)


@router.post("/spline-sld")
def spline_sld_route(req: SplineSldRequest) -> dict[str, Any]:
    """Graded SLD(z) from spline knots, plus its (M, 4) microslab layer stack.

    ``layers`` rows are ``[thickness, sld, sld_imag, roughness]`` (imaginary
    and roughness 0): a zero-thickness ambient row, one slab per grid step,
    and a zero-thickness substrate row.
    """
    sa = math.nan if req.sld_ambient is None else req.sld_ambient
    ss = math.nan if req.sld_substrate is None else req.sld_substrate
    z, sld = call_calc(
        spline_sld,
        req.z_knots,
        req.sld_knots,
        sld_ambient=sa,
        sld_substrate=ss,
        z_range=req.z_range,
        n_points=req.n_points,
        method=req.method,
    )
    layers = call_calc(profile_to_layers, z, sld, sld_ambient=sa, sld_substrate=ss)
    return {"z": to_jsonable(z), "sld": to_jsonable(sld), "layers": to_jsonable(layers)}
