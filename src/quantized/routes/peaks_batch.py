"""Batch peak-model fit on the job queue (audit P2.4 slice 4).

``POST /api/peaks/model-fit-batch`` queues
:func:`quantized.calc.peak_model_batch.fit_peak_model_batch` over up to
:data:`BATCH_MAX_ITEMS` prepared fit problems and returns ``{job_id,
n_items}`` at once; the SPA GET-polls ``/api/jobs/{id}`` (progress "fitting
k/N"), cancels through ``/api/jobs/{id}/cancel`` and reads the rows from
``/api/jobs/{id}/result``. Each item is exactly one ``/api/peaks/model-fit``
body (same field models, same caps) plus a client ``id``; a bad item is an
error ROW, never a failed batch. Validate -> submit -> serialize.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from quantized.calc.peak_model_batch import BatchCancelled, fit_peak_model_batch
from quantized.jobs import AbortFn, JobCancelled, JobQueueFullError, ProgressFn, jobs
from quantized.routes._payload import to_jsonable
from quantized.routes.peaks import (
    MODEL_FIT_MAX_DEADLINE_S,
    MODEL_FIT_MAX_PARAMETERS,
    MODEL_FIT_MAX_PEAKS,
    MODEL_FIT_MAX_POINTS,
    Column,
    FiniteFloat,
    PeakModelParameter,
    PeakShape,
    _column,
)

router = APIRouter(prefix="/api/peaks", tags=["peaks"])

# Caps: a batch is at most BATCH_MAX_ITEMS fits and BATCH_MAX_POINTS points in
# total (the request body is held in memory for the job's lifetime), and runs
# at most BATCH_MAX_TOTAL_S; each fit keeps the single fit's 30 s cap.
BATCH_MAX_ITEMS = 200
BATCH_MAX_POINTS = 2_000_000
BATCH_MAX_TOTAL_S = 1800.0


class PeakModelBatchItem(BaseModel):
    """One dataset's prepared fit: the ``/model-fit`` body plus its ``id``."""

    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    x: Column = Field(min_length=2, max_length=MODEL_FIT_MAX_POINTS)
    y: Column = Field(min_length=2, max_length=MODEL_FIT_MAX_POINTS)
    y_err: Column | None = Field(default=None, max_length=MODEL_FIT_MAX_POINTS)
    shapes: list[PeakShape] = Field(min_length=1, max_length=MODEL_FIT_MAX_PEAKS)
    background: Literal["none", "constant", "linear", "quadratic"] = "linear"
    parameters: list[PeakModelParameter] = Field(
        min_length=1, max_length=MODEL_FIT_MAX_PARAMETERS)
    bg_x_ref: FiniteFloat | None = None


class PeakModelBatchRequest(BaseModel):
    items: list[PeakModelBatchItem] = Field(min_length=1, max_length=BATCH_MAX_ITEMS)
    max_nfev: int = Field(default=1000, ge=1, le=10_000)
    item_deadline_s: float = Field(default=10.0, gt=0.0, le=MODEL_FIT_MAX_DEADLINE_S)
    total_deadline_s: float = Field(default=600.0, gt=0.0, le=BATCH_MAX_TOTAL_S)

    @model_validator(mode="after")
    def _bounded(self) -> PeakModelBatchRequest:
        ids = [it.id for it in self.items]
        if len(set(ids)) != len(ids):
            raise ValueError("item ids must be unique")
        total = sum(len(it.x) for it in self.items)
        if total > BATCH_MAX_POINTS:
            raise ValueError(f"the batch holds {total} points; the limit is {BATCH_MAX_POINTS}")
        return self


class PeakModelBatchSubmitted(BaseModel):
    job_id: str
    n_items: int


@router.post("/model-fit-batch", response_model=PeakModelBatchSubmitted)
def model_fit_batch(req: PeakModelBatchRequest) -> dict[str, Any]:
    """Queue the batch; poll ``/api/jobs/{job_id}`` for progress and rows."""
    items = [{
        "id": it.id, "x": _column(it.x), "y": _column(it.y), "y_err": _column(it.y_err),
        "shapes": list(it.shapes), "background": it.background,
        "parameters": [p.model_dump() for p in it.parameters], "bg_x_ref": it.bg_x_ref,
    } for it in req.items]

    def run_job(progress: ProgressFn, abort_check: AbortFn) -> Any:
        try:
            out = fit_peak_model_batch(
                items, max_nfev=req.max_nfev, item_deadline_s=req.item_deadline_s,
                total_deadline_s=req.total_deadline_s, progress=progress,
                abort_check=abort_check,
            )
        except BatchCancelled as exc:
            raise JobCancelled(str(exc)) from exc
        return to_jsonable(out)

    try:
        return {"job_id": jobs.submit(run_job), "n_items": len(items)}
    except JobQueueFullError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
