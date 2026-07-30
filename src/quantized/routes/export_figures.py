"""Figure export routes: render a dataset's channels to a publication figure.

Wraps ``calc.figure`` (basic plots, incl. the y2/secondary-axis twinx split —
see ``calc.figure_y2``). Two sets of siblings were split out to stay under
the 500-line god-module ceiling, both along the ``_figure_series`` seam —
a route belongs here only if it takes a ``dataset`` + channel picks:

* ``routes.export_figures_aux`` — map/corner/ternary/field;
* ``routes.export_statplots`` — statplot (box/violin/Q-Q/histogram) and the
  categorical bar chart, i.e. the StatStage export half, which takes
  pre-aggregated arrays instead.

Output formats: PDF/SVG/PNG/TIFF. No formatting logic here — renderers own
it. Filenames are sanitized before reaching the Content-Disposition header.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

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


class TickFormatSpec(BaseModel):
    """Wire model for the screen's `AxisFormat` (MAIN #24,
    `frontend/src/lib/types.ts`): the tick-label number format for one axis.
    `"auto"` (the default) leaves matplotlib's own formatter untouched --
    see `calc.figure_ticks.axis_tick_formatter`."""

    mode: Literal["auto", "fixed", "sci", "eng", "date", "time", "datetime"] = "auto"
    digits: float = 2


class FigureRequest(BaseModel):
    dataset: dict[str, Any]
    x_key: int | str | None = None
    y_keys: list[int | str] | None = None
    x_log: bool = False
    y_log: bool = False
    # MAIN #12 (Arrhenius reciprocal axis): "linear"/"log"/"reciprocal", the
    # scale source of truth when set; x_log/y_log are the back-compat
    # fallback for an older caller (see calc.figure_scale.resolve_axis_scale).
    x_scale: str | None = None
    y_scale: str | None = None
    # MAIN #24: tick-label number format, mirroring the screen's xFmt/yFmt
    # (a screen y2 axis maps to this request's OWN `y2_fmt` field below, not
    # `y_fmt`). None = auto (omit to keep requests lean).
    x_fmt: TickFormatSpec | None = None
    y_fmt: TickFormatSpec | None = None
    x_step: float | None = None
    y_step: float | None = None
    # Secondary (right) Y axis, matplotlib twinx (MAIN y2-export-parity):
    # `y2_keys` is a SUBSET of `y_keys` (every entry must also be in
    # `y_keys`, else 422 -- see `calc.plotting.validate_y2_subset`) naming
    # which of the plotted channels draw against the secondary axis; the
    # rest stay on the primary axis. None/empty = today's single-axis
    # behaviour, byte-identical. `y2_label` mirrors `y_label` (None = auto-
    # derive "label (unit)" when there's exactly one y2 series); `y2_scale`/
    # `y2_fmt`/`y2_step` mirror their primary-axis counterparts but apply
    # only to the secondary axis. A fixed secondary range rides
    # `overrides["y2_lim"]` (the same [lo, hi] shape as `x_lim`/`y_lim`).
    y2_keys: list[int | str] | None = None
    y2_label: str | None = None
    y2_scale: str | None = None
    y2_fmt: TickFormatSpec | None = None
    y2_step: float | None = None
    # GUI_INTERACTION #12 Slice 5: an optional categorical column that
    # splits every `y_keys` channel into one series per (channel, group
    # level) instead of one series per channel -- the Graph Builder "group"
    # zone's colour split (`lib/plotspec.ts`'s `buildXY`), now representable
    # on the export wire (`calc.plotting.build_grouped_series`). None
    # (default) = today's behaviour, byte-identical. Every synthetic series
    # lands on the PRIMARY axis (`buildXY` never assigns `axis: 1` to a
    # grouped series), so combining `group_col` with `y2_keys` is rejected
    # (422) rather than inventing a secondary-axis semantic for it -- see
    # `_figure_series`. `series_styles` is not applied in this path either
    # (it's 1:1-with-`y_keys`, which doesn't align with the synthetic
    # per-level series) -- matplotlib's default color cycle takes over,
    # exactly like the screen, which never assigns per-level colors either.
    group_col: int | None = None
    fmt: str = "pdf"
    style: str = "default"  # publication preset: aps / report / web / …
    dpi: int = 200  # raster (png/tiff) resolution; ignored by vector formats
    # MAIN_PLAN #35: transparent canvas instead of the preset background —
    # what "Copy figure" needs to paste cleanly onto a coloured slide.
    transparent: bool = False
    # MAIN_PLAN #36: per-series error spans, mirroring the frontend's
    # ErrorSpan — {x?: {plus, minus}, y?: {plus, minus}} with independent
    # magnitudes so an asymmetric pair survives to the exported figure.
    error_spans: list[dict[str, Any] | None] | None = None
    # #54 Stage 3: page size in inches (from the window's PageSetup) — overrides
    # the preset's figure size. None = the preset's own size (today's behaviour).
    width_in: float | None = None
    height_in: float | None = None
    title: str = ""  # optional figure title
    x_label: str | None = None  # override the auto-derived axis labels (None = derive)
    y_label: str | None = None
    # Per-series style (aligned to the plotted y_keys order): color/width/line/
    # marker, plus MAIN #13's `fill` ("under" or `{"vs": <channel>}`) and MAIN
    # #14's `color_by`/`colormap` (channel indices — resolved against `dataset`
    # by `calc.plotting.resolve_style_channels`, called from `_figure_series`).
    series_styles: list[dict[str, Any] | None] | None = None
    # Property-panel overrides (gap #11): fonts / legend / ticks / spines /
    # limits / margins / grid / annotations — validated in calc.
    overrides: dict[str, Any] | None = None
    filename: str = "figure"


@dataclass(frozen=True)
class _ResolvedFigure:
    """``_figure_series``'s resolved output, in DISPLAY (``y_keys``) order.
    ``y2_mask[i]`` is ``True`` when ``series[i]`` is one of ``req.y2_keys``
    (see ``calc.plotting.PlotState.y2_keys``) -- all-``False`` (the default,
    ``req.y2_keys`` absent) means "no secondary axis", the pre-y2 shape."""

    x: Any
    series: list[tuple[str, Any]]
    x_label: str
    y_label: str
    styles: list[dict[str, Any] | None] | None
    y2_mask: list[bool]
    y2_label: str


def _figure_series(req: FigureRequest) -> _ResolvedFigure:
    """Resolve a ``FigureRequest``'s dataset + channel picks into the
    renderer's inputs — shared by ``/figure``, ``/figure-hitmap``, and the
    figure-page route (``routes.export_page``). Caller-supplied labels
    override the auto-derived "label (unit)" strings (``y2_label`` derives
    the same way as ``y_label``, but from the y2 subset only). ``styles`` is
    ``req.series_styles`` resolved against ``ds``/the plotted channel order
    (MAIN #13/#14's ``fill``/``color_by`` channel references —
    ``calc.plotting.resolve_style_channels``) — the ONLY place this
    resolution happens, so every figure-export route gets it for free.
    Raises ``ValueError`` when ``req.y2_keys`` isn't a subset of
    ``req.y_keys`` (``calc.plotting.validate_y2_subset``, mapped to a 422 by
    every caller's existing ``except (ValueError, ...)`` handler).

    ``req.group_col`` (GUI_INTERACTION #12 Slice 5) switches to the grouped
    resolve path (``calc.plotting.build_grouped_series``): every ``y_keys``
    channel becomes one series per group level instead of one series per
    channel, matching the screen's ``buildXY`` colour split. Mutually
    exclusive with ``req.y2_keys`` (raises ``ValueError`` -- ``buildXY``
    never assigns a grouped series to the secondary axis, so there's no
    sound semantic to invent for the combination)."""
    from quantized.calc.plotting import (
        PlotState,
        build_grouped_series,
        build_series,
        resolve_style_channels,
        validate_y2_subset,
    )

    ds = DataStruct.from_dict(req.dataset)

    if req.group_col is not None:
        if req.y2_keys:
            raise ValueError(
                "group_col cannot be combined with y2_keys -- a group split "
                "puts every synthetic per-level series on the primary axis "
                "(buildXY never assigns axis: 1); move the secondary-axis "
                "series to the primary axis first"
            )
        y_keys = list(req.y_keys) if req.y_keys is not None else list(range(ds.n_channels))
        grouped = build_grouped_series(ds, req.x_key, y_keys, req.group_col)
        x_label = req.x_label
        if x_label is None:
            x_label = (
                f"{grouped.x_label} ({grouped.x_unit})" if grouped.x_unit else grouped.x_label
            )
        y_label = req.y_label
        if y_label is None:
            y_label = ""
        g_series: list[tuple[str, Any]] = [
            (f"{s.label} ({s.unit})" if s.unit else s.label, s.values) for s in grouped.series
        ]
        return _ResolvedFigure(
            grouped.x, g_series, x_label, y_label, None, [False] * len(g_series), ""
        )

    validate_y2_subset(req.y_keys, req.y2_keys)
    state = PlotState(
        x_key=req.x_key,
        y_keys=tuple(req.y_keys) if req.y_keys is not None else None,
        y2_keys=tuple(req.y2_keys) if req.y2_keys is not None else None,
        x_log=req.x_log,
        y_log=req.y_log,
    )
    plot = build_series(ds, state)
    x_label = req.x_label
    if x_label is None:
        x_label = f"{plot.x_label} ({plot.x_unit})" if plot.x_unit else plot.x_label
    primary_only = [s for s in plot.series if s.axis == 0]
    y2_only = [s for s in plot.series if s.axis == 1]
    y_label = req.y_label
    if y_label is None:
        y_label = ""
        if len(primary_only) == 1:
            only = primary_only[0]
            y_label = f"{only.label} ({only.unit})" if only.unit else only.label
    y2_label = req.y2_label
    if y2_label is None:
        y2_label = ""
        if len(y2_only) == 1:
            only = y2_only[0]
            y2_label = f"{only.label} ({only.unit})" if only.unit else only.label
    series: list[tuple[str, Any]] = [
        (f"{s.label} ({s.unit})" if s.unit else s.label, s.values) for s in plot.series
    ]
    styles = resolve_style_channels(ds, req.y_keys, req.series_styles)
    y2_mask = [s.axis == 1 for s in plot.series]
    return _ResolvedFigure(plot.x, series, x_label, y_label, styles, y2_mask, y2_label)


def _tick_fmt(spec: TickFormatSpec | None) -> dict[str, Any] | None:
    """``TickFormatSpec`` (route-layer pydantic) -> the plain mapping
    ``calc.figure_ticks.axis_tick_formatter`` expects (calc/ never imports
    pydantic — see the layering guard)."""
    return spec.model_dump() if spec is not None else None


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

    try:
        resolved = _figure_series(req)
        data = render_figure(
            resolved.x,
            resolved.series,
            title=req.title,
            x_label=resolved.x_label,
            y_label=resolved.y_label,
            x_log=req.x_log,
            y_log=req.y_log,
            x_scale=req.x_scale,
            y_scale=req.y_scale,
            fmt=req.fmt,
            style=req.style,
            series_styles=resolved.styles,
            error_spans=req.error_spans,
            width_in=req.width_in,
            height_in=req.height_in,
            dpi=dpi,
            transparent=req.transparent,
            overrides=req.overrides,
            x_fmt=_tick_fmt(req.x_fmt),
            y_fmt=_tick_fmt(req.y_fmt),
            x_step=req.x_step,
            y_step=req.y_step,
            y2_mask=resolved.y2_mask,
            y2_label=resolved.y2_label,
            y2_scale=req.y2_scale,
            y2_fmt=_tick_fmt(req.y2_fmt),
            y2_step=req.y2_step,
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

    try:
        resolved = _figure_series(req)
        return render_figure_map(
            resolved.x,
            resolved.series,
            title=req.title,
            x_label=resolved.x_label,
            y_label=resolved.y_label,
            x_log=req.x_log,
            y_log=req.y_log,
            x_scale=req.x_scale,
            y_scale=req.y_scale,
            style=req.style,
            series_styles=resolved.styles,
            dpi=dpi,
            overrides=req.overrides,
            x_fmt=_tick_fmt(req.x_fmt),
            y_fmt=_tick_fmt(req.y_fmt),
            x_step=req.x_step,
            y_step=req.y_step,
            y2_mask=resolved.y2_mask,
            y2_label=resolved.y2_label,
            y2_scale=req.y2_scale,
            y2_fmt=_tick_fmt(req.y2_fmt),
            y2_step=req.y2_step,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
