"""Batch peak-model fit on the job queue (audit P2.4 slice 4).

``POST /api/peaks/model-fit-batch`` queues
:func:`quantized.calc.peak_model_batch.fit_peak_model_batch` over up to
:data:`BATCH_MAX_ITEMS` prepared fit problems and returns ``{job_id,
n_items}`` at once; the SPA GET-polls ``/api/jobs/{id}`` (progress "fitting
k/N"), cancels through ``/api/jobs/{id}/cancel`` and reads the rows from
``/api/jobs/{id}/result``.

VALIDATION IS PER ITEM. Each item is one ``/api/peaks/model-fit`` problem
(:class:`quantized.routes.peaks.PeakModelProblem`, the SAME model, so the
two cannot drift) plus a client ``id``. The request itself only checks the
ENVELOPE - item count, a unique well-formed ``id`` on every item, the total
point count; each item's body is validated inside the job, one at a time,
and an item that fails (a non-finite start value sent as ``null``, an unknown
shape) becomes an ERROR ROW - one bad dataset never 422s the batch.
Validate -> submit -> serialize.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, TypeAdapter, ValidationError, model_validator

from quantized.calc.peak_model_batch import BatchCancelled, fit_peak_model_batch
from quantized.jobs import AbortFn, JobCancelled, JobQueueFullError, ProgressFn, jobs
from quantized.routes._payload import to_jsonable
from quantized.routes.peaks import MODEL_FIT_MAX_DEADLINE_S, PeakModelProblem

router = APIRouter(prefix="/api/peaks", tags=["peaks"])

# Caps: a batch is at most BATCH_MAX_ITEMS fits and BATCH_MAX_POINTS points in
# total (the request body is held in memory for the job's lifetime), and runs
# at most BATCH_MAX_TOTAL_S; each fit keeps the single fit's 30 s cap.
BATCH_MAX_ITEMS = 200
BATCH_MAX_POINTS = 2_000_000
BATCH_MAX_TOTAL_S = 1800.0
_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class PeakModelBatchItem(PeakModelProblem):
    """One dataset's prepared fit: a ``/model-fit`` problem plus its ``id``."""

    id: str = Field(min_length=1, max_length=128, pattern=_ID.pattern)


_ITEM = TypeAdapter(PeakModelBatchItem)


def _points(item: Mapping[str, Any]) -> int:
    sizes = [len(v) for k in ("x", "y", "y_err") if isinstance(v := item.get(k), list)]
    return max(sizes, default=0)


class PeakModelBatchRequest(BaseModel):
    """``items``: each a ``PeakModelFitRequest``-shaped problem (without the
    range / budget fields) plus ``id``; bodies are validated per item in the
    job, so the schema here only types the envelope."""

    items: list[dict[str, Any]] = Field(min_length=1, max_length=BATCH_MAX_ITEMS)
    max_nfev: int = Field(default=1000, ge=1, le=10_000)
    item_deadline_s: float = Field(default=10.0, gt=0.0, le=MODEL_FIT_MAX_DEADLINE_S)
    total_deadline_s: float = Field(default=600.0, gt=0.0, le=BATCH_MAX_TOTAL_S)

    @model_validator(mode="after")
    def _envelope(self) -> PeakModelBatchRequest:
        ids: list[str] = []
        for k, it in enumerate(self.items):
            item_id = it.get("id")
            if not isinstance(item_id, str) or not _ID.match(item_id):
                raise ValueError(f"items[{k}].id must be 1-128 characters of A-Z a-z 0-9 _ . : -")
            ids.append(item_id)
        if len(set(ids)) != len(ids):
            raise ValueError("item ids must be unique")
        total = sum(_points(it) for it in self.items)
        if total > BATCH_MAX_POINTS:
            raise ValueError(f"the batch holds {total} points; the limit is {BATCH_MAX_POINTS}")
        return self


class PeakModelBatchSubmitted(BaseModel):
    job_id: str
    n_items: int


def _ascii(text: str) -> str:
    return text.encode("ascii", "replace").decode("ascii")


def validate_item(raw: Mapping[str, Any]) -> dict[str, Any]:
    """One item -> ``fit_peak_model_batch``'s item, or ValueError naming the
    first few bad fields (locations + pydantic's messages; never the input)."""
    try:
        item = _ITEM.validate_python(raw)
    except ValidationError as exc:
        errs = exc.errors(include_url=False, include_input=False)
        where = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in errs[:3])
        more = f" (+{len(errs) - 3} more)" if len(errs) > 3 else ""
        raise ValueError(_ascii(f"invalid item: {where}{more}")) from None
    return {"id": item.id, **item.calc_kwargs()}


@router.post("/model-fit-batch", response_model=PeakModelBatchSubmitted)
def model_fit_batch(req: PeakModelBatchRequest) -> dict[str, Any]:
    """Queue the batch; poll ``/api/jobs/{job_id}`` for progress and rows."""
    # Bind what the job needs, not `req`: the closure lives as long as the
    # job, and the raw items are the only large thing it must keep.
    items = req.items
    max_nfev, item_s, total_s = req.max_nfev, req.item_deadline_s, req.total_deadline_s

    def run_job(progress: ProgressFn, abort_check: AbortFn) -> Any:
        try:
            out = fit_peak_model_batch(
                items, max_nfev=max_nfev, item_deadline_s=item_s,
                total_deadline_s=total_s, progress=progress,
                abort_check=abort_check, validate=validate_item,
            )
        except BatchCancelled as exc:
            raise JobCancelled(str(exc)) from exc
        return to_jsonable(out)

    try:
        return {"job_id": jobs.submit(run_job), "n_items": len(items)}
    except JobQueueFullError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
