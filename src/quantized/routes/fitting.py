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
