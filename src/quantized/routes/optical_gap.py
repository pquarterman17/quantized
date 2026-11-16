"""Thin optical-gap (Tauc) route. Wraps ``calc.optical_gap``."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.optical_gap import (
    absorption_from_transmittance,
    energy_from_wavelength_nm,
    tauc_fit,
)
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/optical-gap", tags=["optical-gap"])


class TaucRequest(BaseModel):
    """Spectrum + optional conversions. ``x`` is photon energy (eV) or
    wavelength (nm); ``y`` is alpha (1/cm), or transmittance when
    ``signal='transmittance'`` (then ``thickness_nm`` is required)."""

    x: list[float]
    y: list[float]
    x_unit: Literal["eV", "nm"] = "eV"
    signal: Literal["alpha", "transmittance"] = "alpha"
    percent: bool = False  # transmittance / reflectance given in percent
    thickness_nm: float | None = None
    reflectance: list[float] | None = None
    kind: Literal["direct", "direct-forbidden", "indirect", "indirect-forbidden"] = "direct"
    e_min: float | None = None
    e_max: float | None = None
    level: float = Field(default=0.95, gt=0.0, lt=1.0)


@router.post("/tauc")
def tauc(req: TaucRequest) -> dict[str, Any]:
    """Tauc transform and linear-edge fit -> optical band gap Eg (eV)."""
    if len(req.x) != len(req.y):
        raise HTTPException(status_code=422, detail="x and y must have the same length")
    try:
        x = np.asarray(req.x, dtype=float)
        energy = energy_from_wavelength_nm(x) if req.x_unit == "nm" else x
        y = np.asarray(req.y, dtype=float)
        if req.signal == "transmittance":
            if req.thickness_nm is None:
                raise ValueError("thickness is required to convert transmittance to absorption")
            k = 0.01 if req.percent else 1.0
            refl = None if req.reflectance is None else np.asarray(req.reflectance, dtype=float) * k
            y = absorption_from_transmittance(y * k, req.thickness_nm * 1e-7, refl)
        res = tauc_fit(energy, y, req.kind, req.e_min, req.e_max, req.level)
        return to_jsonable(res)  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
