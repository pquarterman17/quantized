"""Thin routes: Fit Model, the general linear model (GAP_AUDIT_9 G1).

Same ``/api/stats`` prefix as ``routes/stats.py``; its own module for the
500-line ceiling. Validate, call :mod:`quantized.calc.stats_linear_model`,
serialise. A fit is one QR solve (milliseconds for worksheet-sized data), so
it runs inline rather than through the job queue.

``/fit-model/predict`` evaluates a fitted model (the ``model`` object the fit
returned) at new factor settings: the evaluation surface for the prediction
profiler (G7).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.stats_linear_model import fit_linear_model, predict
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


class FitModelFactor(BaseModel):
    name: str = Field(min_length=1)
    kind: Literal["continuous", "nominal"]
    #: continuous: numbers (``null`` = missing); nominal: level labels (``null`` = missing).
    values: list[float | str | None]
    #: nominal only: level order (the last level is coded -1). Default: sorted.
    levels: list[str] | None = None


class FitModelRequest(BaseModel):
    response_name: str = "Y"
    response: list[float | None]
    factors: list[FitModelFactor]
    #: each term is a list of factor names: ``["A"]``, ``["A", "B"]`` (crossed), ``["X", "X"]``.
    terms: list[list[str]]
    center_polynomials: bool = True
    alpha: float = Field(0.05, gt=0.0, lt=1.0)


class FitModelPredictRequest(BaseModel):
    model: dict[str, Any]
    #: factor name -> one setting per point (number, level label, or ``null`` = averaged level).
    settings: dict[str, list[float | str | None]]


@router.post("/fit-model")
def fit_model_route(req: FitModelRequest) -> dict[str, Any]:
    """Standard least squares: whole-model ANOVA, parameter estimates, Type III
    effect tests, LS means, per-row predicted/residual and the fitted model."""
    try:
        result = fit_linear_model(
            req.response,
            [f.model_dump() for f in req.factors],
            req.terms,
            center_polynomials=req.center_polynomials,
            alpha=req.alpha,
            response_name=req.response_name,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(result)  # type: ignore[no-any-return]


@router.post("/fit-model/predict")
def fit_model_predict_route(req: FitModelPredictRequest) -> dict[str, Any]:
    """Predicted mean and its standard error at new settings (no refit)."""
    try:
        return to_jsonable(predict(req.model, req.settings))  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
