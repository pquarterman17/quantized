"""Thin curve-measurement routes. Wrap ``calc.curve_measure``.

Intersection of two curves, level crossings, and rise / fall time on raw
(X, Y) arrays. The route validates, calls the pure function and serializes the
frozen result; every number is finite, so no NaN mapping is needed.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.curve_measure import intersect_curves, level_crossings, step_time
from quantized.routes._errors import call_calc

router = APIRouter(prefix="/api/curve-measure", tags=["curve-measure"])

NonFinite = Literal["error", "drop"]
Direction = Literal["rising", "falling"]


def _same_length(name: str, a: list[float], b: list[float]) -> None:
    if len(a) != len(b):
        raise HTTPException(status_code=422, detail=f"{name}: X and Y must have the same length")


class IntersectRequest(BaseModel):
    x1: list[float]
    y1: list[float]
    x2: list[float]
    y2: list[float]
    nonfinite: NonFinite = "error"


class IntersectionOut(BaseModel):
    x: float
    y: float
    kind: Literal["cross", "touch", "coincident"]
    direction: Direction | None
    x_end: float


class IntersectResponse(BaseModel):
    intersections: list[IntersectionOut]
    x_min: float
    x_max: float
    n_grid: int
    dropped_a: int
    dropped_b: int
    merged_a: int
    merged_b: int


@router.post("/intersect", response_model=IntersectResponse)
def intersect(req: IntersectRequest) -> IntersectResponse:
    """Every crossing / touch of curve A and curve B inside their shared X range."""
    _same_length("curve A", req.x1, req.y1)
    _same_length("curve B", req.x2, req.y2)
    res = call_calc(intersect_curves, req.x1, req.y1, req.x2, req.y2, nonfinite=req.nonfinite)
    return IntersectResponse.model_validate(asdict(res))


class LevelCrossingRequest(BaseModel):
    x: list[float]
    y: list[float]
    level: float
    hysteresis: float = Field(default=0.0, ge=0.0)
    direction: Literal["both", "rising", "falling"] = "both"
    nonfinite: NonFinite = "error"


class CrossingOut(BaseModel):
    x: float
    direction: Direction


class LevelCrossingResponse(BaseModel):
    level: float
    hysteresis: float
    crossings: list[CrossingOut]
    n_points: int
    dropped: int
    merged_duplicates: int


@router.post("/level-crossings", response_model=LevelCrossingResponse)
def level_crossings_route(req: LevelCrossingRequest) -> LevelCrossingResponse:
    """Every X where the curve passes through ``level`` (optional dead band)."""
    _same_length("curve", req.x, req.y)
    res = call_calc(
        level_crossings,
        req.x,
        req.y,
        req.level,
        hysteresis=req.hysteresis,
        direction=req.direction,
        nonfinite=req.nonfinite,
    )
    return LevelCrossingResponse.model_validate(asdict(res))


class StepTimeRequest(BaseModel):
    x: list[float]
    y: list[float]
    low_fraction: float = 0.1
    high_fraction: float = 0.9
    edge: Literal["auto", "rise", "fall"] = "auto"
    low_level: float | None = None
    high_level: float | None = None
    plateau_band: float = 0.1
    nonfinite: NonFinite = "error"


class StepTimeResponse(BaseModel):
    edge: Literal["rise", "fall"]
    time: float
    x_low: float
    x_high: float
    low_fraction: float
    high_fraction: float
    low_plateau: float
    high_plateau: float
    low_level: float
    high_level: float
    plateaus_estimated: tuple[bool, bool]
    n_points: int
    dropped: int
    merged_duplicates: int


@router.post("/step-time", response_model=StepTimeResponse)
def step_time_route(req: StepTimeRequest) -> StepTimeResponse:
    """Rise or fall time between two fractions of a step height."""
    _same_length("curve", req.x, req.y)
    res = call_calc(
        step_time,
        req.x,
        req.y,
        low_fraction=req.low_fraction,
        high_fraction=req.high_fraction,
        edge=req.edge,
        low_level=req.low_level,
        high_level=req.high_level,
        plateau_band=req.plateau_band,
        nonfinite=req.nonfinite,
    )
    return StepTimeResponse.model_validate(asdict(res))
