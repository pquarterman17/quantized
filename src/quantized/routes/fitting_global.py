"""Thin routes for global (shared-parameter) curve fitting.

``POST /api/fitting/global`` fits one model to several datasets at once with
``calc.global_curve_fit`` (port of MATLAB ``fitting.globalCurveFit``): each
``constraints`` entry names a parameter and the datasets (0-based) that share
one value of it; every other parameter is free per dataset. The model is a
registry name or a custom equation (the no-eval parser), exactly one of the
two. ``POST /api/fitting/global/job`` runs the same fit through the poll-model
job runner and answers ``{"job_id"}``: Nelder-Mead over every dataset's free
parameters can take seconds to minutes, so the UI uses the job route and can
cancel it (``POST /api/jobs/{id}/cancel``).

Unlike ``/scan/job``, input is validated BEFORE the job is queued, so a bad
request is a 422 on either route rather than a job that fails on first poll.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_equation import default_guesses, equation_model
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fitting import weights_from_dy
from quantized.calc.global_curve_fit import GlobalFitCancelled, global_curve_fit, share_groups
from quantized.jobs import AbortFn, JobCancelled, JobQueueFullError, ProgressFn, jobs
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import to_jsonable

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]

router = APIRouter(prefix="/api/fitting", tags=["fitting"], route_class=OffloopJSONRoute)


class GlobalSeries(BaseModel):
    """One dataset of a global fit: its (x, y) pairs and optional 1-sigma dy."""

    x: list[float]
    y: list[float]
    dy: list[float] | None = None


class ShareGroup(BaseModel):
    """Parameter ``param_name`` takes ONE value across these datasets (0-based)."""

    param_name: str
    datasets: list[int]


class GlobalFitRequest(BaseModel):
    model: str | None = None
    equation: str | None = None
    datasets: list[GlobalSeries]
    constraints: list[ShareGroup] = []
    # One start vector (broadcast to every dataset) or one per dataset.
    # Omitted -> auto-guessed per dataset (registry) / 1.0 each (equation).
    p0: list[list[float]] | list[float] | None = None
    # Bounds apply to every dataset; null = unbounded on that side.
    lower: list[float | None] | None = None
    upper: list[float | None] | None = None
    max_iter: int = Field(default=20000, ge=1, le=200_000)


@dataclass
class _Problem:
    fcn: ModelFn
    names: list[str]
    series: list[tuple[list[float], list[float]]]
    constraints: list[dict[str, Any]]
    p0: list[list[float]]
    lower: list[float] | None
    upper: list[float] | None
    weights: list[Any] | None
    max_iter: int


def _bounds(v: list[float | None] | None, fill: float, n: int, side: str) -> list[float] | None:
    if v is None:
        return None
    if len(v) != n:
        raise ValueError(f"{side} must have {n} values (one per parameter), got {len(v)}")
    return [fill if b is None else float(b) for b in v]


def _prepare(req: GlobalFitRequest) -> _Problem:
    """Validate the request and resolve the model -> a calc-ready problem."""
    if (req.model is None) == (req.equation is None):
        raise ValueError("specify exactly one of model or equation")
    if not req.datasets:
        raise ValueError("need at least one dataset")
    for i, s in enumerate(req.datasets):
        if len(s.x) != len(s.y):
            raise ValueError(f"dataset {i}: x and y must be the same length")
        if not s.x:
            raise ValueError(f"dataset {i} has no points")

    fcn: ModelFn
    if req.model is not None:
        model_name = req.model
        if model_name not in FIT_MODELS:
            raise ValueError(f"unknown model: {model_name}")

        def fcn(xx: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
            # `evaluate` resolves at call time (tests gate it to force a cancel).
            return evaluate(model_name, xx, pp)

        names = [str(n) for n in FIT_MODELS[model_name]["paramNames"]]
    else:
        assert req.equation is not None  # narrowed by the exactly-one check
        fcn, names = equation_model(req.equation)
        if not names:
            raise ValueError("equation has no free parameters to fit")
    n_par, k = len(names), len(req.datasets)

    p0: list[list[float]]
    if req.p0 is None:
        if req.model is not None:
            p0 = [[float(v) for v in auto_guess(req.model, s.x, s.y)] for s in req.datasets]
        else:
            p0 = [default_guesses(names) for _ in req.datasets]
    elif all(isinstance(v, list) for v in req.p0):
        p0 = [[float(v) for v in row] for row in req.p0 if isinstance(row, list)]
        if len(p0) != k:
            raise ValueError(f"p0 needs one start vector per dataset ({k}), got {len(p0)}")
    else:
        p0 = [[float(v) for v in req.p0 if not isinstance(v, list)]] * k
    for row in p0:
        if len(row) != n_par:
            raise ValueError(f"p0 must have {n_par} values (one per parameter), got {len(row)}")

    weights: list[Any] | None = None
    if any(s.dy is not None for s in req.datasets):
        weights = [None if s.dy is None else weights_from_dy(s.dy, len(s.x)) for s in req.datasets]

    return _Problem(
        fcn=fcn,
        names=names,
        series=[(s.x, s.y) for s in req.datasets],
        constraints=[{"param_name": c.param_name, "datasets": c.datasets} for c in req.constraints],
        p0=p0,
        lower=_bounds(req.lower, -math.inf, n_par, "lower"),
        upper=_bounds(req.upper, math.inf, n_par, "upper"),
        weights=weights,
        max_iter=req.max_iter,
    )


def _solve(
    prob: _Problem,
    progress: ProgressFn | None = None,
    abort_check: AbortFn | None = None,
) -> dict[str, Any]:
    result = global_curve_fit(
        list(prob.series), prob.fcn, prob.names, prob.constraints,
        init_guess=prob.p0, lower=prob.lower, upper=prob.upper, weights=prob.weights,
        max_iter=prob.max_iter, progress_callback=progress, abort_check=abort_check,
    )
    out: dict[str, Any] = to_jsonable(result)
    out["paramNames"] = prob.names
    return out


def _checked(req: GlobalFitRequest) -> _Problem:
    """``_prepare`` plus the sharing-group checks (unknown parameter,
    out-of-range dataset), so both routes 422 before any fitting starts."""
    try:
        prob = _prepare(req)
        share_groups(prob.constraints, prob.names, len(prob.series))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return prob


@router.post("/global")
def global_fit_route(req: GlobalFitRequest) -> dict[str, Any]:
    """Fit one model to several datasets with shared parameters (synchronous)."""
    prob = _checked(req)
    try:
        return _solve(prob)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/global/job")
def global_fit_job(req: GlobalFitRequest) -> dict[str, Any]:
    """Queue the global fit; poll ``GET /api/jobs/{id}`` and fetch ``/result``.

    Progress is the Nelder-Mead iteration (``fraction`` = iteration /
    ``max_iter``, an upper bound). A cancel stops the fit at its next model
    evaluation and ends the job ``cancelled`` with no partial result.
    """
    prob = _checked(req)

    def run_job(progress: ProgressFn, abort_check: AbortFn) -> Any:
        try:
            return _solve(prob, progress, abort_check)
        except GlobalFitCancelled as exc:
            raise JobCancelled(str(exc)) from exc

    try:
        return {"job_id": jobs.submit(run_job)}
    except JobQueueFullError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
