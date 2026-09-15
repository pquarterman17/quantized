"""Small wire models shared by ``routes.export_figures``'s ``FigureRequest``.

Split out purely to keep ``export_figures.py`` under the 500-line god-module
ceiling (P3.3 review, F2/F1 follow-up: threading ``greyscale`` into
``routes.export_page`` grew both that route's field docs and
``PagePanelSpec``'s -- see that module's own doc -- and left
``export_figures.py`` sitting at the ceiling with zero headroom). These three
classes are pure data shape with no route logic of their own: ``FigureFacet``/
``FigureFacetSeries`` are ``FigureRequest.facets``' element type, and
``TickFormatSpec`` is ``FigureRequest.x_fmt``/``y_fmt``/``y2_fmt``'s type --
none of the three is ever imported anywhere else in the codebase (only
``FigureRequest`` itself crosses the ``routes.export_page`` boundary), so this
split changes no call site outside ``export_figures.py``.

``_tick_fmt``, ``TickFormatSpec``'s one conversion into the plain mapping
``calc.figure_ticks`` expects, moved here with it (BUG-014, which added a
label-resolution sibling to ``export_figures.py`` and needed the room). ``routes.export_page``,
its other caller, imports it from here directly.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

__all__ = ["FigureFacet", "FigureFacetSeries", "TickFormatSpec"]


class FigureFacetSeries(BaseModel):
    label: str
    y: list[float | None]


class FigureFacet(BaseModel):
    """One xy small-multiples panel (FIGURE_AUTHORING_WORKFLOW_PLAN F4.4 —
    the export half of Stage's facet-by-column grid, `store.facetKey` /
    `lib/facet.facetPayloads`). RESOLVED, not re-derived: the frontend
    already computed each panel's row slice (level ordering + binning,
    `lib/figureSpec.ts`'s `buildFacetSpecs`) and ships it here verbatim, so
    this route never re-slices `dataset` itself and can never disagree with
    what Stage showed on screen. Mirrors `StatplotFacet`/`CategoricalFacet`'s
    established "resolved facet panel" shape (`routes/export_statplots.py`).
    `x`/each series' `y` may carry `null` for a non-finite cell (the
    frontend's null-gap wire convention, same as every DataStruct value);
    `calc.figure_facets` treats it as NaN via `np.asarray(..., dtype=float)`,
    matplotlib's own gap convention."""

    label: str
    x: list[float | None]
    series: list[FigureFacetSeries]


class TickFormatSpec(BaseModel):
    """Wire model for the screen's `AxisFormat` (MAIN #24,
    `frontend/src/lib/types.ts`): the tick-label number format for one axis.
    `"auto"` (the default) leaves matplotlib's own formatter untouched --
    see `calc.figure_ticks.axis_tick_formatter`."""

    mode: Literal["auto", "fixed", "sci", "eng", "date", "time", "datetime"] = "auto"
    digits: float = 2


def _tick_fmt(spec: TickFormatSpec | None) -> dict[str, Any] | None:
    """``TickFormatSpec`` (route-layer pydantic) -> the plain mapping
    ``calc.figure_ticks.axis_tick_formatter`` expects (calc/ never imports
    pydantic — see the layering guard)."""
    return spec.model_dump() if spec is not None else None
