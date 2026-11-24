"""``FigureRequest.polar``: the wire half of the polar publication export.

Before this field existed, "Export figure" / "Copy figure" from the Stage's
polar view posted an ordinary XY request and got a Cartesian figure back --
silent wrong output. With ``polar`` set, ``/api/export/figure`` (and every
caller of ``export_figures.render_figure_request``, i.e. the report exporter)
renders through ``calc.figure_polar`` instead.

The fields carry the canvas' geometry explicitly (``frontend/src/lib/
polar.ts``'s ``POLAR_CANVAS`` and ``polarRadialRange``): angle unit,
direction, zero location, radial range and rings. Defaults equal the canvas,
so a bare ``{"polar": {}}`` already draws what the screen draws.

Every XY-only field a polar figure cannot honour is REFUSED (422) rather than
dropped -- a drop is exactly the silent divergence this field exists to end.
``/figure-hitmap`` and a figure-page panel have no polar renderer, so they
refuse ``polar`` too (``refuse_polar``).

Split from ``export_figures.py`` (500-line ceiling); ``FigureRequest`` takes
the field through the ``PolarFields`` mixin, as it takes ``ExcludedRowsFields``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, Field

from quantized.calc.plotting import PlotState, build_series
from quantized.heavy_import import heavy_imports
from quantized.routes.export_figures_facets import _request_dataset
from quantized.routes.export_figures_labels import series_legends, series_names

if TYPE_CHECKING:
    from quantized.routes.export_figures import FigureRequest


class PolarMapSpec(BaseModel):
    """A polar HEATMAP / CONTOUR of I(chi, phi) (GAP_AUDIT_9 G2) in place of
    polar lines. Columns index ``[x, *channels]`` of the dataset (0 = the x /
    `time` column). Pole-figure projection default is equal-area (Schmidt):
    OWNER DECISION 2026-11-24 (D4); stereographic (Wulff) is the option."""

    chi_col: int = Field(ge=0, description="Tilt column (degrees, 0-90).")
    phi_col: int = Field(ge=0, description="Azimuth column (degrees).")
    z_col: int = Field(ge=0, description="Intensity column.")
    projection: Literal["equal_area", "stereographic"] = Field(default="equal_area")
    mode: Literal["heatmap", "contour", "both"] = Field(default="heatmap")
    cmap: Literal["viridis", "magma", "gray", "rdbu"] = Field(default="viridis")
    z_scale: Literal["linear", "log"] = Field(default="linear")
    z_lim: tuple[float, float] | None = Field(default=None)
    levels: int = Field(default=10, ge=2, le=200)
    n_r: int = Field(default=100, ge=8, le=400)
    n_phi: int = Field(default=360, ge=24, le=720)


class PolarFigureSpec(BaseModel):
    """The polar canvas' geometry. Defaults are the canvas' own."""

    theta_unit: Literal["deg", "rad"] = Field(
        default="deg", description="Unit of the angle column (the x channel, or `time`)."
    )
    theta_direction: Literal["ccw", "cw"] = Field(
        default="ccw", description="Direction the angle increases."
    )
    theta_zero: Literal["E", "N", "W", "S"] = Field(
        default="E", description="Where 0 sits on the circle."
    )
    r_lim: tuple[float, float] | None = Field(
        default=None,
        description=(
            "Radial range [centre, rim]; values outside are clamped, as on the canvas. "
            "None = the shared min/max of every plotted series ([0, 1] when degenerate)."
        ),
    )
    r_ticks: list[float] | None = Field(
        default=None, description="Radial grid rings; None = matplotlib's own."
    )
    grid: bool = Field(default=True, description="Draw the rings and spokes (the grid toggle).")
    polar_map: PolarMapSpec | None = Field(
        default=None,
        description="Draw a polar heatmap/contour (pole figure) instead of polar lines.",
    )


class PolarFields(BaseModel):
    polar: PolarFigureSpec | None = Field(
        default=None,
        description=(
            "Render a polar figure (x = angle, y = radius) instead of an XY plot. "
            "Only `/api/export/figure` renders it; XY-only fields are refused with it."
        ),
    )


def refuse_polar(req: FigureRequest) -> None:
    """A route with no polar renderer must refuse ``polar``, never draw XY."""
    if req.polar is not None:
        raise ValueError("polar figures export through /api/export/figure only")
    if req.plots2 is not None:  # the G15 plots (export_figures_plots2) likewise
        raise ValueError("these plot types export through /api/export/figure only")


def _xy_only_fields(req: FigureRequest) -> list[str]:
    set_fields = {
        "facets": req.facets,
        "group_col": req.group_col is not None,
        "encoding": req.encoding is not None and req.encoding.active(),
        "y2_keys": req.y2_keys,
        "y_axes": req.y_axes,
        "waterfall_offsets": req.waterfall_offsets,
        "waterfall_x_offsets": req.waterfall_x_offsets,
        "log_offsets": req.log_offsets,
        "error_spans": req.error_spans and any(s for s in req.error_spans),
        "excluded_rows": req.excluded_rows,
        "overrides": req.overrides,
        "x_log": req.x_log,
        "y_log": req.y_log,
        "x_scale": req.x_scale not in (None, "linear"),
        "y_scale": req.y_scale not in (None, "linear"),
        "x_fmt": req.x_fmt,
        "y_fmt": req.y_fmt,
        "x_step": req.x_step is not None,
        "y_step": req.y_step is not None,
    }
    return [name for name, value in set_fields.items() if value]


def render_polar_request(req: FigureRequest, *, fmt: str, dpi: int) -> bytes:
    """``render_figure_request``'s polar body. Angle = ``x_key`` (``time`` when
    absent, as on the canvas), radius = each ``y_keys`` channel. ``x_label``
    replaces the canvas caption; ``y_label`` titles the radial axis."""
    assert req.polar is not None
    refused = _xy_only_fields(req)
    if refused:
        raise ValueError(f"a polar figure cannot honour {', '.join(refused)}")
    ds = _request_dataset(req)
    if req.polar.polar_map is not None:
        return _render_polar_map(req, ds, fmt=fmt, dpi=dpi)
    plot = build_series(
        ds,
        PlotState(x_key=req.x_key, y_keys=tuple(req.y_keys) if req.y_keys is not None else None),
    )
    names = series_names(plot.series, series_legends(req.series_styles, len(plot.series)))
    with heavy_imports("quantized.calc.figure_polar"):
        from quantized.calc.figure_polar import render_polar_figure

    p = req.polar
    styles: list[dict[str, Any] | None] | None = req.series_styles
    return render_polar_figure(
        plot.x,
        [(name, s.values) for name, s in zip(names, plot.series, strict=True)],
        theta_unit=p.theta_unit,
        direction=p.theta_direction,
        zero=p.theta_zero,
        r_lim=p.r_lim,
        r_ticks=p.r_ticks,
        grid=p.grid,
        title=req.title,
        caption=req.x_label,
        r_label=req.y_label or "",
        fmt=fmt,
        style=req.style,
        series_styles=styles,
        width_in=req.width_in,
        height_in=req.height_in,
        dpi=dpi,
        transparent=req.transparent,
        greyscale=req.greyscale,
        svg_text_as_paths=req.svg_text_as_paths,
    )


def _column(ds: Any, k: int, what: str) -> Any:
    """Column ``k`` of ``[x, *channels]``; a clear 422 when it does not exist."""
    n = len(ds.labels)
    if k > n:
        raise ValueError(
            f"{what} column {k} does not exist: the dataset has {n + 1} columns (0..{n})"
        )
    return ds.time if k == 0 else ds.values[:, k - 1]


def _render_polar_map(req: FigureRequest, ds: Any, *, fmt: str, dpi: int) -> bytes:
    assert req.polar is not None and req.polar.polar_map is not None
    if req.series_styles:
        raise ValueError("a polar map has no series; series_styles is not honoured")
    m, p = req.polar.polar_map, req.polar
    with heavy_imports("quantized.calc.figure_polar_map"):
        from quantized.calc.figure_polar_map import render_polar_map_figure
    return render_polar_map_figure(
        _column(ds, m.chi_col, "chi"),
        _column(ds, m.phi_col, "phi"),
        _column(ds, m.z_col, "intensity"),
        projection=m.projection,
        mode=m.mode,
        cmap="gray" if req.greyscale else m.cmap,
        z_scale=m.z_scale,
        z_lim=m.z_lim,
        levels=m.levels,
        n_r=m.n_r,
        n_phi=m.n_phi,
        direction=p.theta_direction,
        zero=p.theta_zero,
        grid=p.grid,
        title=req.title,
        z_label=req.y_label or "",
        fmt=fmt,
        style=req.style,
        width_in=req.width_in,
        height_in=req.height_in,
        dpi=dpi,
        transparent=req.transparent,
        svg_text_as_paths=req.svg_text_as_paths,
    )
