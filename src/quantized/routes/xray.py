"""Thin X-ray / neutron calculator route. Wraps ``calc.xray`` (pure formulas).

Two endpoints: ``/calc`` dispatches the Bragg/Q/energy scalar conversions by
``mode``, and ``/neutron`` derives neutron wavelength/energy/velocity/
temperature all at once from one input quantity. The math lives in calc,
this only validates + serializes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.xray import neutron_calc, xray_calc

router = APIRouter(prefix="/api/xray", tags=["xray"])


class XrayCalcRequest(BaseModel):
    mode: str
    wavelength: float
    value: float
    n: int = 1


@router.post("/calc")
def calc(req: XrayCalcRequest) -> dict[str, Any]:
    """Bragg / Q / energy↔wavelength conversion. ``mode`` selects the quantity
    (see ``calc.xray`` for the full list)."""
    try:
        return xray_calc(req.mode, req.wavelength, req.value, req.n)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class NeutronCalcRequest(BaseModel):
    quantity: str
    value: float


@router.post("/neutron")
def neutron(req: NeutronCalcRequest) -> dict[str, Any]:
    """Neutron wavelength/energy/velocity/temperature, all derived from one
    input ``quantity`` (``wavelength``, ``energy``, ``velocity``, or
    ``temperature``); see ``calc.xray.neutron_calc``."""
    try:
        return neutron_calc(req.quantity, req.value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
