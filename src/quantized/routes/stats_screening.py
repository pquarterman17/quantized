"""Thin route: response screening (GAP_AUDIT_9 G26). Math: ``calc.stats_screening``."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats_screening import response_screening
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


class ScreenResponse(BaseModel):
    name: str
    values: list[float | None]


class ScreenFactor(BaseModel):
    name: str
    kind: Literal["continuous", "nominal"]
    values: list[float | str | None]


class ResponseScreeningRequest(BaseModel):
    y: list[ScreenResponse]
    x: list[ScreenFactor]
    method: Literal["bh", "by", "holm", "bonferroni"] = "bh"
    alpha: float = 0.05


@router.post("/response-screening")
def response_screening_route(req: ResponseScreeningRequest) -> dict[str, Any]:
    """Every Y x X test with raw and FDR-adjusted p, LogWorth, effect size and interval."""
    try:
        out = response_screening(
            [c.values for c in req.y],
            [c.values for c in req.x],
            y_names=[c.name for c in req.y],
            x_names=[c.name for c in req.x],
            x_kinds=[c.kind for c in req.x],
            method=req.method,
            alpha=req.alpha,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(out)  # type: ignore[no-any-return]
