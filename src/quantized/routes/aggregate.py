"""Thin dataset-algebra route. Wraps ``calc.aggregate.dataset_algebra``.

Combine two posted datasets pointwise on A's x-grid (B interpolated). Validate,
call the pure golden function, serialize — no math here.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.aggregate import dataset_algebra
from quantized.datastruct import DataStruct
from quantized.routes._payload import datastruct_payload

router = APIRouter(prefix="/api/aggregate", tags=["aggregate"])


class AlgebraRequest(BaseModel):
    dataset_a: dict[str, Any]
    dataset_b: dict[str, Any]
    operation: str
    interp_method: str = "pchip"
    channel_a: int = 0
    channel_b: int = 0


@router.post("/algebra")
def algebra(req: AlgebraRequest) -> dict[str, Any]:
    """Combine two datasets via A+B / A-B / A*B / A/B / (A-B)/(A+B)."""
    try:
        a = DataStruct.from_dict(req.dataset_a)
        b = DataStruct.from_dict(req.dataset_b)
        out = dataset_algebra(
            a,
            b,
            req.operation,
            interp_method=req.interp_method,
            channel_a=req.channel_a,
            channel_b=req.channel_b,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(out)
