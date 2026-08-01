"""Multivariate workbench figure export routes (JMP_GAP_PLAN #10 residual):
correlation heatmap, SPLOM, and PCA scores/loadings/biplot + scree.

Split into its own router file rather than folding into ``export_statplots.py``
(same 500-line-ceiling reason that file itself was split out of
``export_figures.py``). Wraps ``calc.figure_multivar`` — PRE-AGGREGATED
numbers in (already-fetched correlation/PCA results, or the listwise-complete
column set ``useMultivar`` shares across correlation/PCA/SPLOM), not a
``dataset`` + channel picks, so it shares no helper with ``export_figures.py``.
Output formats: PDF/SVG/PNG/TIFF. No formatting logic here — the renderer owns
it. Filenames are sanitized before reaching the Content-Disposition header.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.routes._export_common import (
    _DPI_MAX,
    _DPI_MIN,
    _FIGURE_MIME,
    _attachment,
    _safe_name,
)

router = APIRouter(prefix="/api/export", tags=["export"])


def _clamp_dpi(dpi: int | None) -> int | None:
    return max(_DPI_MIN, min(_DPI_MAX, dpi)) if dpi is not None else None


def _check_fmt(fmt: str) -> None:
    if fmt not in _FIGURE_MIME:
        raise HTTPException(status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}")


class CorrelationHeatmapFigureRequest(BaseModel):
    labels: list[str]
    r: list[list[float]]
    title: str = ""
    fmt: str = "pdf"
    style: str = "default"
    dpi: int | None = None
    width_in: float | None = None
    height_in: float | None = None
    filename: str = "correlation"


@router.post("/correlation-heatmap-figure")
def export_correlation_heatmap_figure(req: CorrelationHeatmapFigureRequest) -> Response:
    """Render the correlation matrix (``/api/stats/correlation``'s ``r``) as
    a publication heatmap — the same matrix ``CorrelationMatrix.tsx`` colors
    on screen."""
    _check_fmt(req.fmt)
    try:
        from quantized.calc.figure_multivar import render_correlation_heatmap_figure  # lazy

        img = render_correlation_heatmap_figure(
            req.labels, req.r, title=req.title, fmt=req.fmt, style=req.style,
            dpi=_clamp_dpi(req.dpi), width_in=req.width_in, height_in=req.height_in,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img, media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class SplomFigureRequest(BaseModel):
    labels: list[str]
    columns: list[list[float]]  # column-major, same shape as /api/stats/correlation
    title: str = ""
    fmt: str = "pdf"
    style: str = "default"
    dpi: int | None = None
    bins: str | int = "fd"
    width_in: float | None = None
    height_in: float | None = None
    filename: str = "splom"


@router.post("/splom-figure")
def export_splom_figure(req: SplomFigureRequest) -> Response:
    """Render a full n x n scatterplot matrix — same cell layout as the
    interactive SPLOM canvas (``splomRender.ts``): panel (row i, col j)
    plots column j on X against column i on Y, diagonal panels are a 1-D
    histogram."""
    _check_fmt(req.fmt)
    try:
        from quantized.calc.figure_multivar import render_splom_figure  # lazy

        img = render_splom_figure(
            req.labels, req.columns, title=req.title, fmt=req.fmt, style=req.style,
            dpi=_clamp_dpi(req.dpi), bins=req.bins, width_in=req.width_in, height_in=req.height_in,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img, media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class PcaVectorWire(BaseModel):
    x: float
    y: float
    label: str


class PcaFigureRequest(BaseModel):
    mode: Literal["scores", "loadings", "biplot"]
    points: list[list[float]] | None = None
    vectors: list[PcaVectorWire] | None = None
    x_label: str = ""
    y_label: str = ""
    title: str = ""
    fmt: str = "pdf"
    style: str = "default"
    dpi: int | None = None
    width_in: float | None = None
    height_in: float | None = None
    filename: str = "pca"


@router.post("/pca-figure")
def export_pca_figure(req: PcaFigureRequest) -> Response:
    """Render a PCA scores / loadings / biplot panel — same single-panel
    layout (and biplot vector-rescale convention) as the interactive canvas
    (``pcaScoresRender.ts``)."""
    _check_fmt(req.fmt)
    try:
        from quantized.calc.figure_multivar import render_pca_figure  # lazy

        vectors: list[dict[str, Any]] | None = (
            [{"x": v.x, "y": v.y, "label": v.label} for v in req.vectors] if req.vectors else None
        )
        img = render_pca_figure(
            req.mode, points=req.points, vectors=vectors, x_label=req.x_label, y_label=req.y_label,
            title=req.title, fmt=req.fmt, style=req.style, dpi=_clamp_dpi(req.dpi),
            width_in=req.width_in, height_in=req.height_in,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img, media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class PcaScreeFigureRequest(BaseModel):
    explained: list[float]
    cumulative: list[float]
    title: str = ""
    fmt: str = "pdf"
    style: str = "default"
    dpi: int | None = None
    width_in: float | None = None
    height_in: float | None = None
    filename: str = "pca-scree"


@router.post("/pca-scree-figure")
def export_pca_scree_figure(req: PcaScreeFigureRequest) -> Response:
    """Render a PCA scree plot (percent-explained bars + cumulative curve) —
    the same two arrays ``PcaScree.tsx`` draws as DOM bars."""
    _check_fmt(req.fmt)
    try:
        from quantized.calc.figure_multivar import render_pca_scree_figure  # lazy

        img = render_pca_scree_figure(
            req.explained, req.cumulative, title=req.title, fmt=req.fmt, style=req.style,
            dpi=_clamp_dpi(req.dpi), width_in=req.width_in, height_in=req.height_in,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img, media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
