"""Thin route for the per-pixel fit through a stack of maps (``calc/map_stack_fit``).

Validate, call, serialize. The fit runs through the poll-model job queue (a stack
of many pixels is long): ``POST /api/map-stack-fit/job`` checks the stack
synchronously (422 with the reason on a bad stack) and returns ``{"job_id"}``;
poll ``GET /api/jobs/{id}`` and read ``/result``. Cancelling ends the job
``cancelled`` with no result, so nothing is half written.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc import map_ops, map_stack_fit
from quantized.calc.fit_models import FIT_MODELS
from quantized.datastruct import DataStruct
from quantized.jobs import AbortFn, JobQueueFullError, ProgressFn, jobs
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import datastruct_payload

router = APIRouter(
    prefix="/api/map-stack-fit", tags=["map-stack-fit"], route_class=OffloopJSONRoute
)


class StackFitRequest(BaseModel):
    # One map per layer, in layer order, each with its name and its value of the
    # independent variable (a temperature, a time...).
    datasets: list[dict[str, Any]] = Field(min_length=3)
    layer_names: list[str]
    x_values: list[float]
    x_label: str = "x"
    model: str
    # null entries: p0 from the pixel's own auto-guess; lower/upper null = open.
    p0: list[float | None] | None = None
    lower: list[float | None] | None = None
    upper: list[float | None] | None = None
    fixed: list[bool] | None = None
    keep_unconverged: bool = False
    x_col: int | str | None = None
    y_col: int | str | None = None
    z_col: int | str | None = None


@router.post("/job")
def stack_fit_job(req: StackFitRequest) -> dict[str, Any]:
    """Queue the per-pixel fit; the result is ``{"outputs": [...], "summary": {...}}``."""
    try:
        if req.model not in FIT_MODELS:
            raise ValueError(f"unknown model: {req.model}")
        if len(req.layer_names) != len(req.datasets):
            raise ValueError("every map needs a name")
        grids = [
            map_ops.read_grid(DataStruct.from_dict(d), req.x_col, req.y_col, req.z_col)
            for d in req.datasets
        ]
        map_stack_fit.check_stack(grids, req.x_values)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def run_job(progress: ProgressFn, abort_check: AbortFn) -> Any:
        res = map_stack_fit.fit_map_stack(
            grids, req.x_values, req.model, p0=req.p0, lower=req.lower, upper=req.upper,
            fixed=req.fixed, keep_unconverged=req.keep_unconverged,
            progress=progress, abort_check=abort_check,
        )
        maps = map_stack_fit.result_maps(res, req.layer_names, req.x_values, req.x_label)
        return {
            "outputs": [
                {"name": name, "kind": kind, "dataset": datastruct_payload(ds)}
                for name, kind, ds in maps
            ],
            "summary": res.summary,
        }

    try:
        return {"job_id": jobs.submit(run_job)}
    except JobQueueFullError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
