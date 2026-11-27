"""Thin routes: power / sample size / detectable effect, and the probability calculator.

``/api/stats/power`` (the t-test power route, routes/stats.py) is kept as is; this adds
the general solver for t, ANOVA, proportion and variance tests plus the calculator.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.prob_calc import DISTRIBUTIONS, evaluate
from quantized.calc.stats_power_solve import solve
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


class PowerSolveRequest(BaseModel):
    test: str
    solve: str  # "power" | "n" | "effect": the one left blank
    alpha: float = 0.05
    tails: int = 2
    effect: float | None = None  # Cohen's d / f, or the variance ratio
    p0: float | None = None  # proportion tests: baseline
    p1: float | None = None  # proportion tests: alternative
    n: int | None = None
    power: float | None = None
    ratio: float = 1.0  # n2 / n1 for two-group tests
    groups: int = 3  # ANOVA
    df: int | None = None  # chi-square test: degrees of freedom


@router.post("/power-solve")
def power_solve_route(req: PowerSolveRequest) -> dict[str, Any]:
    """Solve power, sample size or detectable effect (sample sizes round up)."""
    try:
        return to_jsonable(  # type: ignore[no-any-return]
            solve(
                req.test,
                req.solve,
                alpha=req.alpha,
                tails=req.tails,
                effect=req.effect,
                p0=req.p0,
                p1=req.p1,
                n=req.n,
                power=req.power,
                ratio=req.ratio,
                groups=req.groups,
                df=req.df,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class ProbabilityRequest(BaseModel):
    dist: str
    params: dict[str, float]
    x: list[float | None] | None = None  # null entries are blank cells
    p: list[float | None] | None = None


@router.post("/probability")
def probability_route(req: ProbabilityRequest) -> dict[str, Any]:
    """pdf / pmf, cdf, survival at x and the quantile at p, for one value or a column."""
    try:
        return to_jsonable(evaluate(req.dist, req.params, req.x, req.p))  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/probability/distributions")
def probability_distributions_route() -> list[dict[str, Any]]:
    """The calculator's distributions and parameters (the formula language's names)."""
    return [
        {
            "id": k,
            "label": d.label,
            "params": list(d.params),
            "defaults": list(d.defaults),
            "discrete": d.discrete,
        }
        for k, d in DISTRIBUTIONS.items()
    ]
