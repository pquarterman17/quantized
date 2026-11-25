"""Thin routes: censored life distributions and Fit Life by X (GAP_AUDIT_9 G8).

Same ``/api/stats`` prefix as ``routes/stats.py``. Math: ``calc.stats_life``,
``calc.stats_life_byx``. ``censor`` follows JMP: 1 = censored, 0 = failed.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc.stats_life import fit_life
from quantized.calc.stats_life_byx import fit_life_by_x
from quantized.calc.stats_life_interval import fit_life_interval
from quantized.heavy_import import heavy_imports
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])

LifeDist = Literal["weibull", "lognormal", "exponential", "loglogistic", "sev"]
CiMethod = Literal["wald", "likelihood-ratio"]


class LifeDistributionRequest(BaseModel):
    time: list[float]
    censor: list[float]
    distribution: LifeDist = "weibull"
    compare: bool = False
    alpha: float = 0.05
    quantile_probs: list[float] | None = None
    eval_times: list[float] = Field(default_factory=list)
    plotting: Literal["median-rank", "kaplan-meier"] = "median-rank"
    ci_method: CiMethod = "wald"


class LifeIntervalRequest(BaseModel):
    """Rows (lower, upper): equal = exact, lower 0 = left-censored, null upper = right-censored."""

    lower: list[float]
    upper: list[float | None]
    distribution: LifeDist = "weibull"
    compare: bool = False
    alpha: float = 0.05
    quantile_probs: list[float] | None = None
    eval_times: list[float] = Field(default_factory=list)
    ci_method: CiMethod = "wald"


class LifeFigureRequest(BaseModel):
    """The ``plot`` block of a life-distribution / life-interval result, plus export options."""

    plot: dict[str, Any]
    fmt: Literal["pdf", "svg", "eps", "png", "tiff"] = "pdf"
    style: str = "default"
    title: str = ""
    x_label: str = "time"


class LifeByXRequest(BaseModel):
    time: list[float]
    censor: list[float]
    x: list[float]
    distribution: Literal["weibull", "lognormal", "exponential", "loglogistic"] = "weibull"
    transform: Literal["arrhenius-celsius", "arrhenius-kelvin", "power", "linear"] = (
        "arrhenius-celsius"
    )
    use_x: float | None = None
    alpha: float = 0.05
    quantile_probs: list[float] | None = None


@router.post("/life-distribution")
def life_distribution_route(req: LifeDistributionRequest) -> dict[str, Any]:
    """Right-censored MLE fit, model comparison, Kaplan-Meier, B-lives, probability plot."""
    try:
        out = fit_life(
            req.time,
            req.censor,
            distribution=req.distribution,
            compare=req.compare,
            alpha=req.alpha,
            quantile_probs=req.quantile_probs,
            eval_times=req.eval_times,
            plotting=req.plotting,
            ci_method=req.ci_method,
        )
        return to_jsonable(out)  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/life-by-x")
def life_by_x_route(req: LifeByXRequest) -> dict[str, Any]:
    """Life regression on one stress variable (Arrhenius / power / linear)."""
    try:
        out = fit_life_by_x(
            req.time,
            req.censor,
            req.x,
            distribution=req.distribution,
            transform=req.transform,
            use_x=req.use_x,
            alpha=req.alpha,
            quantile_probs=req.quantile_probs,
        )
        return to_jsonable(out)  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/life-interval")
def life_interval_route(req: LifeIntervalRequest) -> dict[str, Any]:
    """Interval- / left-censored MLE fit and the Turnbull nonparametric estimate."""
    try:
        out = fit_life_interval(
            req.lower,
            req.upper,
            distribution=req.distribution,
            compare=req.compare,
            alpha=req.alpha,
            quantile_probs=req.quantile_probs,
            eval_times=req.eval_times,
            ci_method=req.ci_method,
        )
        return to_jsonable(out)  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


_MIME = {
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
    "eps": "application/postscript",
    "png": "image/png",
    "tiff": "image/tiff",
}


@router.post("/life-figure")
def life_figure_route(req: LifeFigureRequest) -> Response:
    """Vector (default) export of the censored probability plot."""
    with heavy_imports("quantized.calc.figure_lifeplot"):
        from quantized.calc.figure_lifeplot import render_life_probability_figure  # lazy

    try:
        data = render_life_probability_figure(
            req.plot, title=req.title, x_label=req.x_label, fmt=req.fmt, style=req.style
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(content=data, media_type=_MIME[req.fmt])
