"""Bootstrap confidence intervals for a registry-model fit (ORIGIN_GAP_PLAN #29).

``POST /api/fitting/bootstrap`` answers synchronously; ``/bootstrap/job`` runs
the same calc (``calc.fit_bootstrap.bootstrap_fit``, deterministic for a seed)
on the poll-model job runner so the client gets a replicate fraction and a
Cancel that stops the work. Split out of ``routes/fitting.py`` (500-line
module ceiling).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel

from quantized.calc.fit_bootstrap import bootstrap_fit
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.jobs import AbortFn, JobQueueFullError, ProgressFn, jobs
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class BootstrapRequest(BaseModel):
    model: str
    x: list[float]
    y: list[float]
    p0: list[float]
    n_boot: int = 500
    method: str = "residual"
    seed: int = 0
    alpha: float = 0.05
    lower: list[float] | None = None
    upper: list[float] | None = None
    # Opt-in (gap #29): the full bootstrap replicate matrix, for corner-plot
    # rendering. Default False keeps the ordinary response small.
    return_samples: bool = False


def _bootstrap_run(
    req: BootstrapRequest, on_replicate: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    if req.model not in FIT_MODELS:
        raise HTTPException(status_code=422, detail=f"unknown model: {req.model}")

    def model_fcn(xa: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(evaluate(req.model, xa, p), dtype=float)

    return to_jsonable(  # type: ignore[no-any-return]
        bootstrap_fit(
            np.asarray(req.x, dtype=float),
            np.asarray(req.y, dtype=float),
            model_fcn,
            req.p0,
            n_boot=req.n_boot,
            method=req.method,
            seed=req.seed,
            alpha=req.alpha,
            lower=req.lower,
            upper=req.upper,
            return_samples=req.return_samples,
            on_replicate=on_replicate,
        )
    )


@router.post("/bootstrap")
def bootstrap(req: BootstrapRequest) -> dict[str, Any]:
    """Bootstrap parameter CIs for a registry-model fit (calc.fit_bootstrap)."""
    try:
        return _bootstrap_run(req)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/bootstrap/job")
def bootstrap_job(req: BootstrapRequest) -> dict[str, Any]:
    """The same bootstrap as ``/bootstrap``, queued on the job runner.

    Returns ``{job_id}``; ``GET /api/jobs/{id}/result`` is exactly
    ``/bootstrap``'s body. The fraction is replicates done over ``n_boot``;
    Cancel stops the run after the replicate in flight and stores no result.
    An unknown model is a 422 here; a request the calc refuses (``n_boot`` < 20,
    a bad ``method``/``alpha``, an unstable bootstrap) ends the job as an error
    carrying ``/bootstrap``'s message.
    """
    if req.model not in FIT_MODELS:
        raise HTTPException(status_code=422, detail=f"unknown model: {req.model}")

    def run_job(progress: ProgressFn, abort_check: AbortFn) -> Any:
        def on_replicate(done: int, total: int) -> None:  # raises JobCancelled after a cancel
            progress(done / total, f"replicate {done} of {total}")

        return _bootstrap_run(req, on_replicate)

    try:
        return {"job_id": jobs.submit(run_job)}
    except JobQueueFullError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
