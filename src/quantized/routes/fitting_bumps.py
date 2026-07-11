"""Thin route for the optional bumps fit engine (GOTO #10).

``POST /api/fitting/bumps`` — the fast engines (amoeba / lm / de) run
synchronously and return the fit dict; ``engine='dream'`` submits to the
poll-model job runner (GOTO #9) and returns ``{"job_id": ...}``: poll
``GET /api/jobs/{id}`` for progress and fetch ``GET /api/jobs/{id}/result``
for the same fit dict on completion. All math lives in
``calc.fit_bumps``; the MATLAB-parity engine (``POST /api/fitting/fit``)
remains the default fit path.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_bumps import BUMPS_ENGINES, bumps_available, fit_bumps
from quantized.calc.fit_models import FIT_MODELS
from quantized.jobs import AbortFn, ProgressFn, jobs
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class BumpsFitRequest(BaseModel):
    model: str
    x: list[float]
    y: list[float]
    dy: list[float] | None = None
    p0: list[float] | None = None
    lower: list[float] | None = None
    upper: list[float] | None = None
    engine: str = "amoeba"
    # dream-only tuning (ignored by the synchronous engines)
    samples: int = 10_000
    burn: int = 100
    pop: int = 10
    return_samples: bool = False


@router.post("/bumps")
def bumps_fit(req: BumpsFitRequest) -> dict[str, Any]:
    """Fit a registry model with a bumps engine (sync) or queue a DREAM job."""
    if req.model not in FIT_MODELS:
        raise HTTPException(status_code=422, detail=f"unknown model: {req.model}")
    if req.engine not in BUMPS_ENGINES:
        raise HTTPException(
            status_code=422,
            detail=f"unknown engine: {req.engine} (choose from {', '.join(BUMPS_ENGINES)})",
        )
    if not bumps_available():
        raise HTTPException(
            status_code=422,
            detail=(
                "bumps is not installed - the optional fit engine needs "
                "'pip install quantized[bumps]'"
            ),
        )
    try:
        p0 = req.p0 if req.p0 is not None else auto_guess(req.model, req.x, req.y)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    kwargs: dict[str, Any] = {
        "model": req.model,
        "p0": [float(v) for v in p0],
        "lower": req.lower,
        "upper": req.upper,
        "param_names": list(FIT_MODELS[req.model]["paramNames"]),
        "engine": req.engine,
        "samples": req.samples,
        "burn": req.burn,
        "pop": req.pop,
        "return_samples": req.return_samples,
    }

    if req.engine == "dream":
        # Long-running: submit through the poll-model job runner (GOTO #9).
        def run_job(progress: ProgressFn, abort_check: AbortFn) -> Any:
            def on_fraction(fraction: float) -> None:
                progress(fraction, "sampling posterior")

            result = fit_bumps(
                req.x, req.y, req.dy,
                progress_callback=on_fraction, abort_check=abort_check, **kwargs,
            )
            return to_jsonable(result)

        return {"job_id": jobs.submit(run_job)}

    try:
        result = fit_bumps(req.x, req.y, req.dy, **kwargs)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(result)  # type: ignore[no-any-return]
