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
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_equation import equation_model
from quantized.calc.fit_equation_init import auto_start
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fitting import weights_from_dy
from quantized.calc.global_curve_fit import (
    GlobalFitCancelled,
    global_curve_fit,
    held_slots,
    share_groups,
    slot_layout,
)
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
    # Omitted -> auto-guessed per dataset (registry) / derived from each
    # dataset's data (equation: calc.fit_equation_init.auto_start).
    p0: list[list[float]] | list[float] | None = None
    # Bounds apply to every dataset; null = unbounded on that side.
    lower: list[float | None] | None = None
    upper: list[float | None] | None = None
    # Held (fixed) parameters: one flag vector (every dataset) or one per
    # dataset. A shared parameter is held in all of its datasets or none.
    fixed: list[list[bool]] | list[bool] | None = None
    # Parameter errors: "jtj" (Origin / scipy, default) or "hessian" (MATLAB).
    covariance: Literal["jtj", "hessian"] = "jtj"
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
    fixed: list[list[bool]] | list[bool] | None
    covariance: str
    max_iter: int


def _bounds(v: list[float | None] | None, fill: float, n: int, side: str) -> list[float] | None:
    if v is None:
        return None
    if len(v) != n:
        raise ValueError(f"{side} must have {n} values (one per parameter), got {len(v)}")
    return [fill if b is None else float(b) for b in v]


def _held_rows(fixed: list[list[bool]] | list[bool] | None, k: int, n: int) -> list[list[bool]]:
    """``fixed`` as K rows of n flags (broadcast a single row); shape errors
    are left to ``held_slots`` -- this only feeds start derivation."""
    if fixed is None:
        return [[False] * n for _ in range(k)]
    if all(isinstance(v, list) for v in fixed):
        rows = [list(r) for r in fixed if isinstance(r, list)]
    else:
        rows = [[bool(v) for v in fixed if not isinstance(v, list)]] * k
    return [r if len(r) == n else [False] * n for r in rows[:k]] + [[False] * n] * (k - len(rows))


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
    lower = _bounds(req.lower, -math.inf, n_par, "lower")
    upper = _bounds(req.upper, math.inf, n_par, "upper")

    p0: list[list[float]]
    if req.p0 is None:
        if req.model is not None:
            p0 = [[float(v) for v in auto_guess(req.model, s.x, s.y)] for s in req.datasets]
        else:
            # Data-driven starts per dataset (blank guesses, finding 14);
            # held parameters keep the legacy 1.0.
            held = _held_rows(req.fixed, k, n_par)
            p0 = [auto_start(fcn, names, s.x, s.y, lower=lower, upper=upper, fixed=held[i])
                  for i, s in enumerate(req.datasets)]
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
        lower=lower,
        upper=upper,
        weights=weights,
        fixed=req.fixed,
        covariance=req.covariance,
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
        fixed=prob.fixed, covariance=prob.covariance, max_iter=prob.max_iter,
        progress_callback=progress, abort_check=abort_check,
    )
    out: dict[str, Any] = to_jsonable(result)
    out["paramNames"] = prob.names
    return out


def _checked(req: GlobalFitRequest) -> _Problem:
    """``_prepare`` plus the sharing-group and held-parameter checks (unknown
    parameter, out-of-range dataset, a shared parameter held in only some of
    its datasets), so both routes 422 before any fitting starts."""
    try:
        prob = _prepare(req)
        groups = share_groups(prob.constraints, prob.names, len(prob.series))
        _check_held(prob, groups)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return prob


def _check_held(prob: _Problem, groups: list[dict[str, Any]]) -> None:
    """Validate ``fixed`` against the sharing layout without fitting."""
    if prob.fixed is None:
        return
    k, p = len(prob.series), len(prob.names)
    _, super_idx, n_super = slot_layout(groups, k, p)
    held_slots(prob.fixed, k, p, super_idx, n_super)


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
