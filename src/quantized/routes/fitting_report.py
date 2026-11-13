"""Thin route for the Origin-style fit report: ``POST /api/fitting/report``.

No math here: validates, calls ``calc.fit_report.fit_report`` and serializes
(non-finite -> null). The client posts the finished fit's params / errors /
covar / residuals and the y it ran on, plus the same ``dy`` it fitted with
(``1/dy**2`` weights, the ``/fit`` convention via ``weights_from_dy``).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.fit_report import fit_report
from quantized.calc.fitting import weights_from_dy
from quantized.routes._errors import call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class FitReportRequest(BaseModel):
    params: list[float]
    # Standard errors; null for a held/undetermined parameter.
    errors: list[float | None]
    covar: list[list[float]] | None = None
    y: list[float]
    residuals: list[float]
    n_free: int = Field(ge=0)
    # 1-sigma errors the fit was weighted with; null = unweighted.
    dy: list[float] | None = None
    level: float = Field(default=0.95, gt=0.0, lt=1.0)


@router.post("/report")
def report(req: FitReportRequest) -> dict[str, Any]:
    """t / Prob>|t| / confidence limits, ANOVA, covariance and correlation."""
    if len(req.y) != len(req.residuals):
        raise HTTPException(status_code=422, detail="y and residuals must have the same length")
    if len(req.errors) != len(req.params):
        raise HTTPException(status_code=422, detail="errors and params must have the same length")
    weights = None if req.dy is None else call_calc(weights_from_dy, req.dy, len(req.y))
    out = call_calc(
        fit_report, req.params, req.errors, req.covar, req.y, req.residuals, req.n_free,
        weights=None if weights is None else list(weights), level=req.level,
    )
    return to_jsonable(out)  # type: ignore[no-any-return]
