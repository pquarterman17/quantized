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
