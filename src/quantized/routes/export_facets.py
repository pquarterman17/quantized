"""Faceted (small-multiples) figure export route (ORIGIN_GAP_PLAN #21).

Split into its own router file (rather than joining `routes/export_figures.py`)
purely to keep that file under the 500-line god-module ceiling — it was
already at 421 lines before this endpoint. Wraps `calc.figure_facets`.
"""

from __future__ import annotations

from typing import Any

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


class FacetSeries(BaseModel):
    label: str
    y: list[float]


class FacetPanel(BaseModel):
    label: str
    x: list[float]
    series: list[FacetSeries]


class FacetsFigureRequest(BaseModel):
    panels: list[FacetPanel]  # one per facet-column level (frontend lib/facet.facetPayloads)
    x_log: bool = False
    y_log: bool = False
    fmt: str = "pdf"
    style: str = "default"
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    dpi: int = 200
    width_in: float | None = None
    height_in: float | None = None
    filename: str = "facets"


@router.post("/facets-figure")
def export_facets_figure(req: FacetsFigureRequest) -> Response:
    """Render a small-multiples (faceted) figure (gap #21): one panel per
    facet-column level, sharing scales, tiled into a grid (PDF/SVG/PNG/TIFF)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    from quantized.calc.figure_facets import render_facets_figure  # lazy: matplotlib is heavy

    try:
        panels: list[dict[str, Any]] = [
            {
                "label": p.label,
                "x": p.x,
                "series": [{"label": s.label, "y": s.y} for s in p.series],
            }
            for p in req.panels
        ]
        img = render_facets_figure(
            panels, x_log=req.x_log, y_log=req.y_log, fmt=req.fmt, style=req.style,
            title=req.title, x_label=req.x_label, y_label=req.y_label, dpi=dpi,
            width_in=req.width_in, height_in=req.height_in,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
