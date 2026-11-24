"""Thin routes: SPC control charts and process capability (GAP_AUDIT_9 J14).

Same ``/api/stats`` prefix as ``routes/stats.py``. Math: ``calc.spc_charts``,
``calc.spc_capability``. Specification limits have no default.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.spc_capability import process_capability
from quantized.calc.spc_charts import control_chart
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


class ControlChartRequest(BaseModel):
    chart: Literal["xbar-r", "xbar-s", "imr", "p", "np", "c", "u", "ewma", "cusum"]
    subgroups: list[list[float]] | None = None
    values: list[float] | None = None
    counts: list[float] | None = None
    sizes: list[float] | None = None
    rules: list[Literal["we1", "we2", "we3", "we4", "nel5", "nel6", "nel7", "nel8"]] = Field(
        default_factory=list
    )
    run_length: int = 8
    # EWMA / CUSUM (calc.spc_cumulative). Defaults are provisional, owner to confirm.
    ewma_lambda: float = 0.2
    ewma_width: float = 3.0
    cusum_k: float = 0.5
    cusum_h: float = 5.0
    target: float | None = None
    sigma: float | None = None


class CapabilityRequest(BaseModel):
    values: list[float]
    lsl: float | None = None
    usl: float | None = None
    target: float | None = None
    subgroups: list[list[float]] | None = None
    sigma_method: Literal["range", "sd"] = "range"
    alpha: float = 0.05


@router.post("/control-chart")
def control_chart_route(req: ControlChartRequest) -> dict[str, Any]:
    """Shewhart chart with +/-3 sigma limits and optional Western Electric rules."""
    try:
        out = control_chart(
            req.chart,
            subgroups=req.subgroups,
            values=req.values,
            counts=req.counts,
            sizes=req.sizes,
            rules=list(req.rules),
            run_length=req.run_length,
            ewma_lambda=req.ewma_lambda,
            ewma_width=req.ewma_width,
            cusum_k=req.cusum_k,
            cusum_h=req.cusum_h,
            target=req.target,
            sigma=req.sigma,
        )
        return to_jsonable(out)  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/capability")
def capability_route(req: CapabilityRequest) -> dict[str, Any]:
    """Cp/Cpk (within sigma) and Pp/Ppk (overall sigma); refuses without spec limits."""
    try:
        out = process_capability(
            req.values,
            lsl=req.lsl,
            usl=req.usl,
            target=req.target,
            subgroups=req.subgroups,
            sigma_method=req.sigma_method,
            alpha=req.alpha,
        )
        return to_jsonable(out)  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
