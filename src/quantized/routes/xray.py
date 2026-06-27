"""Thin X-ray / neutron calculator route. Wraps ``calc.xray`` (pure formulas).

One endpoint dispatches the Bragg / Q↔2θ scalar conversions by ``mode``; the
math lives in calc, this only validates + serializes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.xray import xray_calc

router = APIRouter(prefix="/api/xray", tags=["xray"])


class XrayCalcRequest(BaseModel):
    mode: str
    wavelength: float
    value: float
    n: int = 1


@router.post("/calc")
def calc(req: XrayCalcRequest) -> dict[str, Any]:
    """Bragg / Q↔2θ conversion. ``mode`` selects the quantity (see calc.xray)."""
    try:
        return xray_calc(req.mode, req.wavelength, req.value, req.n)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
