"""Thin routes: designed-experiment ANOVA + post-hoc + the test chooser.

Split from routes/stats.py (500-line module ceiling); same /api/stats prefix.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats_anova2 import adjust_pvalues, anova2, dunnett_test, tukey_hsd
from quantized.calc.stats_anova_ext import anova2_unbalanced, repeated_measures_anova
from quantized.calc.stats_tests import recommend_test
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _wrap(result: dict[str, Any]) -> dict[str, Any]:
    return to_jsonable(result)  # type: ignore[no-any-return]


class Anova2Request(BaseModel):
    cells: list[list[list[float]]]  # [A-level][B-level][replicates], balanced
    alpha: float = 0.05


@router.post("/anova2")
def anova2_route(req: Anova2Request) -> dict[str, Any]:
    """Balanced two-way factorial ANOVA with interaction."""
    try:
        return _wrap(anova2(req.cells, alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class Anova2UnbalancedRequest(BaseModel):
    values: list[float]
    factor_a: list[str]
    factor_b: list[str]
    ss_type: int = 3  # 2 or 3
    alpha: float = 0.05


@router.post("/anova2-unbalanced")
def anova2_unbalanced_route(req: Anova2UnbalancedRequest) -> dict[str, Any]:
    """Unbalanced two-way ANOVA (Type II/III SS) from long-format columns."""
    try:
        return _wrap(
            anova2_unbalanced(
                np.asarray(req.values, dtype=float),
                req.factor_a, req.factor_b,
                ss_type=req.ss_type, alpha=req.alpha,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class RepeatedMeasuresRequest(BaseModel):
    data: list[list[float]]  # rows = subjects, columns = conditions
    alpha: float = 0.05


@router.post("/anova-rm")
def anova_rm_route(req: RepeatedMeasuresRequest) -> dict[str, Any]:
    """One-way repeated-measures (within-subjects) ANOVA + sphericity."""
    try:
        return _wrap(repeated_measures_anova(req.data, alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class PostHocRequest(BaseModel):
    groups: list[list[float]]
    alpha: float = 0.05
    control: int = 0  # dunnett only
    alternative: str = "two-sided"  # dunnett only


@router.post("/tukey")
def tukey_route(req: PostHocRequest) -> dict[str, Any]:
    """Tukey HSD all-pairs post-hoc."""
    try:
        return _wrap(tukey_hsd([np.asarray(g, dtype=float) for g in req.groups], alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/dunnett")
def dunnett_route(req: PostHocRequest) -> dict[str, Any]:
    """Dunnett many-to-one post-hoc vs a control group."""
    try:
        return _wrap(
            dunnett_test(
                [np.asarray(g, dtype=float) for g in req.groups],
                control=req.control, alpha=req.alpha, alternative=req.alternative,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class RecommendRequest(BaseModel):
    groups: list[list[float]]
    paired: bool = False
    alpha: float = 0.05


@router.post("/recommend")
def recommend_route(req: RecommendRequest) -> dict[str, Any]:
    """The 'which test?' chooser: assumption checks -> recommended test."""
    try:
        return _wrap(
            recommend_test(
                [np.asarray(g, dtype=float) for g in req.groups],
                paired=req.paired, alpha=req.alpha,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class AdjustPRequest(BaseModel):
    p_values: list[float]
    method: str = "holm"


@router.post("/adjust-p")
def adjust_p_route(req: AdjustPRequest) -> dict[str, Any]:
    """Bonferroni / Holm / Benjamini-Hochberg p-value adjustment."""
    try:
        return _wrap(adjust_pvalues(req.p_values, method=req.method))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
