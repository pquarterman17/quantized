"""Facet (F4.4 small-multiples) helpers of the ``/figure`` export routes.

Split out of ``routes.export_figures`` (500-line god-module ceiling) along the
facet seam: the ONE reshape of ``FigureRequest.facets`` into the renderer's
panel dicts (shared with ``routes.export_page``'s faceted page panel) and the
two facet-branch renders ``export_figure``/``export_figure_hitmap`` dispatch
to. Thin-route rules unchanged: no rendering logic here -- the
``calc.figure_facets``/``calc.figure_facets_map`` renderers own it -- only
wire-model -> plain-dict reshaping and argument forwarding.

The caller passes the ``_figure_series``-resolved figure (``resolved``) in
rather than this module importing ``export_figures`` back (which would be an
import cycle); only its ``x_label``/``y_label`` are used, for the C4
"explicit override, else derive from the dataset" axis-label rule.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from quantized.heavy_import import heavy_imports
from quantized.routes.export_figures_schema import _ResolvedFigure, _tick_fmt

if TYPE_CHECKING:
    from quantized.routes.export_figures import FigureRequest

__all__ = ["_facet_panels", "_render_facets_bytes", "_render_facets_map"]


def _facet_panels(req: FigureRequest) -> list[dict[str, Any]]:
    """Reshape ``req.facets`` into ``calc.figure_facets``' panel-dict shape
    (``{"label": str, "x": [...], "series": [{"label": str, "y": [...]}]}``)
    -- the ONE reshape, shared by ``_render_facets_bytes`` (the standalone
    ``/figure``/``/figure-hitmap`` facet branches) and ``routes.export_page``
    (a faceted page panel -- F4.4 follow-up, a real vector sub-grid instead
    of the earlier pre-rendered raster embed), so the two routes can never
    drift on how a facet-bound panel's wire payload turns into the
    renderer's input. Kept in routes/ (not calc/) because it moves
    ``req.facets``' pydantic model instances into plain dicts -- exactly the
    route-layer job the calc/routes split reserves for routes/."""
    assert req.facets
    return [
        {
            "label": f.label,
            "x": f.x,
            "series": [{"label": s.label, "y": s.y} for s in f.series],
        }
        for f in req.facets
    ]


def _render_facets_bytes(
    req: FigureRequest, resolved: _ResolvedFigure, *, dpi: int, fmt: str | None = None,
) -> bytes:
    """Render ``req.facets`` to image bytes -- the standalone facet-branch
    renderer used by ``export_figure``/``export_figure_hitmap`` (R2, fix
    round 3). Axis labels come from ``resolved`` (C4 --
    ``resolved.x_label``/``resolved.y_label`` already apply the "explicit
    override, else derive from the dataset" rule), and scale/tick-
    format/transparent/overrides are forwarded the SAME way the flat branch
    does (C1/C3/R3). ``fmt`` overrides ``req.fmt`` when given -- a caller
    that needs a raster preview forces ``fmt="png"``. (``title``/``style``
    override params were dropped in fix round 3, W2 -- dead since
    ``routes.export_page`` stopped calling this function at all in fix round
    1, and neither remaining caller ever passed them.)"""
    with heavy_imports("quantized.calc.figure_facets"):
        from quantized.calc.figure_facets import render_facets_figure

    return render_facets_figure(
        _facet_panels(req),
        x_log=req.x_log,
        y_log=req.y_log,
        x_scale=req.x_scale,
        y_scale=req.y_scale,
        title=req.title,
        x_label=resolved.x_label,
        y_label=resolved.y_label,
        fmt=fmt or req.fmt,
        style=req.style,
        width_in=req.width_in,
        height_in=req.height_in,
        dpi=dpi,
        transparent=req.transparent,
        x_fmt=_tick_fmt(req.x_fmt),
        y_fmt=_tick_fmt(req.y_fmt),
        overrides=req.overrides,
    )


def _render_facets_map(
    req: FigureRequest, resolved: _ResolvedFigure, *, dpi: int,
) -> dict[str, Any]:
    """``/figure-hitmap``'s facet branch (FU-facet-hitmap): the SAME
    small-multiples grid ``/figure`` exports, rendered by
    ``calc.figure_facets_map.render_facets_figure_map`` with the same
    ``resolved``-derived labels as :func:`_render_facets_bytes`, returning the
    preview PNG plus per-panel geometry (see the route's own doc)."""
    with heavy_imports("quantized.calc.figure_facets_map"):
        from quantized.calc.figure_facets_map import render_facets_figure_map

    return render_facets_figure_map(
        _facet_panels(req),
        x_log=req.x_log,
        y_log=req.y_log,
        x_scale=req.x_scale,
        y_scale=req.y_scale,
        title=req.title,
        x_label=resolved.x_label,
        y_label=resolved.y_label,
        style=req.style,
        width_in=req.width_in,
        height_in=req.height_in,
        dpi=dpi,
        x_fmt=_tick_fmt(req.x_fmt),
        y_fmt=_tick_fmt(req.y_fmt),
        overrides=req.overrides,
    )
