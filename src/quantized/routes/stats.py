"""Thin statistics routes. Wraps ``calc.stats`` (no toolbox, golden vs MATLAB).

Each handler validates, converts to ndarray, calls the pure function, and
serializes the (array-bearing) result dict via ``to_jsonable``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats import (
    anova1,
    descriptive_stats,
    lin_regress,
    pca_analysis,
    t_test,
)
from quantized.calc.stats_multivar import (
    correlation_matrix,
    multiple_regression,
    partial_correlation,
)
from quantized.calc.stats_tests import (
    anderson_darling,
    friedman,
    kruskal_wallis,
    ks_normal,
    ks_two_sample,
    levene,
    mann_whitney,
    shapiro_wilk,
    sign_test,
    wilcoxon_signed_rank,
)
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


class DescriptiveRequest(BaseModel):
    x: list[float]


class RegressionRequest(BaseModel):
    x: list[float]
    y: list[float]
    order: int = 1
    alpha: float = 0.05


class TTestRequest(BaseModel):
    x: list[float]
    y: list[float] | None = None
    mu: float = 0.0
    paired: bool = False
    alpha: float = 0.05
    tail: str = "both"


class AnovaRequest(BaseModel):
    groups: list[list[float]]
    alpha: float = 0.05


class PCARequest(BaseModel):
    data: list[list[float]]
    center: bool = True
    scale: bool = False
    num_components: int = 0


class TwoSampleRequest(BaseModel):
    x: list[float]
    y: list[float]
    alternative: str = "two-sided"


class PairedOrOneSampleRequest(BaseModel):
    x: list[float]
    y: list[float] | None = None
    mu: float = 0.0
    alternative: str = "two-sided"


class GroupsRequest(BaseModel):
    groups: list[list[float]]


class LeveneRequest(BaseModel):
    groups: list[list[float]]
    center: str = "median"


class OneSampleRequest(BaseModel):
    x: list[float]


class KSNormalRequest(BaseModel):
    x: list[float]
    loc: float | None = None
    scale: float | None = None


class MultiRegressionRequest(BaseModel):
    predictors: list[list[float]]  # k same-length columns
    y: list[float]
    alpha: float = 0.05


class CorrelationRequest(BaseModel):
    columns: list[list[float]]
    method: str = "pearson"


class PartialCorrelationRequest(BaseModel):
    columns: list[list[float]]


def _wrap(result: dict[str, Any]) -> dict[str, Any]:
    return to_jsonable(result)  # type: ignore[no-any-return]


@router.post("/descriptive")
def descriptive(req: DescriptiveRequest) -> dict[str, Any]:
    """Descriptive statistics of a 1-D array (NaNs dropped)."""
    try:
        return _wrap(descriptive_stats(np.asarray(req.x, dtype=float)))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/regression")
def regression(req: RegressionRequest) -> dict[str, Any]:
    """Polynomial least-squares regression with inference."""
    try:
        return _wrap(
            lin_regress(
                np.asarray(req.x, dtype=float),
                np.asarray(req.y, dtype=float),
                order=req.order,
                alpha=req.alpha,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/ttest")
def ttest(req: TTestRequest) -> dict[str, Any]:
    """Student's t-test (one-sample / paired / Welch two-sample)."""
    try:
        y = np.asarray(req.y, dtype=float) if req.y is not None else None
        return _wrap(
            t_test(
                np.asarray(req.x, dtype=float),
                y,
                mu=req.mu,
                paired=req.paired,
                alpha=req.alpha,
                tail=req.tail,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/anova")
def anova(req: AnovaRequest) -> dict[str, Any]:
    """One-way ANOVA on a list of group vectors."""
    try:
        groups = [np.asarray(g, dtype=float) for g in req.groups]
        return _wrap(anova1(groups, alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/pca")
def pca(req: PCARequest) -> dict[str, Any]:
    """Principal component analysis via SVD."""
    try:
        return _wrap(
            pca_analysis(
                np.asarray(req.data, dtype=float),
                center=req.center,
                scale=req.scale,
                num_components=req.num_components,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/mann-whitney")
def mann_whitney_route(req: TwoSampleRequest) -> dict[str, Any]:
    """Mann-Whitney U test (independent two-sample rank test)."""
    try:
        return _wrap(
            mann_whitney(
                np.asarray(req.x, dtype=float),
                np.asarray(req.y, dtype=float),
                alternative=req.alternative,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/wilcoxon")
def wilcoxon_route(req: PairedOrOneSampleRequest) -> dict[str, Any]:
    """Wilcoxon signed-rank test (paired, or one-sample vs mu)."""
    try:
        y = np.asarray(req.y, dtype=float) if req.y is not None else None
        return _wrap(
            wilcoxon_signed_rank(
                np.asarray(req.x, dtype=float), y, mu=req.mu, alternative=req.alternative
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/kruskal")
def kruskal_route(req: GroupsRequest) -> dict[str, Any]:
    """Kruskal-Wallis H test on a list of group vectors."""
    try:
        return _wrap(kruskal_wallis([np.asarray(g, dtype=float) for g in req.groups]))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/friedman")
def friedman_route(req: GroupsRequest) -> dict[str, Any]:
    """Friedman test (k treatments x n blocks, equal lengths)."""
    try:
        return _wrap(friedman([np.asarray(g, dtype=float) for g in req.groups]))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sign-test")
def sign_test_route(req: PairedOrOneSampleRequest) -> dict[str, Any]:
    """Sign test (paired, or one-sample vs mu) via exact binomial."""
    try:
        y = np.asarray(req.y, dtype=float) if req.y is not None else None
        return _wrap(
            sign_test(np.asarray(req.x, dtype=float), y, mu=req.mu, alternative=req.alternative)
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/shapiro")
def shapiro_route(req: OneSampleRequest) -> dict[str, Any]:
    """Shapiro-Wilk normality test."""
    try:
        return _wrap(shapiro_wilk(np.asarray(req.x, dtype=float)))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/anderson")
def anderson_route(req: OneSampleRequest) -> dict[str, Any]:
    """Anderson-Darling normality test (critical-value table, no p)."""
    try:
        return _wrap(anderson_darling(np.asarray(req.x, dtype=float)))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/levene")
def levene_route(req: LeveneRequest) -> dict[str, Any]:
    """Levene / Brown-Forsythe equal-variance test."""
    try:
        return _wrap(
            levene([np.asarray(g, dtype=float) for g in req.groups], center=req.center)
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/ks-normal")
def ks_normal_route(req: KSNormalRequest) -> dict[str, Any]:
    """One-sample KS test vs a normal distribution."""
    try:
        return _wrap(ks_normal(np.asarray(req.x, dtype=float), loc=req.loc, scale=req.scale))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/regression-multi")
def regression_multi(req: MultiRegressionRequest) -> dict[str, Any]:
    """Multiple linear regression (intercept + k predictors) with inference."""
    try:
        return _wrap(
            multiple_regression(
                [np.asarray(c, dtype=float) for c in req.predictors],
                np.asarray(req.y, dtype=float),
                alpha=req.alpha,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/correlation")
def correlation(req: CorrelationRequest) -> dict[str, Any]:
    """Pairwise Pearson/Spearman correlation matrix with p-values."""
    try:
        return _wrap(
            correlation_matrix(
                [np.asarray(c, dtype=float) for c in req.columns], method=req.method
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/partial-correlation")
def partial_correlation_route(req: PartialCorrelationRequest) -> dict[str, Any]:
    """Partial correlation of every pair controlling for all other columns."""
    try:
        return _wrap(partial_correlation([np.asarray(c, dtype=float) for c in req.columns]))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/ks-two-sample")
def ks_two_sample_route(req: TwoSampleRequest) -> dict[str, Any]:
    """Two-sample KS test."""
    try:
        return _wrap(
            ks_two_sample(
                np.asarray(req.x, dtype=float),
                np.asarray(req.y, dtype=float),
                alternative=req.alternative,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
