"""The flat figure renderer's keyword arguments for a ``FigureRequest`` --
the ONE list ``/figure`` and ``/figure-hitmap`` share. Moved verbatim out of
``routes.export_figures`` for its 500-line ceiling (gap audit 4 G11 added the
Y3+ ``extra_y`` to it); ``req`` is typed ``Any`` there only to keep this
module free of an import cycle with the request model."""

from __future__ import annotations

from typing import Any

from quantized.routes import export_figures_multi_y as multi_y
from quantized.routes.export_figures_axis_titles import request_overrides
from quantized.routes.export_figures_schema import _ResolvedFigure, _tick_fmt, _x_tick_fmt

__all__ = ["flat_render_kwargs"]


def flat_render_kwargs(req: Any, resolved: _ResolvedFigure, dpi: int) -> dict[str, Any]:
    """The flat (non-facet, non-polar) renderer's keyword arguments for
    ``req`` -- the ONE list shared by the export (``render_figure_request``)
    and the publication preview (``/figure-hitmap``), so the preview renders
    exactly what Export writes. It used to be two hand-copied lists, and the
    preview's lacked ``error_spans``, ``width_in``/``height_in`` and
    ``transparent`` (publication-figures audit #4): a preview at the preset
    size with no error bars beside an export at the page size with them."""
    return dict(
        title=req.title,
        x_label=resolved.x_label,
        y_label=resolved.y_label,
        x_log=req.x_log,
        y_log=req.y_log,
        x_scale=req.x_scale,
        y_scale=req.y_scale,
        style=req.style,
        series_styles=resolved.styles,
        error_spans=resolved.error_spans,
        width_in=req.width_in,
        height_in=req.height_in,
        dpi=dpi,
        transparent=req.transparent,
        greyscale=req.greyscale,
        overrides=request_overrides(req),
        x_fmt=_x_tick_fmt(req.x_fmt, resolved),
        y_fmt=_tick_fmt(req.y_fmt),
        x_step=req.x_step,
        y_step=req.y_step,
        y2_mask=resolved.y2_mask,
        y2_label=resolved.y2_label,
        y2_scale=req.y2_scale,
        y2_fmt=_tick_fmt(req.y2_fmt),
        y2_step=req.y2_step,
        extra_y=multi_y.extra_y_kwargs(req, len(resolved.series)),
        svg_text_as_paths=req.svg_text_as_paths,
    )
