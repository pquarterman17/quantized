"""Raw points, jitter, summary markers and error bars for the box / strip /
violin export (P2.6 box 1).

PRIMARY_SOFTWARE_AUDIT_PLAN P2.6, "jitter / summary / errors / raw-point
visibility". The export twin of the Canvas stage's ``statRenderBox.ts`` /
``lib/statMarks.ts``: one resolved option set (:class:`StatMarks`) and the
matplotlib calls that draw it, so ``figure_statplots._draw_statplot`` stays a
dispatcher.

Options, as the request carries them (``None`` = the pre-P2.6 request, drawn
as before -- see :func:`resolve_marks` for the one edge case that changed):

* ``points`` -- ``"all"`` (every finite value, jittered), ``"outliers"`` (only
  values beyond the Tukey whiskers: box draws them as its fliers, strip and
  violin as jittered points) or ``"none"``.
* ``jitter_width`` -- the jitter's half-spread as a fraction of the slot's
  glyph half-width (0 = no jitter, points on the centre line). The offset of a
  point is ``deterministic_jitter(row, label) * half * jitter_width``, the
  screen's formula; a new-style request also draws boxes at the screen's width
  (:data:`SLOT_WIDTH` of the slot pitch), so a point sits at the SAME place
  relative to its box on screen and in the figure.
* ``summary`` -- ``"none"`` / ``"mean"`` (a diamond) / ``"median"`` (a square).
* ``error_bars`` -- ``"none"`` / ``"sd"`` / ``"se"`` / ``"ci95"`` around the
  MEAN (``calc.statplots.error_bar_bounds`` holds the conventions: n-1 sample
  SD, SE = SD/sqrt(n), 95% CI via Student t(0.975, n-1)); drawn only with the
  mean marker, and never below n = 2.

P2.6 box 1, second pass: the VIOLIN takes the summary marker and its error
bar too (the same glyphs as box / strip), and its inner glyph is the BOX's
semantics on both sides -- a thick bar from q1 to q3 plus a hollow dot at the
median (:func:`draw_violin_inner`, the screen's ``statRender.drawViolins``);
matplotlib's own mean + extrema lines are kept only for a LEGACY request (no
mark field at all). GROUPED bars take raw points and the summary marker
(:func:`overlay_bar_marks`, the screen's ``statRenderBar.drawBarCellMarks``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from quantized.calc.statplots import box_stats as _box_stats
from quantized.calc.statplots import deterministic_jitter as _jitter
from quantized.calc.statplots import error_bar_bounds

__all__ = [
    "POINTS_MODES",
    "SLOT_WIDTH",
    "SUMMARY_MARKS",
    "StatMarks",
    "draw_violin_inner",
    "facet_marks",
    "overlay_bar_marks",
    "overlay_summary",
    "resolve_marks",
    "scatter_points",
]

POINTS_MODES = ("all", "outliers", "none")
SUMMARY_MARKS = ("none", "mean", "median")
# The Canvas stage's glyph width as a fraction of the category pitch
# (``lib/statstage.categorySlots``' default ``widthFrac``).
SLOT_WIDTH = 0.6
_LEGACY_BOX_WIDTH = 0.5  # matplotlib boxplot's own default, data units
_LEGACY_JITTER = 0.7


@dataclass(frozen=True)
class StatMarks:
    """The resolved marks for one grouped panel."""

    #: box only: let ``boxplot`` draw its fliers.
    fliers: bool
    #: which values get a jittered scatter (``None`` = no scatter).
    scatter: str | None
    #: glyph half-width the jitter scales, data units.
    half_width: float
    jitter_width: float
    summary: str
    error_bars: str
    #: box only: ``boxplot``'s own mean triangle (the pre-P2.6 default).
    box_showmeans: bool
    #: box / violin: explicit glyph width (``None`` = matplotlib's default).
    box_width: float | None
    #: violin: the box-semantics inner glyph (q1-q3 bar + median dot) instead
    #: of matplotlib's mean + extrema lines -- any request that sets a mark.
    violin_quartiles: bool = False


def resolve_marks(
    kind: str,
    *,
    show_points: bool = False,
    show_mean_ci: bool = False,
    points: str | None = None,
    jitter_width: float | None = None,
    summary: str | None = None,
    error_bars: str | None = None,
) -> StatMarks:
    """Resolve a request's mark fields for ``kind`` (box / strip / violin).

    Every new field ``None`` (a LEGACY request) reproduces the pre-P2.6
    behaviour for the two flags that existed then, ``show_points`` and
    ``show_mean_ci``: box fliers always on, a jittered scatter of every
    point for box/strip alike when ``show_points`` (default off for both --
    review finding 3: strip's scatter was gated by the SAME flag box's was,
    never unconditional; only an explicit `points`-set request draws
    strip's NEW always-on scatter, which has no legacy flag of its own),
    ``show_mean_ci`` as mean +/- 95% CI, and otherwise box's own mean
    triangle. One narrow, DELIBERATE divergence survives even for a legacy
    request (documented in ``plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md``'s P2.6
    note, not claimed as "exact"): a group of a single value now gets its
    mean marker with NO error bar, where it used to get a zero-length one
    with caps -- the screen never drew that stub."""
    if points is not None and points not in POINTS_MODES:
        raise ValueError(f"points must be one of {POINTS_MODES}")
    if summary is not None and summary not in SUMMARY_MARKS:
        raise ValueError(f"summary must be one of {SUMMARY_MARKS}")
    if jitter_width is not None and not 0.0 <= float(jitter_width) <= 1.0:
        raise ValueError("jitter_width must be within [0, 1]")
    new_style = any(v is not None for v in (points, jitter_width, summary, error_bars))
    legacy_points = points is None
    if legacy_points:
        if kind == "strip":
            # Review finding 3: pre-P2.6, strip's scatter WAS gated by
            # `show_points` (the box/strip toggle) like box's -- it did not
            # always scatter. A legacy request (every new field `None`) must
            # reproduce that, or `show_points=False` (its own default)
            # silently starts drawing points a pre-P2.6 caller never asked
            # for. The NEW-style always-on strip scatter (no toggle for it)
            # is a `points`-set request (`points="all"`/`"outliers"`), never
            # this legacy branch.
            points = "all" if show_points else "none"
        elif kind == "box":
            points = "all" if show_points else "outliers"
        else:
            points = "none"
    legacy_summary = summary is None
    if legacy_summary:
        summary = "mean" if show_mean_ci and kind != "violin" else "none"
    errors = "ci95" if error_bars is None else error_bars
    new_geometry = jitter_width is not None
    if kind == "box":
        fliers = points == "outliers" or (legacy_points and bool(show_points))
        scatter = "all" if points == "all" else None
    else:
        fliers = False
        scatter = None if points == "none" else points
    return StatMarks(
        fliers=fliers,
        scatter=scatter,
        half_width=(SLOT_WIDTH if new_geometry else _LEGACY_BOX_WIDTH) / 2,
        jitter_width=_LEGACY_JITTER if jitter_width is None else float(jitter_width),
        summary=str(summary),
        error_bars=errors,
        box_showmeans=legacy_summary and not show_mean_ci,
        box_width=SLOT_WIDTH if new_geometry else None,
        violin_quartiles=new_style,
    )


def facet_marks(
    marks: dict[str, Any] | None, kind: str, *, has_rows: bool,
) -> dict[str, Any] | None:
    """The marks one FACET panel draws (the screen's ``statStageMarks.
    facetMarks``). A panel that carries its own original row indices
    (``point_row_indices``, the JMP_GAP J5 residual closed 2026-09-29) draws
    exactly what the flat plot would -- jittered points included. One
    without them (a request from before that) keeps the old rule: no
    jittered points -- a box panel shows its fliers for ``points`` "all" or
    "outliers", a strip or violin panel none."""
    if not marks or "points" not in marks or has_rows:
        return marks
    shown = kind == "box" and marks["points"] != "none"
    return {**marks, "points": "outliers" if shown else "none"}


def scatter_points(
    ax: Any,
    groups: list[np.ndarray],
    labels: list[str],
    ticks: list[int],
    row_indices: list[list[int]],
    marks: StatMarks,
    box_stats: list[dict[str, Any]] | None = None,
    colors: list[str | None] | None = None,
) -> None:
    """The jittered raw-point overlay: ``marks.scatter`` values of each group
    (``"outliers"``: only those outside ``box_stats``' Tukey whiskers -- the
    rule the box's fliers use, and the screen's), offset horizontally by the
    SAME deterministic ``(row_index, category)`` hash the screen uses.

    ``box_stats`` (P2.6 review finding 10, optional, parallel to ``groups``):
    each group's ALREADY-COMPUTED ``calc.statplots.box_stats`` -- reused
    here (for the Tukey whiskers) rather than recomputed, when the caller
    also needs it for :func:`overlay_summary` / the connect-means line on
    the SAME groups (``_draw_statplot`` computes it once and shares it
    across all three). ``None`` (default) falls back to computing it here,
    byte-identical to before this fix. ``colors`` (P1.4 Color-by, parallel
    to ``groups``): each group's points in its glyph colour, as the screen
    draws them; ``None`` = the neutral grey."""
    if marks.scatter is None:
        return
    spread = marks.half_width * marks.jitter_width
    stats = box_stats if box_stats is not None else [None] * len(groups)
    tints = colors if colors is not None else [None] * len(groups)
    rows = zip(groups, labels, ticks, row_indices, stats, tints, strict=True)
    for g, lab, tick, idx, cached, tint in rows:
        if g.size == 0:
            continue
        keep = np.ones(g.size, dtype=bool)
        if marks.scatter == "outliers":
            b = cached if cached is not None else _box_stats(g)
            keep = (g < b["whislo"]) | (g > b["whishi"])
        if not keep.any():
            continue
        xs = [tick + _jitter(i, lab) * spread for i, k in zip(idx, keep, strict=True) if k]
        ax.scatter(xs, g[keep], s=10, color=tint or "0.25", alpha=0.6, zorder=4, linewidths=0)


def overlay_summary(
    ax: Any,
    groups: list[np.ndarray],
    ticks: list[int],
    marks: StatMarks,
    box_stats: list[dict[str, Any]] | None = None,
) -> None:
    """The summary marker per group -- a diamond at the mean or a square at
    the median -- with the mean's error bar (``marks.error_bars``) when it
    has one. Every number is ``box_stats``' (the SAME the interactive stage's
    ``/api/statplots/box`` returns), never a second computation.

    ``box_stats`` (P2.6 review finding 10): see :func:`scatter_points`'s own
    doc -- the SAME optional pre-computed, parallel list, reused instead of
    recomputed when given."""
    if marks.summary == "none":
        return
    stats = box_stats if box_stats is not None else [None] * len(groups)
    for g, tick, cached in zip(groups, ticks, stats, strict=True):
        b = cached if cached is not None else _box_stats(g)
        if marks.summary == "median":
            ax.plot([tick], [b["median"]], marker="s", color="black", markersize=5, zorder=5)
            continue
        bounds = error_bar_bounds(b, marks.error_bars)
        mean = b["mean"]
        yerr = [[mean - bounds[0]], [bounds[1] - mean]] if bounds else None
        ax.errorbar(
            [tick], [mean], yerr=yerr, fmt="D", color="black",
            markersize=6, capsize=4, linewidth=1.5, zorder=5,
        )


def draw_violin_inner(ax: Any, ticks: list[int], box_stats: list[dict[str, Any]]) -> None:
    """The violin's inner glyph, with the BOX's semantics: a thick black bar
    from q1 to q3 and a hollow dot at the median -- the screen's
    ``statRender.drawViolins`` draws the same two marks from the SAME linear-
    interpolated quartiles (``/api/statplots/violin``'s ``quartiles`` and
    ``box_stats`` are both ``np.percentile(v, [25, 50, 75])``). Tagged by
    ``gid`` so a test (or an SVG reader) can find them."""
    for tick, b in zip(ticks, box_stats, strict=True):
        ax.plot(
            [tick, tick], [b["q1"], b["q3"]], color="black", linewidth=3,
            solid_capstyle="butt", zorder=3, gid="violin-quartiles",
        )
        ax.plot(
            [tick], [b["median"]], marker="o", linestyle="None", markersize=5,
            markerfacecolor="white", markeredgecolor="black", markeredgewidth=0.8,
            zorder=3.5, gid="violin-median",
        )


def _bar_cell(
    raw: list[list[list[float]]] | None, rows: list[list[list[int]]] | None, gi: int, si: int,
) -> tuple[np.ndarray, list[int]]:
    """One bar cell's finite raw values and their row indices (a missing or
    length-mismatched row list degrades to ``0..n-1``, as ``point_row_indices``
    does for the box family)."""
    if raw is None:
        return np.empty(0), []
    v = np.asarray(raw[gi][si], dtype=float).ravel()
    mask = np.isfinite(v)
    r = rows[gi][si] if rows is not None and gi < len(rows) and si < len(rows[gi]) else None
    if r is not None and len(r) == v.size:
        return v[mask], [int(x) for x, k in zip(r, mask, strict=True) if k]
    return v[mask], list(range(int(mask.sum())))


def _bar_cell_marks(
    ax: Any, cx: float, mean: float, vals: np.ndarray, rows: list[int], label: str,
    points: str, spread: float, summary: str,
) -> None:
    """One grouped bar's points and summary marker (:func:`overlay_bar_marks`)."""
    b = _box_stats(vals) if vals.size and (points == "outliers" or summary == "median") else None
    if vals.size and points != "none":
        keep = np.ones(vals.size, dtype=bool)
        if b is not None and points == "outliers":
            keep = (vals < b["whislo"]) | (vals > b["whishi"])
        xs = [cx + _jitter(r, label) * spread for r, k in zip(rows, keep, strict=True) if k]
        if xs:
            ax.scatter(xs, vals[keep], s=10, color="0.25", alpha=0.6, zorder=4, linewidths=0)
    if summary == "mean" and np.isfinite(mean):
        ax.plot([cx], [mean], marker="D", color="black", markersize=6, zorder=5)
    elif summary == "median" and b is not None:
        ax.plot([cx], [b["median"]], marker="s", color="black", markersize=5, zorder=5)


def overlay_bar_marks(
    ax: Any,
    centers: np.ndarray,
    half: float,
    labels: list[str],
    means: np.ndarray,
    *,
    points: str | None = None,
    jitter_width: float | None = None,
    summary: str | None = None,
    raw: list[list[list[float]]] | None = None,
    raw_rows: list[list[list[int]]] | None = None,
) -> None:
    """Raw points and the summary marker over GROUPED bars (P2.6 box 1).

    ``centers[g, s]`` is bar (g, s)'s x centre and ``half`` its half-width
    (data units); ``raw[g][s]`` / ``raw_rows[g][s]`` its finite values and
    original row indices. Points: ``"all"``, or ``"outliers"`` (outside the
    cell's own Tukey whiskers), jittered by the SAME ``(row, category)`` hash
    as the box family -- ``labels[g]`` is the category -- scaled by the BAR's
    half-width (the screen's rule: a point sits at the same place relative to
    its bar). Summary: a diamond at the bar's mean (``means``) or a square at
    the cell's median; the bar's own whisker is its error bar, so the diamond
    carries none. The caller draws none of this for stacked bars (neither
    does the screen: a raw value has no place inside a stack)."""
    pts, summ = points or "none", summary or "none"
    if pts not in POINTS_MODES or summ not in SUMMARY_MARKS:
        raise ValueError(f"points must be one of {POINTS_MODES}, summary one of {SUMMARY_MARKS}")
    n_groups, n_series = means.shape
    if raw is not None and (len(raw) != n_groups or any(len(r) != n_series for r in raw)):
        raise ValueError(f"raw must have shape ({n_groups}, {n_series}, n)")
    spread = half * (_LEGACY_JITTER if jitter_width is None else float(jitter_width))
    for gi in range(n_groups):
        for si in range(n_series):
            vals, rows = _bar_cell(raw, raw_rows, gi, si)
            _bar_cell_marks(
                ax, float(centers[gi, si]), float(means[gi, si]), vals, rows, labels[gi],
                pts, spread, summ,
            )
