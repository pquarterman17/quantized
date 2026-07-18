"""Specialized figure export routes: map/corner/ternary/field.

Split into its own router file (rather than joining
``routes/export_figures.py``) purely to keep that file under the 500-line
god-module ceiling — it grew past 500 once the y2 (secondary-axis) fields
landed on ``FigureRequest`` (the same reason ``export_facets.py`` and
``export_page.py`` were split out earlier). These four routes are
self-contained: no shared helper with ``export_figures.py``'s
``_figure_series``/``_tick_fmt`` (they don't take a ``dataset`` + channel
picks, unlike the basic figure/statplot/categorical routes that stayed).

Wraps ``calc.figure_map`` (gridded 2-D heatmap/contour/surface),
``calc.figure_corner`` (posterior/bootstrap pairs plots), ``calc.figure_ternary``
(3-component compositions), and ``calc.figure_field`` (quiver/streamline vector
fields). Output formats: PDF/SVG/PNG/TIFF. No formatting logic here — renderers
own it. Filenames are sanitized before reaching the Content-Disposition header.
"""

from __future__ import annotations

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


class MapFigureRequest(BaseModel):
    x_axis: list[float]
    y_axis: list[float]
    # (ny, nx), NaN allowed for gaps -- required when contour_source="grid".
    z_grid: list[list[float]] | None = None
    # Scattered per-point z, same length as x_axis/y_axis -- required when
    # contour_source="points" (gap #17 tri-contour: the RSM cloud shape,
    # never regridded).
    z_values: list[float] | None = None
    contour_source: str = "grid"  # grid (z_grid) | points (x_axis/y_axis/z_values cloud)
    kind: str = "contourf"  # contourf|contour|heatmap|surface|scatter3d|waterfall
    fmt: str = "pdf"
    style: str = "default"
    # None (default) resolves to the style preset's calibrated dpi, matching
    # calc.figure's resolved_dpi convention (see corner/ternary/field siblings).
    dpi: int | None = None
    cmap: str = "viridis"
    levels: int | list[float] = 12
    level_scale: str = "linear"  # linear|log
    label_contours: bool = True
    colorbar: bool = True
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    z_label: str = ""
    width_in: float | None = None
    height_in: float | None = None
    view_elev: float = 30.0
    view_azim: float = -60.0
    filename: str = "map"


@router.post("/map-figure")
def export_map_figure(req: MapFigureRequest) -> Response:
    """Render a 2-D map to a publication figure: filled/line contour, heatmap,
    or static 3-D surface/scatter/waterfall (PDF/SVG/PNG/TIFF) — from either a
    regridded ``z_grid`` (``contour_source="grid"``, default) or a raw
    scattered ``(x_axis, y_axis, z_values)`` point cloud contoured straight
    off a Delaunay triangulation, no regridding (``contour_source="points"``,
    ``kind`` restricted to ``contour``/``contourf``)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi)) if req.dpi is not None else None
    from quantized.calc.figure_map import render_map_figure  # lazy: matplotlib is heavy

    try:
        data = render_map_figure(
            req.x_axis, req.y_axis, req.z_grid,
            contour_source=req.contour_source, z_values=req.z_values,
            kind=req.kind, fmt=req.fmt, style=req.style, dpi=dpi, cmap=req.cmap,
            levels=req.levels, level_scale=req.level_scale,
            label_contours=req.label_contours, colorbar=req.colorbar,
            title=req.title, x_label=req.x_label, y_label=req.y_label, z_label=req.z_label,
            width_in=req.width_in, height_in=req.height_in,
            view_elev=req.view_elev, view_azim=req.view_azim,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class CornerFigureRequest(BaseModel):
    samples: list[list[float]]  # (n_samples, n_params) joint parameter draws
    param_names: list[str]
    truths: list[float] | None = None  # reference value per parameter (e.g. the fit)
    fmt: str = "pdf"
    style: str = "default"
    # None (default) resolves to the style preset's calibrated dpi, matching
    # calc.figure's resolved_dpi convention — unlike its statplot/map
    # siblings above, which always pass an explicit dpi (a documented,
    # separately-tracked gap; GAP_TIER3_PLAN open question 2 follow-ups).
    dpi: int | None = None
    bins: str | int = "fd"
    title: str = ""
    width_in: float | None = None
    height_in: float | None = None
    filename: str = "corner"


@router.post("/corner-figure")
def export_corner_figure(req: CornerFigureRequest) -> Response:
    """Render a pairwise posterior/bootstrap corner (pairs) plot from posted
    joint parameter samples — e.g. ``/api/fitting/posterior``'s ``samples``
    or ``/api/fitting/bootstrap``'s ``boot_samples``
    (``return_samples: true``). Stateless: the client posts samples it
    already has; no fit is re-run server-side."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi)) if req.dpi is not None else None
    from quantized.calc.figure_corner import render_corner_figure  # lazy: matplotlib is heavy

    try:
        img = render_corner_figure(
            req.samples, req.param_names, truths=req.truths,
            title=req.title, fmt=req.fmt, style=req.style, dpi=dpi, bins=req.bins,
            width_in=req.width_in, height_in=req.height_in,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class TernaryFigureRequest(BaseModel):
    data: list[list[float]]  # (n, 3) composition array
    labels: tuple[str, str, str] = ("A", "B", "C")  # corner labels
    values: list[float] | None = None  # optional color values (length n)
    fmt: str = "pdf"
    style: str = "default"
    dpi: int | None = None
    marker_size: float | None = None
    title: str = ""
    filename: str = "ternary"


@router.post("/ternary-figure")
def export_ternary_figure(req: TernaryFigureRequest) -> Response:
    """Render a ternary diagram (3-component composition scatter plot) to a
    publication figure (PDF/SVG/PNG/TIFF). Points are normalized so each row
    sums to 1; non-positive components raise 422 error."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi)) if req.dpi is not None else None
    from quantized.calc.figure_ternary import render_ternary_figure  # lazy: matplotlib

    try:
        img = render_ternary_figure(
            req.data, labels=req.labels, values=req.values,
            fmt=req.fmt, style=req.style, dpi=dpi, marker_size=req.marker_size,
            title=req.title,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class FieldFigureRequest(BaseModel):
    x_axis: list[float]  # 1-D coordinate array
    y_axis: list[float]  # 1-D coordinate array
    u_grid: list[list[float]]  # (ny, nx) component grid
    v_grid: list[list[float]]  # (ny, nx) component grid
    kind: str = "quiver"  # quiver|streamline
    fmt: str = "pdf"
    style: str = "default"
    dpi: int | None = None
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    filename: str = "field"


@router.post("/field-figure")
def export_field_figure(req: FieldFigureRequest) -> Response:
    """Render a vector field plot (quiver arrows or streamlines) to a
    publication figure (PDF/SVG/PNG/TIFF). u_grid and v_grid must have shape
    (len(y_axis), len(x_axis))."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi)) if req.dpi is not None else None
    from quantized.calc.figure_field import render_field_figure  # lazy: matplotlib

    try:
        img = render_field_figure(
            req.x_axis, req.y_axis, req.u_grid, req.v_grid,
            kind=req.kind, fmt=req.fmt, style=req.style, dpi=dpi,
            title=req.title, x_label=req.x_label, y_label=req.y_label,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
