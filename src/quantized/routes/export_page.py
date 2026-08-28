"""Figure-page export route (GOTO #4): N different plots -> ONE exported page.

Thin adapter over ``calc.figure_page``: validates the page spec (grid +
per-panel figure payloads -- each panel embeds the SAME payload shape
``POST /api/export/figure`` takes), resolves every panel's dataset/channels
through the shared ``_figure_series`` helper, and hands plain dataclasses to
the pure composer. Vector formats (PDF/SVG) are the default export
convention; PNG/TIFF raster at a clamped DPI (the low-DPI PNG render is also
the composer UI's preview image). All layout/label validation lives in calc
-- a ``ValueError`` maps to 422 here, never a 500. Split into its own router
file (rather than joining ``routes/export_figures.py``) to respect the
500-line module ceiling.
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
from quantized.routes.export_figures import (
    FigureRequest,
    _facet_panels,
    _figure_series,
    _tick_fmt,
)

router = APIRouter(prefix="/api/export", tags=["export"])

# V5 (fix round 2, F4.4 follow-up): the ONLY override keys the facet
# sub-grid renderer actually consumes -- calc.figure_facets.draw_facet_grid
# applies x_lim/grid/spines per sub-panel (apply_axis_shape_overrides,
# lim_keys=("x_lim",)) and nothing else (no y_lim, legend, annotations, ref
# lines, region shades, or margins -- see calc.figure_facets.
# render_facets_figure's own `overrides` doc). Routing the FULL nested-
# figure overrides dict onto PagePanel.overrides would send a facet panel
# through _validate_panel_overrides, which rejects x_breaks/margins as
# page-incompatible -- correct for an ORDINARY panel (whose overrides truly
# apply to a single Axes this composer owns), but wrong for a facet panel:
# pre-diff, a facet export's overrides went through the standalone path's
# generic _validate_overrides only, which accepts-and-silently-ignores any
# key the facet renderer doesn't consume. A well-formed margins/x_breaks
# override on a facet panel must still 200 (silently unused), matching that
# pre-existing contract -- only genuinely malformed shapes still 422 (the
# full dict is still shape-checked below via _validate_overrides).
_FACET_OVERRIDE_KEYS = ("x_lim", "grid", "spines")


class PagePanelSpec(BaseModel):
    """One panel: a single-figure export payload plus its grid placement.
    The nested figure's own ``fmt`` / ``style`` / ``dpi`` / ``filename`` are
    ignored -- those are page-level decisions."""

    figure: FigureRequest
    row: int
    col: int
    row_span: int = 1
    col_span: int = 1
    # None = auto label from row-major placement order ("(a)", "(b)", ...);
    # "" = no label on this panel only.
    label: str | None = None
    # Per-panel title override; None = the nested figure payload's own title.
    title: str | None = None
    # #54 residual: page-normalized (x, y, w, h), TOP-LEFT origin -- when
    # EVERY panel on the page sets this, the composer places panels at their
    # true page coordinates instead of row/col (see calc.figure_page). None
    # (the default) keeps the grid path byte-identical; row/col are then
    # still required by this schema but unused.
    page_rect: tuple[float, float, float, float] | None = None


class FigurePageRequest(BaseModel):
    rows: int
    cols: int
    panels: list[PagePanelSpec]
    fmt: str = "pdf"  # vector by default (the architecture's export preference)
    style: str = "default"  # publication preset, applied page-wide
    dpi: int | None = None  # None = the preset's calibrated dpi
    # Page size overrides (inches). None = the preset's journal-column width
    # (aps ~3.39 in single / aps_double ~7.0 in double column), with height
    # keeping each grid cell at the preset's own aspect ratio.
    width_in: float | None = None
    height_in: float | None = None
    label_format: str = "(a)"  # (a) | a) | a. | (A) | A) | A. | none
    label_pos: str = "nw"  # nw | ne | outside
    filename: str = "figure_page"
    # F3.5 layout controls (calc.figure_page_layout) -- all default to
    # today's exact rendering (byte-identical when omitted).
    row_gap: float | None = None
    col_gap: float | None = None
    link_x: bool = False
    link_y: bool = False
    align_labels: bool = False
    resize_mode: str = "constrained"  # constrained | tight | none


@router.post("/figure-page")
def export_figure_page(req: FigurePageRequest) -> Response:
    """Compose the panels onto one page (rows x cols grid, optional spans,
    journal panel labels) and render server-side: PDF / SVG (vector) or
    PNG / TIFF (raster at ``dpi``) -- the multi-panel "Figure 1(a)-(d)"
    workflow with zero external post-processing."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi)) if req.dpi is not None else None
    # Lazy import: matplotlib is heavy — only pay it when a page is exported.
    from quantized.calc.figure_overrides import _validate_overrides
    from quantized.calc.figure_page import PagePanel, render_figure_page

    try:
        panels = []
        for spec in req.panels:
            f = spec.figure
            panel_title = spec.title if spec.title is not None else f.title
            if f.facets:
                # F4.4 follow-up (2026-08-24): a faceted panel renders as a
                # REAL VECTOR sub-grid inside its page cell (calc.figure_
                # page_facets.draw_facet_panel_cell) instead of a pre-
                # rendered raster embed -- reshape via the SAME helper
                # `/figure`'s facet branch uses (`_facet_panels`) so this
                # route can never drift on how a facet panel's wire payload
                # turns into panel dicts. `_figure_series` still resolves
                # just the axis labels (C4 -- "explicit override, else
                # derive from the dataset"); `resolved.x`/`resolved.series`
                # are discarded, matching the standalone facet branch.
                resolved = _figure_series(f)
                # V5 (fix round 2): shape-validate the FULL overrides dict
                # (a malformed x_lim/legend/etc still 422s) but forward only
                # the narrow subset the facet renderer actually consumes --
                # see _FACET_OVERRIDE_KEYS' own doc for why the full dict
                # can't go straight onto PagePanel.overrides here.
                full_ov = dict(f.overrides or {})
                _validate_overrides(full_ov)
                facet_ov = {k: full_ov[k] for k in _FACET_OVERRIDE_KEYS if k in full_ov}
                panels.append(
                    PagePanel(
                        x=[], series=(),  # unused -- the facet sub-grid draws p.facets instead
                        row=spec.row, col=spec.col,
                        row_span=spec.row_span, col_span=spec.col_span,
                        title=panel_title,
                        x_label=resolved.x_label,
                        y_label=resolved.y_label,
                        x_log=f.x_log, y_log=f.y_log,
                        x_scale=f.x_scale, y_scale=f.y_scale,
                        x_fmt=_tick_fmt(f.x_fmt), y_fmt=_tick_fmt(f.y_fmt),
                        overrides=facet_ov,
                        label=spec.label, page_rect=spec.page_rect,
                        facets=_facet_panels(f),
                    )
                )
                continue
            resolved = _figure_series(f)
            panels.append(
                PagePanel(
                    x=resolved.x,
                    series=resolved.series,
                    row=spec.row,
                    col=spec.col,
                    row_span=spec.row_span,
                    col_span=spec.col_span,
                    title=panel_title,
                    x_label=resolved.x_label,
                    y_label=resolved.y_label,
                    x_log=f.x_log,
                    y_log=f.y_log,
                    x_scale=f.x_scale,
                    y_scale=f.y_scale,
                    x_fmt=_tick_fmt(f.x_fmt),
                    y_fmt=_tick_fmt(f.y_fmt),
                    x_step=f.x_step,
                    y_step=f.y_step,
                    series_styles=resolved.styles,
                    overrides=f.overrides,
                    label=spec.label,
                    page_rect=spec.page_rect,
                    # GUI_INTERACTION #12 slice 4c: a page panel with a
                    # secondary axis (`y2_keys`) now threads through to a
                    # real `Axes.twinx()` (calc.figure_page._draw_panel),
                    # the same as the single-figure `/figure` route already
                    # does -- see calc.figure_y2's module doc. None/all-False
                    # `y2_mask` (the vast majority of panels) is today's
                    # single-axis behaviour, byte-identical.
                    y2_mask=resolved.y2_mask,
                    y2_label=resolved.y2_label,
                    y2_scale=f.y2_scale,
                    y2_fmt=_tick_fmt(f.y2_fmt),
                    y2_step=f.y2_step,
                )
            )
        data = render_figure_page(
            panels,
            rows=req.rows,
            cols=req.cols,
            fmt=req.fmt,
            style=req.style,
            width_in=req.width_in,
            height_in=req.height_in,
            dpi=dpi,
            label_format=req.label_format,
            label_pos=req.label_pos,
            row_gap=req.row_gap,
            col_gap=req.col_gap,
            link_x=req.link_x,
            link_y=req.link_y,
            align_labels=req.align_labels,
            resize_mode=req.resize_mode,
        )
    except (ValueError, ArithmeticError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
