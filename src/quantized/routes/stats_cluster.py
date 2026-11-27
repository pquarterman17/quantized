"""Thin routes for k-means and hierarchical clustering plus the dendrogram export.

Wraps ``calc.stats_cluster_kmeans``, ``calc.stats_cluster_hier`` and
``calc.figure_dendrogram`` (ORIGIN_FEATURE_GAP_PLAN item 11, JMP_GAP_PLAN J13).
The rows arrive already chosen by the caller (excluded and masked rows skipped
and counted there); NaN rows are refused here, never imputed.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from quantized.calc.stats_cluster_hier import hierarchical_cluster
from quantized.calc.stats_cluster_kmeans import kmeans_cluster
from quantized.heavy_import import heavy_imports
from quantized.routes._errors import CALC_ERRORS_WITH_LOCK, call_calc, raise_calc_error
from quantized.routes._export_common import (
    _DPI_MAX,
    _DPI_MIN,
    _FIGURE_MIME,
    _attachment,
    _safe_name,
)
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api", tags=["stats"])

Standardize = Literal["none", "zscore", "range"]


class KmeansRequest(BaseModel):
    x: list[list[float]]
    k: int = Field(ge=2, le=100)
    standardize: Standardize = "zscore"
    init: Literal["kmeans++", "random"] = "kmeans++"
    seed: int = Field(default=0, ge=0, le=2**31 - 1)
    max_iter: int = Field(default=300, ge=1, le=100000)
    n_init: int = Field(default=10, ge=1, le=200)


class HierarchicalRequest(BaseModel):
    x: list[list[float]]
    method: Literal["single", "complete", "average", "ward"] = "average"
    metric: Literal["euclidean", "cityblock", "correlation"] = "euclidean"
    standardize: Standardize = "zscore"
    k: int | None = Field(default=None, ge=1)
    cut_distance: float | None = Field(default=None, ge=0)


@router.post("/stats/kmeans")
def kmeans(req: KmeansRequest) -> dict[str, Any]:
    """k-means (seeded k-means++, restarts): labels, centroids, sums of squares, silhouette."""
    return to_jsonable(  # type: ignore[no-any-return]
        call_calc(
            lambda: kmeans_cluster(
                req.x,
                req.k,
                standardize=req.standardize,
                init=req.init,
                seed=req.seed,
                max_iter=req.max_iter,
                n_init=req.n_init,
            )
        )
    )


@router.post("/stats/hierarchical")
def hierarchical(req: HierarchicalRequest) -> dict[str, Any]:
    """Hierarchical clustering: linkage, cophenetic correlation, labels, dendrogram geometry."""
    return to_jsonable(  # type: ignore[no-any-return]
        call_calc(
            lambda: hierarchical_cluster(
                req.x,
                method=req.method,
                metric=req.metric,
                standardize=req.standardize,
                k=req.k,
                cut_distance=req.cut_distance,
            )
        )
    )


class _Segment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: list[float] = Field(min_length=4, max_length=4)
    y: list[float] = Field(min_length=4, max_length=4)
    cluster: int = Field(ge=0)


class DendrogramGeometry(BaseModel):
    """The ``dendrogram`` member of ``/api/stats/hierarchical``'s response."""

    model_config = ConfigDict(extra="forbid")
    n_leaves: int = Field(ge=2, le=5000)
    leaf_order: list[int]
    leaf_cluster: list[int]
    segments: list[_Segment]
    cut: float
    max_height: float


class DendrogramFigureRequest(BaseModel):
    geometry: DendrogramGeometry
    leaf_names: list[str] | None = None
    title: str = ""
    fmt: str = "pdf"
    style: str = "default"
    dpi: int | None = None
    width_in: float | None = None
    height_in: float | None = None
    filename: str = "dendrogram"


@router.post("/export/dendrogram-figure")
def export_dendrogram_figure(req: DendrogramFigureRequest) -> Response:
    """Render the dendrogram (cut drawn, leaves coloured by cluster) as the screen view draws it."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}")
    g = req.geometry
    if len(g.segments) != g.n_leaves - 1 or len(g.leaf_order) != g.n_leaves:
        raise HTTPException(
            status_code=422,
            detail="geometry is inconsistent: need n_leaves - 1 links and one order entry per leaf",
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi)) if req.dpi is not None else None
    try:
        with heavy_imports("quantized.calc.figure_dendrogram"):
            from quantized.calc.figure_dendrogram import render_dendrogram_figure  # lazy

        img = render_dendrogram_figure(
            g.model_dump(),
            req.leaf_names,
            title=req.title,
            fmt=req.fmt,
            style=req.style,
            dpi=dpi,
            width_in=req.width_in,
            height_in=req.height_in,
        )
    except CALC_ERRORS_WITH_LOCK as exc:
        raise_calc_error(exc)
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
