"""Thin multi-dataset routes. Wrap ``calc.aggregate``.

``/algebra`` combines two posted datasets pointwise on A's x-grid (B
interpolated); ``/confidence-band`` reduces N datasets to a pointwise
mean +/- std (or median/IQR) band on their shared x-range. Validate, call the
pure golden function, serialize — no math here.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.calc.aggregate import confidence_band, dataset_algebra
from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS, call_calc
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import DataStructResponse, datastruct_payload, to_jsonable

router = APIRouter(prefix="/api/aggregate", tags=["aggregate"], route_class=OffloopJSONRoute)


class AlgebraRequest(BaseModel):
    dataset_a: dict[str, Any]
    dataset_b: dict[str, Any]
    operation: str
    interp_method: str = "pchip"
    channel_a: int = 0
    channel_b: int = 0


@router.post("/algebra", response_model=dict[str, Any], response_class=DataStructResponse)
def algebra(req: AlgebraRequest) -> Response:
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
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(out))


class ConfidenceBandRequest(BaseModel):
    datasets: list[dict[str, Any]]
    method: str = "mean"  # "mean" (+/- sample std) or "median" (IQR)
    channel: int = 0  # 0-based, clamped to each dataset's last channel
    n_points: int = 0  # 0 -> the longest input length


@router.post("/confidence-band")
def confidence_band_route(req: ConfidenceBandRequest) -> dict[str, Any]:
    """Pointwise spread band across N datasets (utilities.confidenceBand)."""
    try:
        sets = [DataStruct.from_dict(d) for d in req.datasets]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out = call_calc(
        confidence_band, sets, method=req.method, channel=req.channel, n_points=req.n_points
    )
    return to_jsonable(out)  # type: ignore[no-any-return]
