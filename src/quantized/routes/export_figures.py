"""Figure export routes: render dataset/statplot/map/ternary/field visualizations.

Wraps ``calc.figure`` (basic plots), ``calc.figure_statplots`` (box/violin/
Q-Q/histogram), ``calc.figure_map`` (gridded 2-D heatmap/contour/surface),
``calc.figure_corner`` (posterior/bootstrap pairs plots), ``calc.figure_ternary``
(3-component compositions), and ``calc.figure_field`` (quiver/streamline vector
fields). Output formats: PDF/SVG/PNG/TIFF. No formatting logic here — renderers
own it. Filenames are sanitized before reaching the Content-Disposition header.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.datastruct import DataStruct
from quantized.routes._export_common import (
    _DPI_MAX,
    _DPI_MIN,
    _FIGURE_MIME,
    _attachment,
    _safe_name,
)

router = APIRouter(prefix="/api/export", tags=["export"])


class FigureRequest(BaseModel):
    dataset: dict[str, Any]
    x_key: int | str | None = None
    y_keys: list[int | str] | None = None
    x_log: bool = False
    y_log: bool = False
    fmt: str = "pdf"
    style: str = "default"  # publication preset: aps / report / web / …
    dpi: int = 200  # raster (png/tiff) resolution; ignored by vector formats
    title: str = ""  # optional figure title
    x_label: str | None = None  # override the auto-derived axis labels (None = derive)
    y_label: str | None = None
    # Per-series style (aligned to the plotted y_keys order): color/width/line/marker.
    series_styles: list[dict[str, Any] | None] | None = None
    # Property-panel overrides (gap #11): fonts / legend / ticks / spines /
    # limits / margins / grid / annotations — validated in calc.
    overrides: dict[str, Any] | None = None
    filename: str = "figure"


@router.post("/figure")
def export_figure(req: FigureRequest) -> Response:
    """Render the dataset (selected channels + log scales) to a publication
    figure: PDF / SVG (vector) or PNG / TIFF (raster, at ``dpi``)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    # Lazy import: matplotlib is heavy — only pay it when a figure is exported.
    from quantized.calc.figure import render_figure
    from quantized.calc.plotting import PlotState, build_series

    try:
        ds = DataStruct.from_dict(req.dataset)
        state = PlotState(
            x_key=req.x_key,
            y_keys=tuple(req.y_keys) if req.y_keys is not None else None,
            x_log=req.x_log,
            y_log=req.y_log,
        )
        plot = build_series(ds, state)
        # Caller-supplied labels override the auto-derived "label (unit)" strings.
        x_label = req.x_label
        if x_label is None:
            x_label = f"{plot.x_label} ({plot.x_unit})" if plot.x_unit else plot.x_label
        y_label = req.y_label
        if y_label is None:
            y_label = ""
            if len(plot.series) == 1:
                only = plot.series[0]
                y_label = f"{only.label} ({only.unit})" if only.unit else only.label
        series = [
            (f"{s.label} ({s.unit})" if s.unit else s.label, s.values) for s in plot.series
        ]
        data = render_figure(
            plot.x,
            series,
            title=req.title,
            x_label=x_label,
            y_label=y_label,
            x_log=req.x_log,
            y_log=req.y_log,
            fmt=req.fmt,
            style=req.style,
            series_styles=req.series_styles,
            dpi=dpi,
            overrides=req.overrides,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


@router.post("/figure-hitmap")
def export_figure_hitmap(req: FigureRequest) -> dict[str, Any]:
    """Preview render + element hit-map (gap #13): base64 PNG, per-artist
    pixel boxes (title/labels/legend/series/annotations), and the axes rect
    with data limits — the client hit-tests the preview and maps drags back
    to data coordinates. ``fmt`` is ignored (always PNG at ``dpi``)."""
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    from quantized.calc.figure import render_figure_map
    from quantized.calc.plotting import PlotState, build_series

    try:
        ds = DataStruct.from_dict(req.dataset)
        state = PlotState(
            x_key=req.x_key,
            y_keys=tuple(req.y_keys) if req.y_keys is not None else None,
            x_log=req.x_log,
            y_log=req.y_log,
        )
        plot = build_series(ds, state)
        x_label = req.x_label
        if x_label is None:
            x_label = f"{plot.x_label} ({plot.x_unit})" if plot.x_unit else plot.x_label
        y_label = req.y_label
        if y_label is None:
            y_label = ""
            if len(plot.series) == 1:
                only = plot.series[0]
                y_label = f"{only.label} ({only.unit})" if only.unit else only.label
        series = [
            (f"{s.label} ({s.unit})" if s.unit else s.label, s.values) for s in plot.series
        ]
        return render_figure_map(
            plot.x,
            series,
            title=req.title,
            x_label=x_label,
            y_label=y_label,
            x_log=req.x_log,
            y_log=req.y_log,
            style=req.style,
            series_styles=req.series_styles,
            dpi=dpi,
            overrides=req.overrides,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class StatplotFigureRequest(BaseModel):
    kind: str  # box|violin|qq|probability|histogram
    data: list[list[float]] | list[float]  # groups (box/violin) or one sample
    labels: list[str] | None = None
    fmt: str = "pdf"
    style: str = "default"
    dist: str = "norm"
    bins: str | int = "fd"
    fit: str | None = None
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    dpi: int = 200
    filename: str = "statplot"


@router.post("/statplot-figure")
def export_statplot_figure(req: StatplotFigureRequest) -> Response:
    """Render a statistical plot (box/violin/Q-Q/histogram) to a publication
    figure (PDF/SVG/PNG/TIFF)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    from quantized.calc.figure_statplots import render_statplot_figure  # lazy: matplotlib

    try:
        data: Any = req.data
        data = [list(g) for g in data] if req.kind in ("box", "violin") else list(data)
        img = render_statplot_figure(
            req.kind, data, labels=req.labels, fmt=req.fmt, style=req.style,
            dist=req.dist, bins=req.bins, fit=req.fit,
            title=req.title, x_label=req.x_label, y_label=req.y_label, dpi=dpi,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class CategoricalFigureRequest(BaseModel):
    groups: list[str]  # category tick labels, in axis order
    series: list[str]  # series (legend) labels, in stack/cluster order
    values: list[list[float]]  # [group][series] bar height (mean)
    errors: list[list[float | None]] | None = None  # [group][series] SEM
    stacked: bool = False
    fmt: str = "pdf"
    style: str = "default"
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    dpi: int = 200
    filename: str = "bar"


@router.post("/categorical-figure")
def export_categorical_figure(req: CategoricalFigureRequest) -> Response:
    """Render a grouped/stacked bar chart (gap #20) to a publication figure
    (PDF/SVG/PNG/TIFF) — the same category x series matrix (mean ± SEM) the
    interactive stat stage's "bar" mode draws on-screen."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    from quantized.calc.figure_categorical import render_categorical_figure  # lazy: matplotlib

    try:
        img = render_categorical_figure(
            req.groups, req.series, req.values, req.errors, stacked=req.stacked,
            fmt=req.fmt, style=req.style, title=req.title, x_label=req.x_label,
            y_label=req.y_label, dpi=dpi,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class MapFigureRequest(BaseModel):
    x_axis: list[float]
    y_axis: list[float]
    z_grid: list[list[float]]  # (ny, nx), NaN allowed for gaps
    kind: str = "contourf"  # contourf|contour|heatmap|surface|scatter3d|waterfall
    fmt: str = "pdf"
    style: str = "default"
    dpi: int = 200
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
    """Render a gridded 2-D map to a publication figure: filled/line contour,
    heatmap, or static 3-D surface/scatter/waterfall (PDF/SVG/PNG/TIFF)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    from quantized.calc.figure_map import render_map_figure  # lazy: matplotlib is heavy

    try:
        data = render_map_figure(
            req.x_axis, req.y_axis, req.z_grid,
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
