"""Thin routes for statistical-plot primitives (ORIGIN_GAP_PLAN #16).

All math lives in ``quantized.calc.statplots``; these adapters only validate,
call, and serialize. The same payloads feed the interactive stage and the
matplotlib export path.
"""

from __future__ import annotations

from typing import Annotated, Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.statplots import (
    grouped_box_stats,
    histogram,
    qq_plot,
    violin_kde,
)
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/statplots", tags=["statplots"])


def _wrap(result: dict[str, Any]) -> dict[str, Any]:
    return to_jsonable(result)  # type: ignore[no-any-return]


class BoxRequest(BaseModel):
    groups: list[list[float]]
    labels: list[str] | None = None
    whis: float | str = 1.5


@router.post("/box")
def box_route(req: BoxRequest) -> dict[str, Any]:
    """Box/whisker stats for one or more groups (matplotlib-compatible)."""
    try:
        return _wrap(grouped_box_stats(req.groups, labels=req.labels, whis=req.whis))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class ViolinRequest(BaseModel):
    data: list[float]
    bw_method: str | float = "scott"
    # calc.statplots.violin_kde evaluates scipy's gaussian_kde at n_points grid
    # locations (O(n_points * len(data))); n_points=1e9 never returns
    # (measured: 1e7 -> ~9.8s already). 100_000 is >780x the default.
    n_points: int = Field(128, ge=1, le=100_000)
    cut: float = 2.0


@router.post("/violin")
def violin_route(req: ViolinRequest) -> dict[str, Any]:
    """Gaussian-KDE density for a violin plot."""
    try:
        return _wrap(
            violin_kde(
                np.asarray(req.data, dtype=float),
                bw_method=req.bw_method, n_points=req.n_points, cut=req.cut,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class QQRequest(BaseModel):
    data: list[float]
    dist: str = "norm"


@router.post("/qq")
def qq_route(req: QQRequest) -> dict[str, Any]:
    """Quantile-quantile / probability-plot coordinates against a distribution."""
    try:
        return _wrap(qq_plot(np.asarray(req.data, dtype=float), dist=req.dist))
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class HistogramRequest(BaseModel):
    data: list[float]
    # calc.statplots.histogram passes an int `bins` straight to
    # np.histogram, which allocates `bins + 1` edges; bins=1e9 never returns
    # (measured: 1e7 -> ~12.5s already). 100_000 is a generous ceiling for a
    # data-driven bin count (the str rules above rarely exceed a few hundred).
    # A named rule ("fd", "sturges", ...) is unaffected -- only the int
    # branch of the union carries the bound.
    bins: str | Annotated[int, Field(ge=1, le=100_000)] = "fd"
    density: bool = False
    fit: str | None = None


@router.post("/histogram")
def histogram_route(req: HistogramRequest) -> dict[str, Any]:
    """Histogram with a data-driven bin rule and an optional fit overlay."""
    try:
        return _wrap(
            histogram(
                np.asarray(req.data, dtype=float),
                bins=req.bins, density=req.density, fit=req.fit,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
