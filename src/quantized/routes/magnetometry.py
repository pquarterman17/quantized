"""Thin magnetometry routes. Wraps ``calc.magnetometry`` (golden vs MATLAB):
hysteresis-loop analysis, high-T background subtraction, sample-aware unit
conversion. Validate -> call the pure fn -> serialize; no analysis here.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.magnetometry import (
    convert_mag_units,
    hysteresis_analysis,
    subtract_hysteresis_background,
    subtract_mag_background,
)
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/magnetometry", tags=["magnetometry"])


class HysteresisRequest(BaseModel):
    h: list[float]
    m: list[float]
    saturation_fraction: float = 0.8
    pre_smooth: int = 0
    virgin_detect: bool = True


class SubtractBgRequest(BaseModel):
    temperature: list[float]
    moment: list[float]
    fit_range: tuple[float, float] | None = None
    auto_fraction: float = 0.1


class HysteresisBgRequest(BaseModel):
    h: list[float]
    m: list[float]
    hi_fraction: float = 0.7
    min_points: int = 4


class ConvertUnitsRequest(BaseModel):
    x: list[float]
    y: list[float]
    from_field: str = "Oe"
    to_field: str = "Oe"
    from_moment: str = "emu"
    to_moment: str = "emu"
    sample_mass: float = 0.0
    sample_volume: float = 0.0


@router.post("/hysteresis")
def hysteresis(req: HysteresisRequest) -> dict[str, Any]:
    """Analyze an M-H loop -> Hc / Mr / Ms / squareness / loop area / SFD."""
    try:
        result = hysteresis_analysis(
            req.h,
            req.m,
            saturation_fraction=req.saturation_fraction,
            pre_smooth=req.pre_smooth,
            virgin_detect=req.virgin_detect,
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(result)  # type: ignore[no-any-return]


@router.post("/subtract-background")
def subtract_background(req: SubtractBgRequest) -> dict[str, Any]:
    """Subtract a linear high-T background from M(T)."""
    try:
        corrected, slope, intercept = subtract_mag_background(
            req.temperature,
            req.moment,
            fit_range=req.fit_range,
            auto_fraction=req.auto_fraction,
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "corrected": to_jsonable(corrected),
        "slope": to_jsonable(slope),
        "intercept": to_jsonable(intercept),
    }


@router.post("/subtract-hysteresis-background")
def subtract_hysteresis_bg(req: HysteresisBgRequest) -> dict[str, Any]:
    """Subtract a linear dia/paramagnetic slope from an M-H loop (slope only;
    offset kept so Hc/Mr are unaffected)."""
    try:
        corrected, slope = subtract_hysteresis_background(
            req.h, req.m, hi_fraction=req.hi_fraction, min_points=req.min_points
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"corrected": to_jsonable(corrected), "slope": to_jsonable(slope)}


@router.post("/convert-units")
def convert_units(req: ConvertUnitsRequest) -> dict[str, Any]:
    """Convert field (x) + moment (y) units (sample-aware)."""
    try:
        x_out, y_out, x_unit, y_unit, warning = convert_mag_units(
            req.x,
            req.y,
            from_field=req.from_field,
            to_field=req.to_field,
            from_moment=req.from_moment,
            to_moment=req.to_moment,
            sample_mass=req.sample_mass,
            sample_volume=req.sample_volume,
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "x": to_jsonable(np.asarray(x_out, dtype=float)),
        "y": to_jsonable(np.asarray(y_out, dtype=float)),
        "x_unit": x_unit,
        "y_unit": y_unit,
        "warning": warning,
    }
