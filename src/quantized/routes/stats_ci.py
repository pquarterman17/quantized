"""Thin route: confidence intervals for one column (the Distribution workshop's CI panel).

Math: ``calc.stats_ci``. Same ``/api/stats`` prefix as ``routes/stats.py``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats_ci import confidence_intervals
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


class ConfidenceIntervalsRequest(BaseModel):
    x: list[float | None]
    level: float = 0.95
    bootstrap: bool = False


@router.post("/confidence-intervals")
def confidence_intervals_route(req: ConfidenceIntervalsRequest) -> dict[str, Any]:
    """Mean (t), median (order statistics), sd and variance (chi-square), optional bootstrap."""
    try:
        values = [float("nan") if v is None else v for v in req.x]
        return to_jsonable(  # type: ignore[no-any-return]
            confidence_intervals(values, level=req.level, bootstrap=req.bootstrap)
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
