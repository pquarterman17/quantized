"""Robust and quantile fits (GAP_AUDIT_9 G11): thin adapters over
``calc.fit_robust`` / ``calc.fit_quantile``. Opt-in beside ``/fitting/fit``,
which is unchanged. Plain x/y arrays (no dataset handle), like ``/odr``."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_models import FIT_MODELS, evaluate, with_domain_bounds
from quantized.calc.fit_quantile import quantile_fit
from quantized.calc.fit_robust import bisquare_irls, robust_curve_fit
from quantized.calc.fitting import weights_from_dy
from quantized.routes._errors import CALC_ERRORS, call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class RobustFitRequest(BaseModel):
    x: list[float]
    y: list[float]
    # "nonlinear": a registry model with a robust loss (scipy least_squares);
    # "bisquare": Tukey-bisquare IRLS of a polynomial of `degree`.
    method: Literal["nonlinear", "bisquare"] = "nonlinear"
    model: str | None = None
    p0: list[float] | None = None
    lower: list[float | None] | None = None
    upper: list[float | None] | None = None
    loss: Literal["linear", "soft_l1", "huber", "cauchy"] = "soft_l1"
    f_scale: float | None = Field(default=None, gt=0)  # None = automatic (MAD)
    dy: list[float] | None = None
    degree: int = Field(default=1, ge=1, le=8)
    c: float = Field(default=4.685, gt=0)


@router.post("/robust-fit")
def robust_fit(req: RobustFitRequest) -> dict[str, Any]:
    """Outlier-robust fit: robust-loss nonlinear model, or bisquare polynomial."""
    if req.method == "bisquare":
        return to_jsonable(call_calc(bisquare_irls, req.x, req.y, req.degree, c=req.c))  # type: ignore[no-any-return]
    if req.model not in FIT_MODELS:
        raise HTTPException(status_code=422, detail=f"unknown model: {req.model}")
    name: str = req.model

    def model_fcn(xx: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
        return evaluate(name, xx, pp)

    try:
        p0 = req.p0 if req.p0 is not None else auto_guess(name, req.x, req.y)
        weights = weights_from_dy(req.dy, len(req.x)) if req.dy is not None else None
        lower, upper = with_domain_bounds(name, req.lower, req.upper)
        out = robust_curve_fit(
            req.x, req.y, model_fcn, p0, loss=req.loss, f_scale=req.f_scale,
            lower=lower, upper=upper, weights=weights,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out["paramNames"] = list(FIT_MODELS[name]["paramNames"])
    return to_jsonable(out)  # type: ignore[no-any-return]


class QuantileFitRequest(BaseModel):
    x: list[float]
    y: list[float]
    tau: float = Field(default=0.5, gt=0, lt=1)  # median; no other default (provisional)
    degree: int = Field(default=1, ge=1, le=8)


@router.post("/quantile-fit")
def quantile_fit_route(req: QuantileFitRequest) -> dict[str, Any]:
    """Polynomial quantile regression at ``tau`` (check-loss LP)."""
    return to_jsonable(call_calc(quantile_fit, req.x, req.y, req.tau, req.degree))  # type: ignore[no-any-return]
