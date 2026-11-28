"""Thin route: fit a standard (calibration) curve and read unknowns off it.

``POST /api/fitting/standard-curve`` -> ``calc.standard_curve.standard_curve``.
No math here: validate the request, call, serialize. A response that is not on
the curve is a per-unknown ``status`` / ``reason`` in the result, not an error;
standards that cannot be fitted are a 422.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc.standard_curve import standard_curve
from quantized.routes._errors import call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class StandardCurveRequest(BaseModel):
    """The standards ``(x, y)``, the unknown responses to read off the curve, and the options."""

    x: list[float]
    y: list[float]
    unknowns: list[float] = Field(max_length=10000)
    model: Literal["linear", "quadratic", "4pl"] = "linear"
    confidence: float = 0.95
    # Readings averaged into each unknown response.
    replicates: int = Field(default=1, ge=1)


@router.post("/standard-curve")
def standard_curve_route(req: StandardCurveRequest) -> dict[str, Any]:
    """Fit the standards, then invert every unknown response with its interval."""
    result = call_calc(
        standard_curve,
        req.x,
        req.y,
        req.unknowns,
        model=req.model,
        confidence=req.confidence,
        replicates=req.replicates,
    )
    return to_jsonable(result)  # type: ignore[no-any-return]
