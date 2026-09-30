"""Stat-stage figure export routes: statplot (box/violin/Q-Q/histogram) + bar.

Split into its own router file (rather than staying in
``routes/export_figures.py``) purely to keep that file under the 500-line
god-module ceiling — it reached 493 lines once JMP_GAP J5's box/strip mark
fields landed on ``StatplotFigureRequest`` (the same reason
``export_figures_aux.py`` and ``export_page.py`` were split out earlier).
(``routes/export_facets.py``, the standalone ``POST /api/export/facets-figure``
route this comment used to also name, was deleted in the fix-round-3 cleanup
(R5/R6) — a shadow duplicate of ``export_figures.py``'s ``FigureRequest.facets``
branch with zero frontend consumers, which had already drifted from it.)

The cut follows the same seam ``export_figures_aux.py`` used: these routes
take PRE-AGGREGATED arrays (per-group samples, a category x series matrix),
not a ``dataset`` + channel picks, so they share no helper with
``export_figures.py``'s ``_figure_series``/``_tick_fmt``. Both are the
export half of the interactive StatStage — the statplot modes and its "bar"
mode — which is why they travel together.

Wraps ``calc.figure_statplots`` (box/violin/Q-Q/probability/histogram/strip),
``calc.figure_categorical`` (grouped/stacked bars) and ``calc.figure_facets``
(the small-multiples grid for both). Output formats: PDF/SVG/PNG/TIFF. No
formatting logic here — renderers own it. Filenames are sanitized before
reaching the Content-Disposition header.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.heavy_import import heavy_imports
from quantized.routes._errors import CALC_ERRORS_WITH_LOCK, raise_calc_error
from quantized.routes._export_common import (
    _DPI_MAX,
    _DPI_MIN,
    _FIGURE_MIME,
    _attachment,
    _safe_name,
)

router = APIRouter(prefix="/api/export", tags=["export"])


class CategoryAxisStyle(BaseModel):
    """P2.6 box 1: how the category tick labels are set -- the SAME options
    the Canvas stage reads (``statRenderAxes.ts``). ``wrap`` is the line
    width in characters (``calc.figure_category_axis.wrap_label``);
    ``tiered`` draws a nested axis in two tiers with separators. Defaults =
    the axis before these options.

    ``tiers`` (P2.6 review finding 4) is the request's OWN [outer, inner]
    pair per label (`lib/statMarks.nestedTiers`, split at the nest column's
    own marker rather than the first ``" / "`` in the composite string) --
    when given, ``calc.figure_category_axis.style_category_axis`` uses these
    pairs directly instead of re-splitting the label text itself, so an
    outer level whose own text contains ``" / "`` groups correctly. Only
    meaningful on the FLAT (non-faceted) request's top-level ``axis_style``
    -- a faceted request's per-panel pairs ride ``StatplotFacet.tiers``
    instead (a nested axis's pairs are per-panel data)."""

    rotation: Literal[0, 45, 90] = 0
    wrap: int | None = Field(default=None, ge=4, le=60)
    tiered: bool = False
    tiers: list[tuple[str, str]] | None = None


def _axis_style(style: CategoryAxisStyle | None) -> dict[str, Any] | None:
    return style.model_dump() if style is not None else None


class StatplotFacet(BaseModel):
    """One box/violin small-multiple panel (GUI_INTERACTION #12 slice 4b —
    StatStage's faceted export). ``kind`` is per-facet MODE FIDELITY: the
    interactive StatStage computes each facet slice independently and a
    violin slice whose OWN ``/api/statplots/violin`` call failed degrades to
    a box plot for just that slice (never fabricating a KDE) — an explicit
    per-facet ``kind`` reproduces that same mixed grid on export; omitted
    falls back to the request's own top-level ``kind``."""

    label: str
    kind: str | None = None
    data: list[list[float]]
    labels: list[str] | None = None
    # P2.6 review finding 2: this panel's own canvas y-domain (box only —
    # see StatplotFigureRequest.y_domain's doc). None = today's
    # autoscale-to-drawn-artists behaviour.
    y_domain: tuple[float, float] | None = None
    # P2.6 review finding 4: this panel's OWN [outer, inner] pairs, one per
    # `labels` entry -- never the request's SHARED top-level
    # `axis_style.tiers` (see CategoryAxisStyle.tiers's doc). None = no
    # tiering for this panel beyond the shared `axis_style.tiered` gate.
    tiers: list[tuple[str, str]] | None = None
    # JMP_GAP J5 residual (closed 2026-09-29): this panel's groups' ORIGINAL
    # dataset rows, parallel to `data` -- its jittered points use the screen's
    # `(row, category)` hash. None = no jittered points in this panel (the
    # rule before panels carried rows, `figure_stat_marks.facet_marks`).
    point_row_indices: list[list[int]] | None = None
    # Where this panel's connect-means line lifts (the flat `connect_breaks`,
    # per panel). The line itself is the request's `show_connect_means`.
    connect_breaks: list[bool] | None = None
    # P1.4 Color-by: this panel's groups' colour levels (the request's `palette`).
    color_levels: list[int | None] | None = None


class StatplotFigureRequest(BaseModel):
    kind: str  # box|violin|qq|probability|histogram|strip
    data: list[list[float]] | list[float]  # groups (box/violin/strip) or one sample
    labels: list[str] | None = None
    fmt: str = "pdf"
    style: str = "default"
    dist: str = "norm"
    bins: str | int = "fd"
    fit: str | None = None
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    # None (default) resolves to the style preset's calibrated dpi, matching
    # calc.figure's resolved_dpi convention (see corner/ternary/field siblings).
    dpi: int | None = None
    filename: str = "statplot"
    # JMP_GAP J5: box/strip mark completion. `show_points` scatters each
    # group's raw finite values, jittered with the SAME deterministic
    # `(row_index, category)` hash the interactive canvas uses --
    # `point_row_indices` (parallel to `data`) supplies each group's ORIGINAL
    # dataset row indices so a point lands in the same relative spot on
    # screen and in the export. `show_mean_ci` overlays a mean +/- 95% CI
    # diamond+whisker marker (`calc.statplots.box_stats`'s sem/ci_lo/ci_hi).
    # Both default off/None -- today's behaviour, byte-identical.
    show_points: bool = False
    point_row_indices: list[list[int]] | None = None
    show_mean_ci: bool = False
    # JMP_GAP J5 residual: connect-group-means "interaction plot" line
    # (box/strip only) through each group's mean, in on-screen category
    # order. Default off -- today's behaviour, byte-identical.
    show_connect_means: bool = False
    # GUI_INTERACTION #12 slice 4b: one box/violin mini-panel per StatStage
    # "facet by" level instead of the flat single panel — the SAME
    # ceil(sqrt(n)) grid the interactive stage uses (calc.figure_facets).
    # None/absent = today's single-panel behaviour, byte-identical; `data`/
    # `labels` above are still required by the schema but unused in that case.
    facets: list[StatplotFacet] | None = None
    # P2.6 box 2 (calc.figure_group_notes): `show_n` annotates each group's
    # n on a top axis; `caveat` is the frontend's small-n / unbalanced-groups
    # caveat, drawn verbatim as a footnote. An EMPTY group in `data` (box/
    # violin/strip) is a missing level: it keeps its slot with an n=0 marker.
    # Defaults off/None -- byte-identical to before.
    show_n: bool = False
    caveat: str | None = None
    # P2.6 box 1: which error bar the figure draws, verbatim as the screen
    # words it under the plot (`lib/statMarks.errorBarNote`, e.g. "Error
    # bars: SE of the mean") -- a footnote line above the caveat
    # (`calc.figure_group_notes.footnote_text`). None = no line, as before.
    error_note: str | None = Field(default=None, max_length=200)
    # Per group: lift the connect-means line BEFORE it (a hidden empty level
    # sat there -- the screen's AxisSlot.gapBefore). None = no forced breaks.
    connect_breaks: list[bool] | None = None
    # P2.6 box 1 (calc.figure_stat_marks): raw-point visibility, jitter
    # width (fraction of the glyph half-width; 0 = none), the summary marker
    # and the mean's error bars. None = the request before these fields,
    # rendered as before (`show_points` / `show_mean_ci` keep their meaning).
    points: Literal["all", "outliers", "none"] | None = None
    jitter_width: float | None = Field(default=None, ge=0.0, le=1.0)
    summary: Literal["none", "mean", "median"] | None = None
    error_bars: Literal["none", "sd", "se", "ci95"] | None = None
    axis_style: CategoryAxisStyle | None = None
    # P2.6 review finding 2: an explicit y-axis range (the canvas's own
    # box/strip value domain, `Stage/statStageExport.canvasYDomain`),
    # applied with `ax.set_ylim` after drawing so matplotlib's own
    # autoscale-to-drawn-artists can never disagree with the screen's
    # domain (which deliberately spans hidden fliers/points so toggling a
    # mark never rescales the plot). None = today's autoscale behaviour.
    y_domain: tuple[float, float] | None = None
    # P1.4 Color-by (`calc.figure_stat_colors`): each group's colour LEVEL,
    # parallel to `data` (null: by position), and the client's palette as hex,
    # indexed by level. None = the figure without a colour factor, unchanged.
    color_levels: list[int | None] | None = None
    palette: list[str] | None = None

    def marks(self) -> dict[str, Any] | None:
        fields = {
            "points": self.points, "jitter_width": self.jitter_width,
            "summary": self.summary, "error_bars": self.error_bars,
        }
        out = {k: v for k, v in fields.items() if v is not None}
        return out or None


@router.post("/statplot-figure")
def export_statplot_figure(req: StatplotFigureRequest) -> Response:
    """Render a statistical plot (box/violin/Q-Q/histogram) to a publication
    figure (PDF/SVG/PNG/TIFF). An optional ``facets`` list renders a faceted
    box/violin small-multiples grid instead (GUI_INTERACTION #12 slice 4b)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi)) if req.dpi is not None else None
    try:
        if req.facets:
            with heavy_imports(
                "quantized.calc.figure_facets", "quantized.calc.figure_group_notes",
                "quantized.calc.figure_stat_colors",
            ):
                from quantized.calc.figure_facets import render_stat_facets_figure  # lazy
                from quantized.calc.figure_group_notes import footnote_text
                from quantized.calc.figure_stat_colors import level_colors

            panels: list[dict[str, Any]] = [
                {
                    "label": f.label, "kind": f.kind, "data": f.data, "labels": f.labels,
                    "y_domain": f.y_domain, "tiers": f.tiers,
                    "point_row_indices": f.point_row_indices, "connect_breaks": f.connect_breaks,
                    "colors": level_colors(f.color_levels, req.palette),
                }
                for f in req.facets
            ]
            img = render_stat_facets_figure(
                panels, default_kind=req.kind, dist=req.dist, bins=req.bins, fit=req.fit,
                title=req.title, x_label=req.x_label, y_label=req.y_label,
                fmt=req.fmt, style=req.style, dpi=dpi, show_n=req.show_n,
                caveat=footnote_text(req.error_note, req.caveat),
                marks=req.marks(), axis_style=_axis_style(req.axis_style),
                show_connect_means=req.show_connect_means,
            )
        else:
            with heavy_imports(
                "quantized.calc.figure_statplots", "quantized.calc.figure_group_notes",
                "quantized.calc.figure_stat_colors",
            ):
                from quantized.calc.figure_group_notes import footnote_text
                from quantized.calc.figure_stat_colors import level_colors
                from quantized.calc.figure_statplots import render_statplot_figure  # lazy

            data: Any = req.data
            data = [list(g) for g in data] if req.kind in ("box", "violin", "strip") else list(data)
            img = render_statplot_figure(
                req.kind, data, labels=req.labels, fmt=req.fmt, style=req.style,
                dist=req.dist, bins=req.bins, fit=req.fit,
                title=req.title, x_label=req.x_label, y_label=req.y_label, dpi=dpi,
                show_points=req.show_points, point_row_indices=req.point_row_indices,
                show_mean_ci=req.show_mean_ci, show_connect_means=req.show_connect_means,
                show_n=req.show_n, caveat=footnote_text(req.error_note, req.caveat),
                connect_breaks=req.connect_breaks,
                marks=req.marks(), axis_style=_axis_style(req.axis_style), y_domain=req.y_domain,
                colors=level_colors(req.color_levels, req.palette),
            )
    except CALC_ERRORS_WITH_LOCK as exc:
        raise_calc_error(exc)
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class CategoricalFacet(BaseModel):
    """One bar-chart small-multiple panel (GUI_INTERACTION #12 slice 4b —
    StatStage bar mode's faceted export). Self-contained (own ``groups``):
    a facet-column level can be absent from one slice, so panels never share
    one category set."""

    label: str
    groups: list[str]
    series: list[str]
    values: list[list[float | None]]
    errors: list[list[float | None]] | None = None
    counts: list[list[int]] | None = None
    # JMP_GAP J5 residual (closed 2026-09-29): this panel's grouped-bar
    # points / summary marker, the flat request's fields of the same names
    # (see CategoricalFigureRequest) over this panel's own cells.
    points: Literal["all", "outliers", "none"] | None = None
    jitter_width: float | None = Field(default=None, ge=0.0, le=1.0)
    summary: Literal["none", "mean", "median"] | None = None
    raw: list[list[list[float]]] | None = None
    raw_rows: list[list[list[int]]] | None = None
    # P1.4 Color-by: this panel's categories' colour levels (the request's `palette`).
    color_levels: list[int | None] | None = None

    def bar_marks(self) -> dict[str, Any] | None:
        return _bar_marks(self.points, self.jitter_width, self.summary, self.raw, self.raw_rows)


def _bar_marks(
    points: str | None, jitter_width: float | None, summary: str | None,
    raw: list[list[list[float]]] | None, raw_rows: list[list[list[int]]] | None,
) -> dict[str, Any] | None:
    fields = {
        "points": points, "jitter_width": jitter_width, "summary": summary,
        "raw": raw, "raw_rows": raw_rows,
    }
    out = {k: v for k, v in fields.items() if v is not None}
    return out or None


class CategoricalFigureRequest(BaseModel):
    groups: list[str]  # category tick labels, in axis order
    series: list[str]  # series (legend) labels, in stack/cluster order
    # [group][series] bar height (mean). `null` = no finite value in that
    # cell (P2.6 box 2): no bar is drawn, and a category that is null in
    # every series keeps its tick with an n=0 marker. It used to be
    # `list[list[float]]`, so a bar chart with an all-NaN level 422'd on
    # export (JSON has no NaN; the client's NaN mean arrived as null).
    values: list[list[float | None]]
    # [group][series] error-bar half-width. The client computes it for the
    # error-bar kind on screen (P2.6 box 1: SEM by default, or SD / 95% t-CI,
    # `lib/statMarks.errorHalfWidth`), so the figure draws what the screen does.
    errors: list[list[float | None]] | None = None
    # P2.6 box 2: [group][series] sample sizes -> an n=K label over each
    # grouped bar; `caveat` -> footnote. Defaults off -- byte-identical.
    counts: list[list[int]] | None = None
    caveat: str | None = None
    error_note: str | None = Field(default=None, max_length=200)  # see StatplotFigureRequest
    stacked: bool = False
    fmt: str = "pdf"
    style: str = "default"
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    dpi: int = 200
    filename: str = "bar"
    # GUI_INTERACTION #12 slice 4b: one bar-chart mini-panel per StatStage
    # "facet by" level. None/absent = today's single-panel behaviour,
    # byte-identical; `groups`/`series`/`values` above are still required by
    # the schema but unused in that case.
    facets: list[CategoricalFacet] | None = None
    axis_style: CategoryAxisStyle | None = None  # P2.6 box 1, see StatplotFigureRequest
    # P2.6 box 1 (calc.figure_stat_marks.overlay_bar_marks), GROUPED bars of
    # the flat panel only: raw points ("outliers" = beyond the cell's Tukey
    # whiskers), their jitter (fraction of the BAR's half-width) and a
    # summary marker. `raw[group][series]` holds each cell's finite values,
    # `raw_rows` their original row indices (the jitter hash's row). None =
    # the request before these fields, drawn as before.
    points: Literal["all", "outliers", "none"] | None = None
    jitter_width: float | None = Field(default=None, ge=0.0, le=1.0)
    summary: Literal["none", "mean", "median"] | None = None
    raw: list[list[list[float]]] | None = None
    raw_rows: list[list[list[int]]] | None = None
    # P1.4 Color-by: each CATEGORY's colour level (every series of it; null:
    # by series) and the palette as hex -- see StatplotFigureRequest.
    color_levels: list[int | None] | None = None
    palette: list[str] | None = None

    def bar_marks(self) -> dict[str, Any] | None:
        return _bar_marks(self.points, self.jitter_width, self.summary, self.raw, self.raw_rows)


@router.post("/categorical-figure")
def export_categorical_figure(req: CategoricalFigureRequest) -> Response:
    """Render a grouped/stacked bar chart (gap #20) to a publication figure
    (PDF/SVG/PNG/TIFF) — the same category x series matrix (mean ± SEM) the
    interactive stat stage's "bar" mode draws on-screen. An optional
    ``facets`` list renders a faceted small-multiples grid instead
    (GUI_INTERACTION #12 slice 4b)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    try:
        if req.facets:
            with heavy_imports(
                "quantized.calc.figure_facets", "quantized.calc.figure_group_notes",
                "quantized.calc.figure_stat_colors",
            ):
                from quantized.calc.figure_facets import render_categorical_facets_figure  # lazy
                from quantized.calc.figure_group_notes import footnote_text
                from quantized.calc.figure_stat_colors import level_colors

            panels: list[dict[str, Any]] = [
                {
                    "label": f.label, "groups": f.groups, "series": f.series,
                    "values": f.values, "errors": f.errors, "counts": f.counts,
                    "bar_marks": f.bar_marks(), "colors": level_colors(f.color_levels, req.palette),
                }
                for f in req.facets
            ]
            img = render_categorical_facets_figure(
                panels, stacked=req.stacked, title=req.title, x_label=req.x_label,
                y_label=req.y_label, fmt=req.fmt, style=req.style, dpi=dpi,
                caveat=footnote_text(req.error_note, req.caveat),
                axis_style=_axis_style(req.axis_style),
            )
        else:
            with heavy_imports(
                "quantized.calc.figure_categorical", "quantized.calc.figure_group_notes",
                "quantized.calc.figure_stat_colors",
            ):
                from quantized.calc.figure_categorical import render_categorical_figure  # lazy
                from quantized.calc.figure_group_notes import footnote_text
                from quantized.calc.figure_stat_colors import level_colors

            img = render_categorical_figure(
                req.groups, req.series, req.values, req.errors, stacked=req.stacked,
                fmt=req.fmt, style=req.style, title=req.title, x_label=req.x_label,
                y_label=req.y_label, dpi=dpi, counts=req.counts,
                caveat=footnote_text(req.error_note, req.caveat),
                axis_style=_axis_style(req.axis_style), bar_marks=req.bar_marks(),
                colors=level_colors(req.color_levels, req.palette),
            )
    except CALC_ERRORS_WITH_LOCK as exc:
        raise_calc_error(exc)
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
