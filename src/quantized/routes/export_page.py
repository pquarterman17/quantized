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
from quantized.routes.export_figures import FigureRequest, _figure_series, _tick_fmt

router = APIRouter(prefix="/api/export", tags=["export"])


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
    from quantized.calc.figure_page import PagePanel, render_figure_page

    try:
        panels = []
        for spec in req.panels:
            f = spec.figure
            x, series, x_label, y_label, styles = _figure_series(f)
            panels.append(
                PagePanel(
                    x=x,
                    series=series,
                    row=spec.row,
                    col=spec.col,
                    row_span=spec.row_span,
                    col_span=spec.col_span,
                    title=spec.title if spec.title is not None else f.title,
                    x_label=x_label,
                    y_label=y_label,
                    x_log=f.x_log,
                    y_log=f.y_log,
                    x_scale=f.x_scale,
                    y_scale=f.y_scale,
                    x_fmt=_tick_fmt(f.x_fmt),
                    y_fmt=_tick_fmt(f.y_fmt),
                    x_step=f.x_step,
                    y_step=f.y_step,
                    series_styles=styles,
                    overrides=f.overrides,
                    label=spec.label,
                    page_rect=spec.page_rect,
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
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
