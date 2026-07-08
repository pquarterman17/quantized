"""Thin fitting routes: list models, auto-guess, run a bounded NLLS fit.

No algorithms here — the math is in ``calc.fitting``/``calc.fit_models``/
``calc.fit_autoguess``. The model is chosen by name and resolved through the
registry (no eval); the curve_fit ``model_fcn`` is a closure over ``evaluate``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_bootstrap import bootstrap_fit, fit_posterior
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fitting import curve_fit
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


class GuessRequest(BaseModel):
    model: str
    x: list[float]
    y: list[float]


class FitRequest(BaseModel):
    model: str
    x: list[float]
    y: list[float]
    p0: list[float] | None = None
    lower: list[float] | None = None
    upper: list[float] | None = None
    weights: list[float] | None = None
    fixed: list[bool] | None = None
    calc_errors: bool = True


def _require_model(name: str) -> None:
    if name not in FIT_MODELS:
        raise HTTPException(status_code=422, detail=f"unknown model: {name}")


@router.get("/models")
def list_models() -> dict[str, Any]:
    """Registry of fit models with their parameter names and defaults."""
    models = [
        {
            "name": name,
            "category": spec["category"],
            "paramNames": spec["paramNames"],
            "nParams": spec["nParams"],
            "p0": spec["p0"],
            "lb": spec["lb"],
            "ub": spec["ub"],
        }
        for name, spec in FIT_MODELS.items()
    ]
    return {"models": to_jsonable(models)}


@router.post("/autoguess")
def autoguess(req: GuessRequest) -> dict[str, Any]:
    """Initial-parameter guess for ``model`` given (x, y)."""
    _require_model(req.model)
    try:
        p0 = auto_guess(req.model, req.x, req.y)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"p0": to_jsonable(p0)}


@router.post("/fit")
def fit(req: FitRequest) -> dict[str, Any]:
    """Bounded nonlinear least-squares fit of a named model to (x, y)."""
    _require_model(req.model)

    def model_fcn(
        xx: NDArray[np.float64], pp: NDArray[np.float64]
    ) -> NDArray[np.float64]:
        return evaluate(req.model, xx, pp)

    try:
        p0 = req.p0 if req.p0 is not None else auto_guess(req.model, req.x, req.y)
        result = curve_fit(
            req.x,
            req.y,
            model_fcn,
            p0,
            lower=req.lower,
            upper=req.upper,
            weights=req.weights,
            fixed=req.fixed,
            calc_errors=req.calc_errors,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(result)  # type: ignore[no-any-return]


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


@router.post("/bootstrap")
def bootstrap(req: BootstrapRequest) -> dict[str, Any]:
    """Bootstrap parameter CIs for a registry-model fit (calc.fit_bootstrap)."""
    _require_model(req.model)

    def model_fcn(xa: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(evaluate(req.model, xa, p), dtype=float)

    try:
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
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class PosteriorRequest(BaseModel):
    model: str
    x: list[float]
    y: list[float]
    p0: list[float]
    num_steps: int = 10000
    burn_in: int = 1000
    seed: int = 0
    lower: list[float] | None = None
    upper: list[float] | None = None


@router.post("/posterior")
def posterior(req: PosteriorRequest) -> dict[str, Any]:
    """MCMC posterior for a registry-model fit (calc.fit_bootstrap.fit_posterior)."""
    _require_model(req.model)

    def model_fcn(xa: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(evaluate(req.model, xa, p), dtype=float)

    try:
        return to_jsonable(  # type: ignore[no-any-return]
            fit_posterior(
                np.asarray(req.x, dtype=float),
                np.asarray(req.y, dtype=float),
                model_fcn,
                req.p0,
                num_steps=req.num_steps,
                burn_in=req.burn_in,
                seed=req.seed,
                lower=req.lower,
                upper=req.upper,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
