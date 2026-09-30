"""Thin fit-statistics routes: confidence/prediction bands, diagnostics,
model comparison and orthogonal distance regression.

No math here. Each route validates, calls one pure function, and serializes:
``/bands`` -> ``calc.fit_stats.fit_bands``; ``/diagnostics`` ->
``calc.fit_stats.fit_compare`` + ``residual_diagnostics``; ``/compare`` ->
``calc.fit_model_compare.compare_models``; ``/odr`` -> ``calc.fit_odr.odr_fit``.
Split from ``routes/fitting.py`` (at the module ceiling) under the same
``/api/fitting`` prefix. Non-finite values serialize as null.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from quantized.calc.fit_equation import equation_model
from quantized.calc.fit_model_compare import compare_models
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fit_odr import odr_fit
from quantized.calc.fit_stats import ModelFn, fit_bands, fit_compare, residual_diagnostics
from quantized.routes._errors import call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class BandsRequest(BaseModel):
    # Exactly one of a registry model name / a custom equation string.
    model: str | None = None
    equation: str | None = None
    params: list[float]
    # The fit's parameter covariance (curve_fit's ``covar``). null when the
    # fit could not estimate one; the bands then come back null.
    covar: list[list[float]] | None = None
    # Grid the bands are evaluated on.
    x: list[float]
    n_points: int
    # Student-t degrees of freedom for the band quantile. ``fit_bands`` uses
    # its ``n_free`` argument only as this dof, so it is passed straight in.
    dof: int
    level: float = Field(default=0.95, gt=0.0, lt=1.0)


def _model_fcn(model: str | None, equation: str | None, n_params: int) -> ModelFn:
    """Resolve a registry name or an equation string to ``f(x, p) -> y``."""
    if (model is None) == (equation is None):
        raise HTTPException(status_code=422, detail="specify exactly one of model or equation")
    if model is not None:
        if model not in FIT_MODELS:
            raise HTTPException(status_code=422, detail=f"unknown model: {model}")
        name = model

        def registry_fcn(xa: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
            return evaluate(name, xa, pp)

        return registry_fcn
    assert equation is not None  # narrowed by the "exactly one" check above
    fcn, names = call_calc(equation_model, equation)
    if len(names) != n_params:
        raise HTTPException(
            status_code=422,
            detail=f"expected {len(names)} params for this equation, got {n_params}",
        )
    return fcn


@router.post("/bands")
def bands(req: BandsRequest) -> dict[str, Any]:
    """Confidence and prediction bands around a fitted curve (fitting.fitBands)."""
    fcn = _model_fcn(req.model, req.equation, len(req.params))
    out = call_calc(
        fit_bands, req.x, fcn, req.params, req.covar, req.n_points, req.dof, level=req.level
    )
    return to_jsonable(out)  # type: ignore[no-any-return]


class DiagnosticsRequest(BaseModel):
    y: list[float]
    residuals: list[float]
    # Free (fitted) parameter count of the model the residuals came from.
    n_params: int


@router.post("/diagnostics")
def diagnostics(req: DiagnosticsRequest) -> dict[str, Any]:
    """Goodness-of-fit metrics and residual diagnostics for one fit."""
    if len(req.y) != len(req.residuals):
        raise HTTPException(status_code=422, detail="y and residuals must have the same length")
    return {
        "compare": to_jsonable(call_calc(fit_compare, req.y, req.residuals, req.n_params)),
        "residuals": to_jsonable(call_calc(residual_diagnostics, req.residuals)),
    }


class CompareEquation(BaseModel):
    name: str
    equation: str
    guesses: list[float] | None = None


class CompareRequest(BaseModel):
    x: list[float]
    y: list[float]
    models: list[str] | None = None
    equations: list[CompareEquation] | None = None
    # F-test baseline; null -> the candidate with the fewest free parameters.
    reference: str | None = None


@router.post("/compare")
def compare(req: CompareRequest) -> dict[str, Any]:
    """Fit two or more models to one selection and compare them.

    Per-candidate fit failures come back as ``error`` entries (curated fit
    diagnostics, as for ``/scan`` -- see SECURITY.md); only invalid input is
    a 422.
    """
    equations = [e.model_dump() for e in req.equations] if req.equations else None
    out = call_calc(
        compare_models, req.x, req.y, models=req.models, equations=equations,
        reference=req.reference,
    )
    # NOTE(codeql py/stack-trace-exposure): reviewed, by design -- SECURITY.md.
    return to_jsonable(out)  # type: ignore[no-any-return]


class OdrRequest(BaseModel):
    x: list[float]
    y: list[float]
    # sigma_y^2 / sigma_x^2; ignored when both error columns are given.
    lambda_: float = Field(default=1.0, alias="lambda")
    x_error: list[float] | None = None
    y_error: list[float] | None = None


@router.post("/odr")
def odr(req: OdrRequest) -> dict[str, Any]:
    """Orthogonal distance (Deming) straight-line fit, errors in x and y."""
    out = call_calc(
        odr_fit, req.x, req.y, lambda_=req.lambda_, x_error=req.x_error, y_error=req.y_error
    )
    return to_jsonable(out)  # type: ignore[no-any-return]
