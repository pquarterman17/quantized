"""Thin substrate routes. Wraps ``calc.substrates`` (reference table +
lattice-mismatch formula). Validate -> call the pure fn -> serialize.

GET endpoints expose the substrate reference table (list + single lookup);
the POST endpoint computes the epitaxial lattice mismatch f = (a_f - a_s)/a_s.
"""

from __future__ import annotations

import math
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import critical_thickness_models as ct_models
from quantized.calc import substrates
from quantized.calc.substrate_orientation import substrate_orientation
from quantized.routes._errors import CALC_ERRORS, call_calc

router = APIRouter(prefix="/api/substrates", tags=["substrates"])


class MismatchRequest(BaseModel):
    a_film: float
    a_sub: float


class CriticalThicknessRequest(BaseModel):
    a_film: float
    a_sub: float
    nu: float = 0.3  # Poisson ratio


class CriticalThicknessModelRequest(BaseModel):
    """Labeled extension models. Every material parameter is an input."""

    model: Literal["matthews_blakeslee", "people_bean"]
    a_film: float
    a_sub: float
    nu: float
    b: float | None = None  # None -> a_film/sqrt(2) (stated assumption, as the parity card)
    alpha_deg: float = 60.0  # MB only: dislocation line vs Burgers vector
    lambda_deg: float = 60.0  # MB only: Burgers vector vs in-plane normal to the line


@router.get("")
def list_substrates() -> dict[str, list[dict[str, Any]]]:
    """Full substrate reference table (list of property dicts)."""
    return {"substrates": substrates.substrate_table()}


@router.get("/{name}/orientation")
def get_orientation(name: str) -> dict[str, Any]:
    """Miller indices (hkl / hkil) and surface net of a substrate's orientation."""
    try:
        return substrate_orientation(name)
    except (ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{name}")
def get_substrate(name: str) -> dict[str, Any]:
    """Single substrate property card by name (case-insensitive)."""
    try:
        return substrates.get_substrate(name)
    except (ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/mismatch")
def mismatch(req: MismatchRequest) -> dict[str, Any]:
    """f = (a_film - a_sub)/a_sub, with tensile/compressive/matched label."""
    return call_calc(substrates.lattice_mismatch, req.a_film, req.a_sub)


@router.post("/critical-thickness")
def critical_thickness(req: CriticalThicknessRequest) -> dict[str, Any]:
    """MATLAB-parity Matthews-Blakeslee critical thickness h_c (Å, nm)."""
    try:
        result = substrates.critical_thickness(req.a_film, req.a_sub, nu=req.nu)
        if math.isinf(result["h_c"]):
            return {**result, "h_c": None, "h_c_nm": None, "matched": True}
        return {**result, "matched": False}
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/critical-thickness-model")
def critical_thickness_model(req: CriticalThicknessModelRequest) -> dict[str, Any]:
    """People-Bean or Matthews-Blakeslee (configurable slip) h_c; labeled, fail-closed."""

    def run() -> dict[str, Any]:
        if req.a_film <= 0 or req.a_sub <= 0:
            raise ValueError("a_film and a_sub must be positive")
        f = (req.a_film - req.a_sub) / req.a_sub
        b = req.b if req.b is not None else req.a_film / math.sqrt(2.0)
        if req.model == "people_bean":
            return ct_models.people_bean(f, b, req.a_film, nu=req.nu)
        return ct_models.matthews_blakeslee_general(
            f, b, nu=req.nu, alpha_deg=req.alpha_deg, lambda_deg=req.lambda_deg
        )

    result = call_calc(run)
    if math.isinf(result["h_c"]):
        return {**result, "h_c": None, "h_c_nm": None, "matched": True}
    return {**result, "matched": False}
