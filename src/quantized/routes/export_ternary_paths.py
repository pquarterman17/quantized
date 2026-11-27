"""Ternary line and vector figure export (plan item 25).

``POST /api/export/ternary-paths-figure`` wraps ``calc.figure_ternary_paths``:
``kind="line"`` draws each ``series`` as a line through its compositions in row
order (a row with a null cell is a gap the line does not cross);
``kind="vector"`` draws an arrow from each ``start`` row to its ``end`` row.
A separate route from ``/ternary-figure`` because the bodies differ (nullable
cells, several series, two composition arrays); the triangle frame is shared.
No drawing logic here.
"""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc.figure_warnings import collect_figure_warnings
from quantized.calc.ternary_paths import MAX_SERIES
from quantized.heavy_import import heavy_imports
from quantized.routes._errors import call_calc
from quantized.routes._export_common import (
    _DPI_MAX,
    _DPI_MIN,
    _FIGURE_MIME,
    _attachment,
    _safe_name,
)

router = APIRouter(prefix="/api/export", tags=["export"])

_MAX_ROWS = 1_000_000

Rows = list[list[float | None]]


class TernaryPathSeries(BaseModel):
    name: str = ""
    rows: Rows  # (n, 3); a null cell makes the row a gap


class TernaryPathsRequest(BaseModel):
    kind: Literal["line", "vector"]
    labels: tuple[str, str, str] = ("A", "B", "C")
    series: list[TernaryPathSeries] = []  # line
    start: Rows | None = None  # vector: (n, 3)
    end: Rows | None = None  # vector: (n, 3)
    values: list[float | None] | None = None  # vector: colour by (length n)
    z_label: str = "Value"
    cmap: str = "viridis"
    color: str | None = None
    width: float = Field(default=1.5, gt=0, le=20)
    dash: Literal["solid", "dashed", "dotted", "dashdot"] = "solid"
    markers: bool = False
    marker_size: float = Field(default=6.0, gt=0, le=50)
    legend: bool = True
    head_size: float = Field(default=1.0, ge=0.2, le=5)
    head_style: Literal["filled", "open"] = "filled"
    fmt: str = "pdf"
    style: str = "default"
    dpi: int | None = None
    title: str = ""
    filename: str = "ternary"


@router.post("/ternary-paths-figure")
def export_ternary_paths_figure(req: TernaryPathsRequest) -> Response:
    """Render a ternary line or vector plot to PDF/SVG/PNG/TIFF; compositions
    the scatter refuses (negative, all-zero) are a 422."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}")
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi)) if req.dpi is not None else None
    with collect_figure_warnings() as notes:
        if req.kind == "line":
            img = _line(req, dpi)
        else:
            img = _vector(req, dpi)
    headers = _attachment(_safe_name(req.filename, f".{req.fmt}"))
    if notes:
        headers["X-Figure-Warnings"] = json.dumps(notes)
    return Response(content=img, media_type=_FIGURE_MIME[req.fmt], headers=headers)


def _line(req: TernaryPathsRequest, dpi: int | None) -> bytes:
    if req.start is not None or req.end is not None or req.values is not None:
        raise HTTPException(
            status_code=422,
            detail="a line plot takes `series`, not start/end/values",
        )
    if len(req.series) > MAX_SERIES:
        raise HTTPException(status_code=422, detail=f"at most {MAX_SERIES} series")
    if sum(len(s.rows) for s in req.series) > _MAX_ROWS:
        raise HTTPException(status_code=422, detail="too many rows")
    with heavy_imports("quantized.calc.figure_ternary_paths"):
        from quantized.calc.figure_ternary_paths import (
            render_ternary_line_figure,  # lazy: matplotlib
        )

    return call_calc(render_ternary_line_figure,
        [(s.name, s.rows) for s in req.series], labels=req.labels, color=req.color,
        width=req.width, dash=req.dash, markers=req.markers, marker_size=req.marker_size,
        legend=req.legend, fmt=req.fmt, style=req.style, dpi=dpi, title=req.title,
    )


def _vector(req: TernaryPathsRequest, dpi: int | None) -> bytes:
    if req.series:
        raise HTTPException(status_code=422, detail="a vector plot takes start/end, not `series`")
    if req.start is None or req.end is None:
        raise HTTPException(status_code=422, detail="a vector plot needs `start` and `end`")
    if len(req.start) > _MAX_ROWS:
        raise HTTPException(status_code=422, detail="too many rows")
    values = None
    if req.values is not None:
        if any(v is None for v in req.values):
            raise HTTPException(status_code=422, detail="`values` must not contain nulls")
        values = [float(v) for v in req.values if v is not None]
    with heavy_imports("quantized.calc.figure_ternary_paths"):
        from quantized.calc.figure_ternary_paths import (
            render_ternary_vector_figure,  # lazy: matplotlib
        )

    return call_calc(render_ternary_vector_figure,
        req.start, req.end, labels=req.labels, values=values, z_label=req.z_label,
        cmap=req.cmap, color=req.color, width=req.width, head_size=req.head_size,
        head_style=req.head_style, fmt=req.fmt, style=req.style, dpi=dpi, title=req.title,
    )
