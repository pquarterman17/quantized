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

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.routes._export_common import (
    _DPI_MAX,
    _DPI_MIN,
    _FIGURE_MIME,
    _attachment,
    _safe_name,
)

router = APIRouter(prefix="/api/export", tags=["export"])


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
            from quantized.calc.figure_facets import render_stat_facets_figure  # lazy

            panels: list[dict[str, Any]] = [
                {"label": f.label, "kind": f.kind, "data": f.data, "labels": f.labels}
                for f in req.facets
            ]
            img = render_stat_facets_figure(
                panels, default_kind=req.kind, dist=req.dist, bins=req.bins, fit=req.fit,
                title=req.title, x_label=req.x_label, y_label=req.y_label,
                fmt=req.fmt, style=req.style, dpi=dpi,
            )
        else:
            from quantized.calc.figure_statplots import render_statplot_figure  # lazy

            data: Any = req.data
            data = [list(g) for g in data] if req.kind in ("box", "violin", "strip") else list(data)
            img = render_statplot_figure(
                req.kind, data, labels=req.labels, fmt=req.fmt, style=req.style,
                dist=req.dist, bins=req.bins, fit=req.fit,
                title=req.title, x_label=req.x_label, y_label=req.y_label, dpi=dpi,
                show_points=req.show_points, point_row_indices=req.point_row_indices,
                show_mean_ci=req.show_mean_ci, show_connect_means=req.show_connect_means,
            )
    except (ValueError, ArithmeticError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    values: list[list[float]]
    errors: list[list[float | None]] | None = None


class CategoricalFigureRequest(BaseModel):
    groups: list[str]  # category tick labels, in axis order
    series: list[str]  # series (legend) labels, in stack/cluster order
    values: list[list[float]]  # [group][series] bar height (mean)
    errors: list[list[float | None]] | None = None  # [group][series] SEM
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
            from quantized.calc.figure_facets import render_categorical_facets_figure  # lazy

            panels: list[dict[str, Any]] = [
                {
                    "label": f.label, "groups": f.groups, "series": f.series,
                    "values": f.values, "errors": f.errors,
                }
                for f in req.facets
            ]
            img = render_categorical_facets_figure(
                panels, stacked=req.stacked, title=req.title, x_label=req.x_label,
                y_label=req.y_label, fmt=req.fmt, style=req.style, dpi=dpi,
            )
        else:
            from quantized.calc.figure_categorical import render_categorical_figure  # lazy

            img = render_categorical_figure(
                req.groups, req.series, req.values, req.errors, stacked=req.stacked,
                fmt=req.fmt, style=req.style, title=req.title, x_label=req.x_label,
                y_label=req.y_label, dpi=dpi,
            )
    except (ValueError, ArithmeticError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
