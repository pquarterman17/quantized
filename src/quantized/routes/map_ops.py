"""Thin route for the 2-D map operations (``calc/map_ops``, ``calc/map_arith``).

Validate, call, serialize. One endpoint: the op name picks the pure function;
the result is a new native-grid map DataStruct (the caller commits it as a
derived dataset with provenance).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.calc import map_arith, map_ops
from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import DataStructResponse, datastruct_payload

router = APIRouter(prefix="/api/map-ops", tags=["map-ops"], route_class=OffloopJSONRoute)

MapOpName = Literal["crop", "flip", "rotate", "transpose", "plane_level", "arith", "scalar"]


class MapOpRequest(BaseModel):
    dataset: dict[str, Any]
    op: MapOpName
    # Column choice (index or label); omitted = the map's own X, Y, value columns.
    x_col: int | str | None = None
    y_col: int | str | None = None
    z_col: int | str | None = None
    # crop
    xmin: float | None = None
    xmax: float | None = None
    ymin: float | None = None
    ymax: float | None = None
    # flip ("h" | "v")
    axis: str = "h"
    # rotate (90 | 180 | 270, counter-clockwise)
    degrees: int = 90
    # plane_level
    order: int = 1
    restore_mean: bool = False
    # arith (second map) and scalar; ``arith`` is add | sub | mul | div for both
    other: dict[str, Any] | None = None
    arith: str = "sub"
    interpolate: bool = False
    allow_mismatch: bool = False
    value: float = 0.0
    reverse: bool = False


@router.post("/apply", response_model=dict[str, Any], response_class=DataStructResponse)
def apply(req: MapOpRequest) -> Response:
    """Run one map operation; 422 with the reason when the inputs are unsuitable."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        g = map_ops.read_grid(ds, req.x_col, req.y_col, req.z_col)
        if req.op == "crop":
            out, info = map_ops.crop(g, xmin=req.xmin, xmax=req.xmax, ymin=req.ymin, ymax=req.ymax)
        elif req.op == "flip":
            out, info = map_ops.flip(g, req.axis)
        elif req.op == "rotate":
            out, info = map_ops.rotate(g, req.degrees)
        elif req.op == "transpose":
            out, info = map_ops.transpose(g)
        elif req.op == "plane_level":
            out, info = map_ops.plane_level(g, req.order, restore_mean=req.restore_mean)
        elif req.op == "scalar":
            out, info = map_arith.map_scalar(g, req.arith, req.value, reverse=req.reverse)
        else:
            if req.other is None:
                raise ValueError("map arithmetic needs a second map")
            gb = map_ops.read_grid(DataStruct.from_dict(req.other))
            out, info = map_arith.map_binary(
                g, gb, req.arith, interpolate=req.interpolate, allow_mismatch=req.allow_mismatch
            )
        result = map_ops.grid_result(out, info)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(result))
