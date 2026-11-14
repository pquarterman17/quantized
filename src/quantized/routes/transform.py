"""Thin resample / align route (audit P2.5). Wraps ``calc.resample_align``.

``POST /api/transform/resample`` resamples one posted dataset onto a target
grid (n points / step / explicit start:step:stop / another dataset's x) and
returns the derived dataset plus the plain-language warnings the frontend's
preview shows before anything is committed. Validate, call the pure function,
serialize -- the grid rules and every refusal live in ``calc/``.

``POST /api/transform/average`` (Origin "Average Multiple Curves", gap audit 2
#9) averages N posted curves on one grid via ``calc.curve_average``, which
interpolates each curve through the same ``align_resample`` guards.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc.curve_average import average_curves
from quantized.calc.resample_align import align_resample
from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import DataStructResponse, datastruct_payload

router = APIRouter(prefix="/api/transform", tags=["transform"], route_class=OffloopJSONRoute)


class ResampleRequest(BaseModel):
    dataset: dict[str, Any]
    mode: Literal["n_points", "step", "range", "match"]
    n_points: int | None = None
    step: float | None = None
    start: float | None = None
    stop: float | None = None
    #: ``mode="match"``: the x values of the dataset to align onto (a blank
    #: entry -- JSON null -- is left out of the grid) and their unit.
    match_x: list[float | None] | None = None
    match_x_unit: str = ""
    method: Literal["linear", "pchip", "spline", "makima"] = "linear"
    #: Target points outside the source x-range: blank ("nan") or dropped
    #: ("clip"). Never extrapolated.
    out_of_range: Literal["nan", "clip"] = "nan"
    #: x that changes direction: refused ("refuse") or sorted by x ("sort").
    unsorted: Literal["refuse", "sort"] = "refuse"
    #: ``mode="match"`` with a different x unit is refused unless this is set.
    allow_unit_mismatch: bool = False


class ResampleWarning(BaseModel):
    code: str
    text: str
    count: int | None = None
    columns: list[str] | None = None
    confirm: bool | None = None
    info: bool | None = None


class ResampleResponse(BaseModel):
    dataset: dict[str, Any]
    warnings: list[ResampleWarning]
    source_range: list[float] = Field(min_length=2, max_length=2)
    rows_in: int
    rows_out: int


@router.post("/resample", response_model=ResampleResponse, response_class=DataStructResponse)
def resample(req: ResampleRequest) -> Response:
    """Resample a dataset onto a target grid; warnings say what that did."""
    try:
        data = DataStruct.from_dict(req.dataset)
        match_x = (
            None if req.match_x is None else [float("nan") if v is None else v for v in req.match_x]
        )
        res = align_resample(
            data,
            mode=req.mode,
            n_points=req.n_points,
            step=req.step,
            start=req.start,
            stop=req.stop,
            match_x=match_x,
            match_x_unit=req.match_x_unit,
            method=req.method,
            out_of_range=req.out_of_range,
            unsorted=req.unsorted,
            allow_unit_mismatch=req.allow_unit_mismatch,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(
        {
            "dataset": datastruct_payload(res.data),
            "warnings": res.warnings,
            "source_range": list(res.source_range),
            "rows_in": res.rows_in,
            "rows_out": res.rows_out,
        }
    )


class AverageCurve(BaseModel):
    name: str
    dataset: dict[str, Any]


class AverageRequest(BaseModel):
    curves: list[AverageCurve] = Field(min_length=2)
    #: The y column (by name) every curve contributes; "" = each curve's
    #: first numeric column.
    channel: str = ""
    #: ``union`` of every curve's x, or a set ``step`` over their overlap.
    grid: Literal["union", "step"] = "union"
    step: float | None = None
    unsorted: Literal["refuse", "sort"] = "refuse"
    allow_unit_mismatch: bool = False


class AverageResponse(BaseModel):
    dataset: dict[str, Any]
    warnings: list[ResampleWarning]
    #: The overlap of every curve's x-range; nulls when they do not overlap.
    overlap: list[float | None] = Field(min_length=2, max_length=2)
    channels: list[str]


@router.post("/average", response_model=AverageResponse, response_class=DataStructResponse)
def average(req: AverageRequest) -> Response:
    """Mean, SD, SEM and N of N curves interpolated onto one grid."""
    try:
        res = average_curves(
            [DataStruct.from_dict(c.dataset) for c in req.curves],
            names=[c.name for c in req.curves],
            channel=req.channel,
            grid=req.grid,
            step=req.step,
            unsorted=req.unsorted,
            allow_unit_mismatch=req.allow_unit_mismatch,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(
        {
            "dataset": datastruct_payload(res.data),
            "warnings": res.warnings,
            "overlap": [v if v == v else None for v in res.overlap],
            "channels": res.channels,
        }
    )
