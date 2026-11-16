"""Thin implicit-fit route (ellipse). Wraps ``calc.fit_implicit``."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.fit_implicit import ellipse_points, fit_ellipse
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fit-implicit", tags=["fit-implicit"])

_MAX_POINTS = 50_000


class EllipseRequest(BaseModel):
    x: list[float]
    y: list[float]
    geometric: bool = True
    curve_points: int = Field(default=200, ge=8, le=2000)


@router.post("/ellipse")
def ellipse(req: EllipseRequest) -> dict[str, Any]:
    """Direct algebraic ellipse fit, refined to orthogonal distance."""
    if len(req.x) != len(req.y):
        raise HTTPException(status_code=422, detail="x and y must have the same length")
    if len(req.x) > _MAX_POINTS:
        raise HTTPException(
            status_code=422, detail=f"too many points ({len(req.x)} > {_MAX_POINTS})"
        )
    try:
        res = fit_ellipse(req.x, req.y, geometric=req.geometric)
        cx, cy = ellipse_points(
            res["center_x"],
            res["center_y"],
            res["semi_major"],
            res["semi_minor"],
            res["angle_deg"],
            req.curve_points,
        )
        return to_jsonable({**res, "curve_x": cx, "curve_y": cy})  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
