"""Piecewise, convolution and ODE model fits (GAP_AUDIT_9 G11): thin adapters
over ``calc.fit_piecewise`` / ``calc.fit_convolve`` / ``calc.fit_models_ode``.
Opt-in beside ``/fitting/fit`` (unchanged). Plain x/y arrays, like
``/robust-fit``. ODE models are a fixed built-in set; nothing is evaluated
from user text."""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_convolve import convolution_fit
from quantized.calc.fit_models import FIT_MODELS, evaluate, with_domain_bounds
from quantized.calc.fit_models_ode import ODE_MODELS, ode_fit
from quantized.calc.fit_piecewise import MAX_BREAKPOINTS, piecewise_fit
from quantized.calc.fitting import weights_from_dy
from quantized.routes._errors import CALC_ERRORS, call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class PiecewiseFitRequest(BaseModel):
    x: list[float]
    y: list[float]
    n_breakpoints: int = Field(default=1, ge=1, le=MAX_BREAKPOINTS)
    fixed_breakpoints: list[float] | None = None


@router.post("/piecewise-fit")
def piecewise_fit_route(req: PiecewiseFitRequest) -> dict[str, Any]:
    """Continuous piecewise-linear fit with 1-3 estimated / fixed breakpoints."""
    return to_jsonable(  # type: ignore[no-any-return]
        call_calc(piecewise_fit, req.x, req.y, req.n_breakpoints, req.fixed_breakpoints)
    )


class ConvolutionFitRequest(BaseModel):
    x: list[float]
    y: list[float]
    model: str
    p0: list[float] | None = None
    lower: list[float | None] | None = None
    upper: list[float | None] | None = None
    # Gaussian instrument: sigma held, or the start value when fit_sigma.
    sigma: float | None = Field(default=None, gt=0)
    fit_sigma: bool = False
    # Measured instrument: one value per x (a resolution column).
    resolution: list[float] | None = None
    dy: list[float] | None = None


@router.post("/convolution-fit")
def convolution_fit_route(req: ConvolutionFitRequest) -> dict[str, Any]:
    """Registry model convolved with a Gaussian or measured instrument function."""
    if req.model not in FIT_MODELS:
        raise HTTPException(status_code=422, detail=f"unknown model: {req.model}")
    name: str = req.model

    def model_fcn(xx: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
        return evaluate(name, xx, pp)

    try:
        p0 = req.p0 if req.p0 is not None else auto_guess(name, req.x, req.y)
        weights = weights_from_dy(req.dy, len(req.x)) if req.dy is not None else None
        lower, upper = with_domain_bounds(name, req.lower, req.upper)
        out = convolution_fit(
            req.x,
            req.y,
            model_fcn,
            p0,
            sigma=req.sigma,
            fit_sigma=req.fit_sigma,
            resolution=req.resolution,
            lower=lower,
            upper=upper,
            weights=weights,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    names = list(FIT_MODELS[name]["paramNames"])
    out["paramNames"] = [*names, "sigma_instr"] if out["fitSigma"] else names
    return to_jsonable(out)  # type: ignore[no-any-return]


class OdeFitRequest(BaseModel):
    x: list[float]
    y: list[float]
    model: str
    observe: str | None = None
    p0: list[float] | None = None
    hold: dict[str, float] | None = None
    dy: list[float] | None = None


@router.get("/ode-models")
def ode_models() -> dict[str, Any]:
    """The built-in ODE model set (names, parameters, default holds)."""
    return {
        k: {"label": v["label"], "params": v["params"], "hold": v["hold"]}
        for k, v in ODE_MODELS.items()
    }


@router.post("/ode-fit")
def ode_fit_route(req: OdeFitRequest) -> dict[str, Any]:
    """Fit a built-in rate-equation model (solve_ivp)."""
    try:
        weights = weights_from_dy(req.dy, len(req.x)) if req.dy is not None else None
        out = ode_fit(
            req.x, req.y, req.model, observe=req.observe, p0=req.p0, hold=req.hold, weights=weights
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(out)  # type: ignore[no-any-return]
