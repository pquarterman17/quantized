"""Thin SLD-from-formula route. Wraps ``calc.sld_formula`` (pure).

One endpoint computes neutron + X-ray scattering-length densities (with the
imaginary/absorption parts) from a chemical formula, mass density, and probe
wavelengths. The physics lives in calc; this only validates + serializes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.sld_formula import (
    NEUTRON_WAVELENGTH,
    XRAY_WAVELENGTH,
    sld_from_formula,
)

router = APIRouter(prefix="/api/sld", tags=["sld"])


class SldRequest(BaseModel):
    formula: str
    density: float
    neutron_wavelength: float = NEUTRON_WAVELENGTH
    xray_wavelength: float = XRAY_WAVELENGTH


@router.post("/formula")
def formula(req: SldRequest) -> dict[str, Any]:
    """Neutron + X-ray SLD (real + imaginary) for a formula at a mass density."""
    try:
        return sld_from_formula(
            req.formula,
            req.density,
            neutron_wavelength=req.neutron_wavelength,
            xray_wavelength=req.xray_wavelength,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
