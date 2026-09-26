"""Thin crystallography route. Wraps ``calc.crystallography`` (pure formulas).

Computes interplanar d-spacing from lattice parameters + Miller indices, atomic
bond angles from fractional coordinates, and unit-cell volume + theoretical
density (from a chemical formula + Z); the math lives in calc, this only
validates + serializes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.crystallography import (
    bond_angle,
    cell_volume,
    d_spacing,
    interplanar_angle,
    theoretical_density,
)
from quantized.calc.formula import formula_mass
from quantized.routes._errors import CALC_ERRORS, call_calc

router = APIRouter(prefix="/api/crystallography", tags=["crystallography"])


class DSpacingRequest(BaseModel):
    system: str
    a: float
    b: float = 0.0
    c: float = 0.0
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    h: int
    k: int
    l: int  # noqa: E741 — Miller index, the conventional name
    i: int | None = None  # optional 4-index Miller-Bravais form (hexagonal only)


@router.post("/dspacing")
def dspacing(req: DSpacingRequest) -> dict[str, Any]:
    """Interplanar d-spacing for (h,k,l) — or (h,k,i,l) for hexagonal — in the
    given crystal system."""
    return call_calc(d_spacing,
        req.system,
        req.a,
        req.b,
        req.c,
        req.h,
        req.k,
        req.l,
        alpha=req.alpha,
        beta=req.beta,
        gamma=req.gamma,
        i=req.i,
    )


class InterplanarAngleRequest(BaseModel):
    system: str
    a: float
    b: float = 0.0
    c: float = 0.0
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    h1: int
    k1: int
    l1: int  # noqa: E741 — Miller index, the conventional name
    h2: int
    k2: int
    l2: int  # noqa: E741 — Miller index, the conventional name


@router.post("/angle")
def angle(req: InterplanarAngleRequest) -> dict[str, Any]:
    """Angle between two lattice planes (h1k1l1) and (h2k2l2), for any of the
    seven crystal systems, via the reciprocal metric tensor."""
    return call_calc(interplanar_angle,
        req.system,
        req.a,
        req.b,
        req.c,
        req.h1,
        req.k1,
        req.l1,
        req.h2,
        req.k2,
        req.l2,
        alpha=req.alpha,
        beta=req.beta,
        gamma=req.gamma,
    )


class BondAngleRequest(BaseModel):
    a: float
    b: float
    c: float
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    atom1: tuple[float, float, float]
    vertex: tuple[float, float, float]
    atom3: tuple[float, float, float]
    minimum_image: bool = True


@router.post("/bond-angle")
def atomic_bond_angle(req: BondAngleRequest) -> dict[str, Any]:
    """Angle atom1-vertex-atom3 from fractional unit-cell coordinates."""
    return call_calc(
        bond_angle,
        req.a,
        req.b,
        req.c,
        req.alpha,
        req.beta,
        req.gamma,
        req.atom1,
        req.vertex,
        req.atom3,
        minimum_image=req.minimum_image,
    )


class CellRequest(BaseModel):
    a: float
    b: float = 0.0  # ≤ 0 → defaults to a (cubic / rhombohedral)
    c: float = 0.0  # ≤ 0 → defaults to a
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    formula: str = ""  # optional — enables molar mass + theoretical density
    z: int = 1  # formula units per cell


@router.post("/cell")
def cell(req: CellRequest) -> dict[str, Any]:
    """Unit-cell volume (Å³) and, when a formula is given, molar mass + density."""
    try:
        a = req.a
        b = req.b if req.b > 0 else a
        c = req.c if req.c > 0 else a
        volume = cell_volume(a, b, c, req.alpha, req.beta, req.gamma)
        out: dict[str, Any] = {"volume": volume}
        if req.formula.strip():
            mass = formula_mass(req.formula)
            out["molar_mass"] = mass
            out["density"] = theoretical_density(mass, req.z, volume)
        return out
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
