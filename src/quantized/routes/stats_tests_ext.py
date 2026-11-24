"""Thin routes: hypothesis-test completion (GAP_AUDIT_9 G6).

Welch ANOVA, post hoc comparisons, variance tests, equivalence (TOST),
tolerance intervals and proportion tests. Same ``/api/stats`` prefix as
``routes/stats.py``. The math lives in ``calc.stats_group_tests``,
``calc.stats_equivalence`` and ``calc.stats_proportion``.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats_equivalence import tolerance_interval, tost_one_sample, tost_two_sample
from quantized.calc.stats_group_tests import posthoc_pairwise, variance_test, welch_anova
from quantized.calc.stats_proportion import binomial_test, fisher_2x2, two_proportions
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])

Alternative = Literal["two-sided", "less", "greater"]


def _wrap(result: dict[str, Any]) -> dict[str, Any]:
    return to_jsonable(result)  # type: ignore[no-any-return]


def _arrays(groups: list[list[float]]) -> list[Any]:
    return [np.asarray(g, dtype=float) for g in groups]


class GroupTestRequest(BaseModel):
    groups: list[list[float]]
    alpha: float = 0.05


class PosthocRequest(GroupTestRequest):
    method: Literal["tukey", "games-howell", "scheffe", "lsd"] = "games-howell"


class VarianceTestRequest(GroupTestRequest):
    method: Literal["bartlett", "levene", "brown-forsythe", "f-test"] = "bartlett"


class Margin(BaseModel):
    """Symmetric ``margin`` (+-) OR both ``low`` and ``high`` bounds."""

    margin: float | None = None
    low: float | None = None
    high: float | None = None
    alpha: float = 0.05


class TostOneRequest(Margin):
    x: list[float]
    mu0: float = 0.0


class TostTwoRequest(Margin):
    x: list[float]
    y: list[float]
    design: Literal["welch", "pooled", "paired"] = "welch"


class ToleranceRequest(BaseModel):
    x: list[float]
    coverage: float = 0.9
    confidence: float = 0.95
    sides: Literal["two", "upper", "lower"] = "two"


class BinomialRequest(BaseModel):
    successes: float
    trials: float
    p0: float = 0.5
    method: Literal["exact", "normal"] = "exact"
    alternative: Alternative = "two-sided"
    alpha: float = 0.05


class TwoCountsRequest(BaseModel):
    x1: float
    n1: float
    x2: float
    n2: float
    alternative: Alternative = "two-sided"
    alpha: float = 0.05


@router.post("/welch-anova")
def welch_anova_route(req: GroupTestRequest) -> dict[str, Any]:
    """Welch's heteroscedastic one-way ANOVA."""
    try:
        return _wrap(welch_anova(_arrays(req.groups), alpha=req.alpha))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/posthoc")
def posthoc_route(req: PosthocRequest) -> dict[str, Any]:
    """All-pairs comparisons: Tukey, Games-Howell, Scheffe or Fisher LSD."""
    try:
        return _wrap(posthoc_pairwise(_arrays(req.groups), method=req.method, alpha=req.alpha))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/variance-test")
def variance_test_route(req: VarianceTestRequest) -> dict[str, Any]:
    """Equal-variance tests: Bartlett, Levene, Brown-Forsythe, two-sample F."""
    try:
        return _wrap(variance_test(_arrays(req.groups), method=req.method, alpha=req.alpha))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/tost-one")
def tost_one_route(req: TostOneRequest) -> dict[str, Any]:
    """One-sample equivalence test (TOST) against ``mu0`` +- margin."""
    try:
        return _wrap(
            tost_one_sample(
                np.asarray(req.x, dtype=float),
                mu0=req.mu0,
                margin=req.margin,
                low=req.low,
                high=req.high,
                alpha=req.alpha,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/tost-two")
def tost_two_route(req: TostTwoRequest) -> dict[str, Any]:
    """Two-sample (Welch / pooled / paired) equivalence test (TOST)."""
    try:
        return _wrap(
            tost_two_sample(
                np.asarray(req.x, dtype=float),
                np.asarray(req.y, dtype=float),
                design=req.design,
                margin=req.margin,
                low=req.low,
                high=req.high,
                alpha=req.alpha,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/tolerance-interval")
def tolerance_interval_route(req: ToleranceRequest) -> dict[str, Any]:
    """Normal tolerance interval / bound (coverage p, confidence)."""
    try:
        return _wrap(
            tolerance_interval(
                np.asarray(req.x, dtype=float),
                coverage=req.coverage,
                confidence=req.confidence,
                sides=req.sides,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/binomial-test")
def binomial_test_route(req: BinomialRequest) -> dict[str, Any]:
    """One-sample proportion test: exact binomial or normal approximation."""
    try:
        return _wrap(
            binomial_test(
                req.successes,
                req.trials,
                p0=req.p0,
                method=req.method,
                alternative=req.alternative,
                alpha=req.alpha,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/two-proportions")
def two_proportions_route(req: TwoCountsRequest) -> dict[str, Any]:
    """Two-sample proportion z test."""
    try:
        return _wrap(
            two_proportions(
                req.x1, req.n1, req.x2, req.n2, alternative=req.alternative, alpha=req.alpha
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/fisher-2x2")
def fisher_2x2_route(req: TwoCountsRequest) -> dict[str, Any]:
    """Fisher's exact test on a 2x2 table built from two success counts."""
    try:
        return _wrap(
            fisher_2x2(req.x1, req.n1, req.x2, req.n2, alternative=req.alternative, alpha=req.alpha)
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
