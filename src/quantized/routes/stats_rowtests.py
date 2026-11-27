"""Thin routes: row-wise t-tests, the Mann-Kendall trend test and its seasonal form.

Math: ``calc.stats_rowtests`` and ``calc.stats_trend``. Same ``/api/stats``
prefix as ``routes/stats.py``.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats_rowtests import row_t_tests
from quantized.calc.stats_trend import mann_kendall
from quantized.calc.stats_trend_seasonal import seasonal_mann_kendall
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])

Cell = float | None


class RowTTestRequest(BaseModel):
    """Blocks are rows by columns; ``None`` marks a missing cell."""

    a: list[list[Cell]]
    b: list[list[Cell]] | None = None
    design: Literal["two-sample", "one-sample", "paired"] = "two-sample"
    variance: Literal["pooled", "welch"] = "welch"
    mu: float = 0.0
    alpha: float = 0.05
    alternative: Literal["two-sided", "less", "greater"] = "two-sided"
    adjust: Literal["none", "bonferroni", "holm", "bh"] = "none"


class MannKendallRequest(BaseModel):
    y: list[float]
    x: list[float] | None = None
    alpha: float = 0.05


class SeasonalMannKendallRequest(BaseModel):
    """The season is a label per observation OR a period (not both)."""

    y: list[float]
    x: list[float] | None = None
    season: list[float | str] | None = None
    period: int | None = None
    alpha: float = 0.05


@router.post("/row-t-tests")
def row_t_tests_route(req: RowTTestRequest) -> dict[str, Any]:
    """One t-test per row: Student (pooled) or Welch, one-sample, two-sample or paired."""
    try:
        return to_jsonable(  # type: ignore[no-any-return]
            row_t_tests(
                req.a, req.b, design=req.design, variance=req.variance, mu=req.mu,
                alpha=req.alpha, alternative=req.alternative, adjust=req.adjust,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/mann-kendall")
def mann_kendall_route(req: MannKendallRequest) -> dict[str, Any]:
    """Mann-Kendall trend test with Sen's slope and its confidence interval."""
    try:
        return to_jsonable(mann_kendall(req.y, req.x, alpha=req.alpha))  # type: ignore[no-any-return]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/mann-kendall-seasonal")
def seasonal_mann_kendall_route(req: SeasonalMannKendallRequest) -> dict[str, Any]:
    """Seasonal Mann-Kendall (Hirsch-Slack) with the pooled seasonal Sen slope."""
    try:
        return to_jsonable(  # type: ignore[no-any-return]
            seasonal_mann_kendall(
                req.y, req.x, season=req.season, period=req.period, alpha=req.alpha
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
