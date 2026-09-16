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

__all__ = [
    "SERIES_STYLES_DOC",
    "WATERFALL_OFFSETS_DOC",
    "FigureFacet",
    "FigureFacetSeries",
    "TickFormatSpec",
]

# ── FigureRequest field descriptions ────────────────────────────────────────
# Two of ``FigureRequest``'s fields are documented through ``Field(
# description=...)`` rather than a ``#`` comment, because a comment reaches no
# generated artefact: the OpenAPI entry (and so ``lib/api/schema.d.ts``) carried
# a bare "Series Styles"/"Waterfall Offsets" title and nothing else. That matters
# most for ``series_styles``, a loose ``dict[str, Any]`` whose KEYS -- BUG-014's
# ``legend`` among them -- can be described nowhere but the field's own
# description. (BUG-013 review round, NIT 6.) The strings live here for the same
# reason the models above do: ``export_figures.py``'s 500-line ceiling.

SERIES_STYLES_DOC = (
    "Per-series style, aligned to the plotted `y_keys` order. Keys: "
    "`color`/`width`/`line`/`marker`/`marker_size`; `marker_shape` (a "
    "`MarkerShape` name -> `calc.figure._plot_kwargs`'s `_MARKER` table, "
    'falling back to "o" -- before it existed all eight on-screen marker '
    "shapes exported as filled circles while the canvas drew them correctly); "
    '`fill` ("under" or `{"vs": <channel>}`, MAIN #13); `color_by`/`colormap` '
    "(channel indices, MAIN #14 -- resolved against `dataset` by "
    "`calc.plotting.resolve_style_channels`, called from `_figure_series`); "
    '`step` ("pre"/"post"/"mid", GAP_PLOTTYPES\' Graph Builder step mark -> '
    "matplotlib `drawstyle`); and `legend` (BUG-014), the user's legend rename "
    "for that series, rendered verbatim instead of having the channel's unit "
    "appended to it a second time. An entry is a loose dict (never a strict "
    "pydantic sub-model): a bad or unrecognized value in ANY key degrades "
    "gracefully -- dropped, or rendered with matplotlib's default -- rather "
    "than 422ing the whole export."
)

WATERFALL_OFFSETS_DOC = (
    "Per-plotted-series vertical offset in Y data units, aligned to `y_keys`: "
    "the stagger a waterfall view draws on screen, which used to reach no "
    "export path at all (the exported figure overlaid the curves the canvas "
    "had separated). RESOLVED client-side "
    "(`frontend/src/lib/waterfallOffset.ts`) rather than re-derived here, "
    "because the fraction the user sets is a share of the CANVAS y-range -- a "
    "range that includes hidden series and excluded rows this request never "
    "receives, and that a zoomed canvas measures over only the rows it "
    "fetched. `dataset` keeps the true, un-shifted values; None/absent renders "
    "exactly as it did before the field existed. UNUSED on the `group_col` "
    "branch (the per-level series it synthesizes do not align 1:1 with "
    "`y_keys`, the same reason `series_styles` is unapplied there) and on the "
    "`facets` branch (which renders from its own panel payloads); the client "
    "omits it for both rather than sending an offset the renderer would "
    "mis-apply. See `calc.plotting.apply_waterfall_offsets`."
)


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
