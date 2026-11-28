"""The request model of one small-multiple panel of ``POST /api/export/statplot-figure`` (split from
``export_statplots.py``, which sits at its 500-line ceiling)."""

from __future__ import annotations

from pydantic import BaseModel

from quantized.routes.export_statplots_dist3 import Dist3Options

__all__ = ["StatplotFacet"]


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
    # Item 20: this panel's own options when the plot is a half / split violin, paired, lollipop or
    # a histogram stacked by a group (`kind` names the plot, ``data`` holds this panel's groups).
    dist3: Dist3Options | None = None
