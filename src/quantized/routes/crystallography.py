"""Thin crystallography route. Wraps ``calc.crystallography`` (pure formulas).

Computes interplanar d-spacing from lattice parameters + Miller indices; the
math lives in calc, this only validates + serializes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.crystallography import d_spacing

router = APIRouter(prefix="/api/crystallography", tags=["crystallography"])


class DSpacingRequest(BaseModel):
    system: str
    a: float
    b: float = 0.0
    c: float = 0.0
    h: int
    k: int
    l: int


@router.post("/dspacing")
def dspacing(req: DSpacingRequest) -> dict[str, Any]:
    """Interplanar d-spacing for (h,k,l) in the given crystal system."""
    try:
        return d_spacing(req.system, req.a, req.b, req.c, req.h, req.k, req.l)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
