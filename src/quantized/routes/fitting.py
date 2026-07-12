"""Thin fitting routes: list models, auto-guess, run a bounded NLLS fit.

No algorithms here — the math is in ``calc.fitting``/``calc.fit_models``/
``calc.fit_autoguess``. The model is chosen by name and resolved through the
registry (no eval); the curve_fit ``model_fcn`` is a closure over ``evaluate``.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_bootstrap import bootstrap_fit, fit_posterior
from quantized.calc.fit_equation import default_guesses, equation_model
from quantized.calc.fit_findxy import find_x, find_y
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fit_scan import scan_models
from quantized.calc.fitting import curve_fit, weights_from_dy
from quantized.routes._payload import to_jsonable

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]

router = APIRouter(prefix="/api/fitting", tags=["fitting"])


def _resolve_weights(
    dy: list[float] | None, weights: list[float] | None, n: int
) -> NDArray[np.float64] | list[float] | None:
    """Fit weighting from the request: ``dy`` (1-sigma errors, the canonical
    convention shared with ``/scan``) takes precedence and is converted to
    ``1/dy**2``; ``weights`` is the legacy raw-vector alias kept for back-compat.
    ``None`` -> unweighted."""
    if dy is not None:
        return weights_from_dy(dy, n)
    return weights


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
    # Per-point 1-sigma errors -> weights 1/dy^2 (canonical). Takes precedence
    # over the legacy raw `weights` vector when both are present.
    dy: list[float] | None = None
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
            weights=_resolve_weights(req.dy, req.weights, len(req.x)),
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


# ── Custom equation models (GOTO #1) ────────────────────────────────────────
# The equation text is the model; calc.fit_equation parses it with the no-eval
# RPN interpreter (the ONLY equation-evaluation path) and the fit runs through
# the same curve_fit engine as registry models, so the result shape (params/
# errors/R2/chiSqRed/RMSE/AIC/yFit) is identical.


class EquationValidateRequest(BaseModel):
    equation: str


class EquationFitRequest(BaseModel):
    equation: str
    x: list[float]
    y: list[float]
    guesses: list[float] | None = None
    # Bounds may hold null entries = unbounded on that side (JSON cannot
    # carry Infinity); mapped to -inf/+inf before curve_fit.
    lower: list[float | None] | None = None
    upper: list[float | None] | None = None
    # Per-point 1-sigma errors -> weights 1/dy^2 (canonical); precedence over `weights`.
    dy: list[float] | None = None
    weights: list[float] | None = None
    fixed: list[bool] | None = None
    calc_errors: bool = True


@router.post("/equation/validate")
def equation_validate(req: EquationValidateRequest) -> dict[str, Any]:
    """Validate a custom fit equation; 200 with ok/params[]/error (live UI)."""
    try:
        _, names = equation_model(req.equation)
    except (ValueError, IndexError) as exc:
        return {"ok": False, "params": [], "error": str(exc)}
    return {"ok": True, "params": names}


@router.post("/equation/fit")
def equation_fit(req: EquationFitRequest) -> dict[str, Any]:
    """Fit a custom equation model to (x, y); same result shape as /fit."""
    try:
        fcn, names = equation_model(req.equation)
        if not names:
            raise ValueError("equation has no free parameters to fit")
        p0 = req.guesses if req.guesses is not None else default_guesses(names)
        if len(p0) != len(names):
            raise ValueError(f"expected {len(names)} guesses, got {len(p0)}")
        lower = (
            [-math.inf if v is None else v for v in req.lower]
            if req.lower is not None
            else None
        )
        upper = (
            [math.inf if v is None else v for v in req.upper]
            if req.upper is not None
            else None
        )
        result = curve_fit(
            req.x,
            req.y,
            fcn,
            p0,
            lower=lower,
            upper=upper,
            weights=_resolve_weights(req.dy, req.weights, len(req.x)),
            fixed=req.fixed,
            calc_errors=req.calc_errors,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out: dict[str, Any] = to_jsonable(result)
    out["paramNames"] = names
    return out


# ── AICc model quick-scan (GOTO #6) ─────────────────────────────────────────


class ScanEquationCandidate(BaseModel):
    name: str
    equation: str
    guesses: list[float] | None = None


class ScanRequest(BaseModel):
    x: list[float]
    y: list[float]
    # Optional per-point 1-sigma errors -> fit weights 1/dy^2.
    dy: list[float] | None = None
    # None -> the default candidate set: every registry model with
    # nParams < n/3 (calc.fit_scan.default_candidates explains the cut).
    models: list[str] | None = None
    # Saved custom equation models ride along as extra candidates.
    equations: list[ScanEquationCandidate] | None = None


@router.post("/scan")
def scan(req: ScanRequest) -> dict[str, Any]:
    """Fit all candidate models and rank by AICc (calc.fit_scan.scan_models).

    Per-candidate failures come back as error entries in ``results`` — only
    invalid scan INPUT (length mismatch, bad dy, too few points) is a 422.
    """
    try:
        result = scan_models(
            req.x,
            req.y,
            dy=req.dy,
            models=req.models,
            equations=(
                [e.model_dump() for e in req.equations] if req.equations is not None else None
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(result)  # type: ignore[no-any-return]


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


# ── Find X from Y / Y from X on a fitted curve (MAIN #15) ──────────────────
# Inverse-evaluates a fit result the UI already holds (model/equation name +
# fitted params) -- no re-fit involved. Accepts EITHER a registry ``model``
# name or a saved custom ``equation`` string (mutually exclusive): both
# resolve to the same ``fcn(x, p) -> y`` shape (calc.fit_models.evaluate /
# calc.fit_equation.equation_model), so custom-equation fits get find-X/Y
# for free, not just registry models.


class FindXYRequest(BaseModel):
    model: str | None = None
    equation: str | None = None
    params: list[float]
    x_min: float
    x_max: float
    # Exactly one of x (find Y) / y (find X, all crossings) must be set.
    x: float | None = None
    y: float | None = None
    grid_points: int = 2000


@router.post("/find-xy")
def find_xy(req: FindXYRequest) -> dict[str, Any]:
    """Find Y at a given X, or every X where the fitted curve equals a given Y.

    ``x`` set -> ``{"y": <float | null>}`` (a single evaluation).
    ``y`` set -> ``{"x": [<float>, ...]}`` (every crossing within
    ``[x_min, x_max]``; an empty list is a valid "no crossing" answer, not
    an error).
    """
    if (req.model is None) == (req.equation is None):
        raise HTTPException(
            status_code=422, detail="specify exactly one of model or equation"
        )
    if (req.x is None) == (req.y is None):
        raise HTTPException(
            status_code=422, detail="specify exactly one of x (find Y) or y (find X)"
        )
    if req.x_max <= req.x_min:
        raise HTTPException(status_code=422, detail="x_max must be greater than x_min")

    fcn: ModelFn
    if req.model is not None:
        model_name = req.model
        _require_model(model_name)

        def fcn(xa: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
            return evaluate(model_name, xa, pp)
    else:
        equation = req.equation
        assert equation is not None  # narrowed by the "exactly one" check above
        try:
            fcn, names = equation_model(equation)
        except (ValueError, IndexError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if len(req.params) != len(names):
            raise HTTPException(
                status_code=422,
                detail=f"expected {len(names)} params for this equation, got {len(req.params)}",
            )

    try:
        if req.x is not None:
            return {"y": to_jsonable(find_y(fcn, req.params, req.x))}
        assert req.y is not None  # narrowed by the "exactly one" check above
        xs = find_x(fcn, req.params, req.y, req.x_min, req.x_max, grid_points=req.grid_points)
        return {"x": to_jsonable(xs)}
    except (ValueError, IndexError, ZeroDivisionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
