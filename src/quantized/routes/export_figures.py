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

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._export_common import (
    _DPI_MAX,
    _DPI_MIN,
    _FIGURE_MIME,
    _attachment,
    _safe_name,
)
from quantized.routes.export_figures_labels import (
    derived_axis_label,
    series_legends,
    series_names,
    solo_axis_label,
)
from quantized.routes.export_figures_schema import (
    SERIES_STYLES_DOC,
    WATERFALL_OFFSETS_DOC,
    FigureFacet,
    TickFormatSpec,
    _ResolvedFigure,
    _tick_fmt,
    reject_document_only_style_keys,
)

router = APIRouter(prefix="/api/export", tags=["export"])


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
    # `_figure_series`. `series_styles` IS applied here (BUG-016 -- this doc
    # used to claim the opposite, and that "the screen never assigns per-level
    # colors either"): the screen gives EVERY level of a channel that
    # channel's one style, explicit colour included, so the branch expands the
    # `y_keys`-aligned list onto the synthetic series. What it does NOT give a
    # level is a colour nobody chose -- an unstyled level takes the palette
    # slot at its OWN display position, which one channel-aligned entry cannot
    # express, so the client omits `color` for a grouped request and
    # matplotlib's cycle colours the levels as before. The measured rule, and
    # the two keys that cannot expand verbatim, are in
    # `calc.figure_group_styles`. `legend` is a LABEL, not a stroke: it
    # replaces the channel-label half of `"{label} ({group}={level})"`.
    group_col: int | None = None
    # FIGURE_AUTHORING_WORKFLOW_PLAN F4.4 (export half): one xy small-
    # multiples panel per facet-column level, RESOLVED client-side
    # (`lib/facet.facetPayloads`, wrapped by `lib/figureSpecFacets.ts`)
    # rather than a raw column index -- so this
    # route never re-derives level ordering/binning and can never disagree
    # with what Stage showed on screen. None/absent (default) = today's
    # single-panel behaviour, byte-identical; most other fields on this
    # request (`overrides`/`series_styles`/`error_spans`/`y2_keys`/...) stay
    # required by the schema but UNUSED once `facets` is set -- the same
    # "wire shape stays whole, semantics switch" contract
    # `StatplotFigureRequest.facets`/`CategoricalFigureRequest.facets`
    # already use (`routes/export_statplots.py`). `dataset`/`x_key`/`y_keys`
    # are the one exception: they're still resolved (via `_figure_series`,
    # discarding its `series`/`x`) purely to derive "label (unit)" axis
    # labels when `x_label`/`y_label` are absent -- the fix-round C4 finding
    # (a bare `req.x_label or ""` silently dropped auto-derived labels on
    # this branch). Renders via `calc.figure_facets.render_facets_figure`:
    # one shared x-domain across every panel, each panel keeping its own
    # independent y-autoscale (see that function's own doc for why), and the
    # SAME axis-scale/tick-format resolution the flat path uses
    # (`x_scale`/`y_scale` via `calc.figure_scale.resolve_axis_scale`,
    # `x_fmt`/`y_fmt` via `calc.figure_ticks.apply_tick_formats`) -- the
    # fix-round C1 finding (this branch previously only honored the legacy
    # `x_log`/`y_log` booleans, which the frontend never sends).
    facets: list[FigureFacet] | None = None
    fmt: str = "pdf"
    style: str = "default"  # publication preset: aps / report / web / …
    dpi: int = 200  # raster (png/tiff) resolution; ignored by vector formats
    # MAIN_PLAN #35: transparent canvas instead of the preset background —
    # what "Copy figure" needs to paste cleanly onto a coloured slide.
    transparent: bool = False
    # PRIMARY_SOFTWARE_AUDIT_PLAN P3.3: print-safe export -- every series'
    # colour is overridden to a position-based grey ramp and the dash/marker
    # cycle is forced (see `calc.figure_greyscale`'s module doc). An
    # EXPORT-ONLY transform: the on-screen canvas stays coloured regardless
    # of this flag, so it is a user-chosen export option, not a derived
    # style, and does not touch the P3.3 screen/export style-parity
    # invariant that `series_styles` above exists to satisfy. No-op when
    # `facets` is set (see this class's `facets` field doc) -- a faceted
    # panel never resolves per-series colour at all today (FEATURE-001,
    # `plans/BUGS_AND_ISSUES.md`), so there is nothing for this flag to grey.
    # Also reachable embedded in a page panel (`routes.export_page.
    # PagePanelSpec.figure` is this SAME `FigureRequest`): review fix P3.3-F1
    # threaded this field into `calc.figure_page.PagePanel.greyscale`, honored
    # PER PANEL there too -- it used to 200 and silently render as if it were
    # `False` on that route (a real bug, not a documented no-op like facets).
    # `/api/export/map-figure` (contour/heatmap/surface/waterfall) has NO
    # `greyscale` field at all, deliberately: every one of its `kind`s colours
    # by a continuous z-value through `cmap`, the same "colour IS the plotted
    # quantity" case this flag already leaves untouched for a `color_by`
    # scatter above -- there is no categorical per-series palette there for a
    # print-safe ramp to replace.
    greyscale: bool = False
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
    # Two FIELD DOCS, not `#` comments (BUG-013 review round, NIT 6): a `#`
    # comment reaches no generated artefact, so an OpenAPI consumer saw a bare
    # "Waterfall Offsets"/"Series Styles" title -- and `series_styles` is a
    # loose dict whose keys (BUG-014's `legend` among them) can be documented
    # nowhere else. The strings live in `export_figures_schema` for the same
    # reason that module holds `FigureRequest`'s wire models: this file's
    # 500-line ceiling. See there for the text.
    series_styles: list[dict[str, Any] | None] | None = Field(
        default=None, description=SERIES_STYLES_DOC
    )
    waterfall_offsets: list[float] | None = Field(
        default=None, description=WATERFALL_OFFSETS_DOC
    )
    # Property-panel overrides (gap #11): fonts / legend / ticks / spines /
    # limits / margins / grid / annotations — validated in calc.
    overrides: dict[str, Any] | None = None
    filename: str = "figure"

    # BUG-016 round 4 (review F9): refuse a leaked DOCUMENT-only style key.
    # The rule and why this one key is a 422 rather than a graceful degrade
    # live with the list itself, in `export_figures_schema`. Declared on this
    # model, so the page route inherits it through `PagePanelSpec.figure`.
    _no_document_keys = field_validator("series_styles")(
        reject_document_only_style_keys
    )


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

    ``req.waterfall_offsets`` (BUG-013) shifts each resolved series up by its
    own offset (``calc.plotting.apply_waterfall_offsets``), so every caller of
    this helper exports the waterfall stagger the canvas shows.

    ``req.group_col`` (GUI_INTERACTION #12 Slice 5) switches to the grouped
    resolve path (``calc.plotting.build_grouped_series``): every ``y_keys``
    channel becomes one series per group level instead of one series per
    channel, matching the screen's ``buildXY`` colour split; ``styles`` is
    ``series_styles`` expanded onto them (BUG-016, below). Mutually
    exclusive with ``req.y2_keys`` (raises ``ValueError`` -- ``buildXY``
    never assigns a grouped series to the secondary axis, so there's no
    sound semantic to invent for the combination)."""
    from quantized.calc.figure_group_styles import expand_grouped_series_styles
    from quantized.calc.plotting import (
        PlotState,
        apply_waterfall_offsets,
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
        # BUG-014: a legend rename rides `series_styles[i].legend`, aligned to
        # `y_keys`. This branch expands each y channel into one series PER
        # LEVEL, so the override cannot name a finished series name the way it
        # does on the flat path -- it replaces the CHANNEL-label half of
        # `build_grouped_series`' own `"{y_label} ({group}={level})"` template,
        # byte-for-byte what the pre-BUG-014 wire produced (the rename used to
        # arrive as a rewritten `dataset.labels[ch]`).
        grouped = build_grouped_series(
            ds, req.x_key, y_keys, req.group_col, series_legends(req.series_styles, len(y_keys))
        )
        x_label = derived_axis_label(req.x_label, grouped.x_label, grouped.x_unit)
        y_label = req.y_label if req.y_label is not None else ""
        g_series: list[tuple[str, Any]] = [
            (f"{s.label} ({s.unit})" if s.unit else s.label, s.values) for s in grouped.series
        ]
        # BUG-016: every level draws with its channel's style, as the canvas
        # does -- `calc.figure_group_styles` carries the measured rule.
        g_styles = expand_grouped_series_styles(
            resolve_style_channels(ds, y_keys, req.series_styles), len(y_keys), len(g_series)
        )
        return _ResolvedFigure(
            grouped.x, g_series, x_label, y_label, g_styles, [False] * len(g_series), ""
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
    # BUG-014: the per-series legend override (`series_styles[i].legend`) is
    # used VERBATIM where present, so a renamed series exports with exactly
    # the text the screen shows instead of the channel's unit being appended
    # to it a second time. A solo axis title reads the SAME resolved name --
    # `uplotOpts.buildOpts`' `soloLabel` reads the resolved legend too.
    names = series_names(plot.series, series_legends(req.series_styles, len(plot.series)))
    x_label = derived_axis_label(req.x_label, plot.x_label, plot.x_unit)
    y_label = solo_axis_label(req.y_label, names, plot.series, 0)
    y2_label = solo_axis_label(req.y2_label, names, plot.series, 1)
    series: list[tuple[str, Any]] = apply_waterfall_offsets(
        [(name, s.values) for name, s in zip(names, plot.series, strict=True)],
        req.waterfall_offsets,
    )
    styles = resolve_style_channels(ds, req.y_keys, req.series_styles)
    y2_mask = [s.axis == 1 for s in plot.series]
    return _ResolvedFigure(plot.x, series, x_label, y_label, styles, y2_mask, y2_label)


def _facet_panels(req: FigureRequest) -> list[dict[str, Any]]:
    """Reshape ``req.facets`` into ``calc.figure_facets``' panel-dict shape
    (``{"label": str, "x": [...], "series": [{"label": str, "y": [...]}]}``)
    -- the ONE reshape, shared by ``_render_facets_bytes`` (the standalone
    ``/figure``/``/figure-hitmap`` facet branches) and ``routes.export_page``
    (a faceted page panel -- F4.4 follow-up, a real vector sub-grid instead
    of the earlier pre-rendered raster embed), so the two routes can never
    drift on how a facet-bound panel's wire payload turns into the
    renderer's input. Kept here (not calc/) because it moves ``req.facets``'
    pydantic model instances into plain dicts -- exactly the route-layer job
    the calc/routes split reserves for routes/."""
    assert req.facets
    return [
        {
            "label": f.label,
            "x": f.x,
            "series": [{"label": s.label, "y": s.y} for s in f.series],
        }
        for f in req.facets
    ]


def _render_facets_bytes(req: FigureRequest, *, dpi: int, fmt: str | None = None) -> bytes:
    """Render ``req.facets`` to image bytes -- the standalone facet-branch
    renderer used by ``export_figure``/``export_figure_hitmap`` (R2, fix
    round 3). Derives axis labels via ``_figure_series`` (C4 --
    ``resolved.x_label``/``resolved.y_label`` already apply the "explicit
    override, else derive from the dataset" rule), and forwards scale/tick-
    format/transparent/overrides the SAME way the flat branch does
    (C1/C3/R3). ``fmt`` overrides ``req.fmt`` when given -- ``export_figure_
    hitmap`` forces ``fmt="png"`` (the preview render is always a raster
    PNG). (``title``/``style`` override params were dropped in fix round 3,
    W2 -- dead since ``routes.export_page`` stopped calling this function
    at all in fix round 1, and neither remaining caller ever passed them.)"""
    from quantized.calc.figure_facets import render_facets_figure

    resolved = _figure_series(req)
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


@router.post("/figure")
def export_figure(req: FigureRequest) -> Response:
    """Render the dataset (selected channels + log scales) to a publication
    figure: PDF / SVG (vector) or PNG / TIFF (raster, at ``dpi``). An
    optional ``facets`` list (F4.4) renders a faceted xy small-multiples grid
    instead of the flat single panel -- see ``FigureRequest.facets``'s own
    doc for the wire contract."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    try:
        if req.facets:
            data = _render_facets_bytes(req, dpi=dpi)
        else:
            from quantized.calc.figure import render_figure

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
                greyscale=req.greyscale,
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
    except CALC_ERRORS as exc:
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
    to data coordinates. ``fmt`` is ignored (always PNG at ``dpi``).

    FU-facet-hitmap (closes the former R1/fix-round-3 gap): a facet-bound
    request (``req.facets`` set) renders the SAME small-multiples grid
    ``/figure`` exports (via ``calc.figure_facets_map.render_facets_figure_map``,
    sharing ``_render_facets_bytes``'s own ``_figure_series``-derived label
    resolution below) and now returns REAL per-panel geometry: ``panels``
    (one axes entry per panel -- pixel rect + data limits + facet label,
    replacing the flat path's single ``axes`` dict, which is absent here)
    and ``elements`` tagged with a ``panel`` index (each panel's facet
    title, series lines, and -- since fix round 4 -- its legend, when that
    panel drew one). The whole-figure ``title``/``xlabel``/``ylabel`` are
    ALSO harvested (fix round 3), emitted with the flat path's own ids and
    no ``panel`` key, so they stay editable exactly as on a flat preview.
    See ``calc.figure_hitmap.collect_facet_map`` for exactly what is/isn't
    harvested and why (facets genuinely draw no annotation/reference-line/
    shape into a panel today, so there is nothing to harvest for those ids;
    a panel's series line and legend ARE harvested but gated client-side,
    since per-panel style edits aren't wired through the facet render path
    -- full per-panel drag-edit is still future work, not silently faked
    here). The flat (non-facet) response below is
    UNCHANGED -- still ``elements`` + a single ``axes`` dict, no ``panels``
    key at all."""
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))

    try:
        if req.facets:
            from quantized.calc.figure_facets_map import render_facets_figure_map

            resolved = _figure_series(req)
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
        from quantized.calc.figure import render_figure_map

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
            greyscale=req.greyscale,
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
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
