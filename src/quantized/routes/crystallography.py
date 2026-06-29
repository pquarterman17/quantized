"""Thin crystallography route. Wraps ``calc.crystallography`` (pure formulas).

Computes interplanar d-spacing from lattice parameters + Miller indices, and the
unit-cell volume + theoretical density (from a chemical formula + Z); the math
lives in calc, this only validates + serializes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.crystallography import cell_volume, d_spacing, theoretical_density
from quantized.calc.formula import formula_mass

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


@router.post("/dspacing")
def dspacing(req: DSpacingRequest) -> dict[str, Any]:
    """Interplanar d-spacing for (h,k,l) in the given crystal system."""
    try:
        return d_spacing(
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
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
