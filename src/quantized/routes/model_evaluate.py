"""Thin routes: batch evaluation of a fitted Fit Model (GAP_AUDIT_9 G7).

The profilers drag sliders, so one request returns every factor's curve, a
contour grid, or a desirability optimum, never one request per point. The
model is the ``model`` object ``/api/stats/fit-model`` returned (or a saved
result's ``parameters.model``); there is no dataset, so no refit and no row
contract. Math: :mod:`quantized.calc.profile_model`,
:mod:`quantized.calc.profile_desirability`.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.profile_desirability import maximize_desirability
from quantized.calc.profile_model import contour_grid, factor_ranges, profile_model
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])

Setting = float | str | None


class GoalSpec(BaseModel):
    goal: Literal["maximize", "minimize", "target"]
    lower: float
    upper: float
    target: float | None = None


class _ModelRequest(BaseModel):
    model: dict[str, Any]
    #: factor -> current setting (continuous: number, nominal: level or null = averaged).
    current: dict[str, Setting] = Field(default_factory=dict)
    #: factor -> [lo, hi] override; default is the fitted range stored in the model.
    ranges: dict[str, tuple[float, float]] | None = None


class ProfileRequest(_ModelRequest):
    n_points: int = Field(41, ge=2, le=401)
    alpha: float = Field(0.05, gt=0.0, lt=1.0)
    goal: GoalSpec | None = None


class ContourRequest(_ModelRequest):
    x_factor: str
    y_factor: str
    n_x: int = Field(41, ge=2, le=200)
    n_y: int = Field(41, ge=2, le=200)


class DesirabilityRequest(BaseModel):
    model: dict[str, Any]
    ranges: dict[str, tuple[float, float]] | None = None
    goal: GoalSpec


@router.post("/fit-model/profile")
def fit_model_profile_route(req: ProfileRequest) -> dict[str, Any]:
    """Prediction-profiler curves (all factors, with CI bands) in one call."""
    try:
        return to_jsonable(profile_model(  # type: ignore[no-any-return]
            req.model, req.current, ranges=req.ranges, n_points=req.n_points,
            alpha=req.alpha, goal=req.goal.model_dump() if req.goal else None,
        ))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/fit-model/contour")
def fit_model_contour_route(req: ContourRequest) -> dict[str, Any]:
    """Predicted response over a grid of two continuous factors."""
    try:
        return to_jsonable(contour_grid(  # type: ignore[no-any-return]
            req.model, req.x_factor, req.y_factor, req.current,
            ranges=req.ranges, n_x=req.n_x, n_y=req.n_y,
        ))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/fit-model/desirability")
def fit_model_desirability_route(req: DesirabilityRequest) -> dict[str, Any]:
    """Grid-search the factor settings that maximise desirability."""
    try:
        g = req.goal
        return to_jsonable(maximize_desirability(  # type: ignore[no-any-return]
            req.model, factor_ranges(req.model, req.ranges), g.goal, g.lower, g.upper, g.target,
        ))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
