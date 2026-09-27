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
    )


def scatter_points(
    ax: Any,
    groups: list[np.ndarray],
    labels: list[str],
    ticks: list[int],
    row_indices: list[list[int]],
    marks: StatMarks,
    box_stats: list[dict[str, Any]] | None = None,
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
    byte-identical to before this fix."""
    if marks.scatter is None:
        return
    spread = marks.half_width * marks.jitter_width
    stats = box_stats if box_stats is not None else [None] * len(groups)
    for g, lab, tick, idx, cached in zip(groups, labels, ticks, row_indices, stats, strict=True):
        if g.size == 0:
            continue
        keep = np.ones(g.size, dtype=bool)
        if marks.scatter == "outliers":
            b = cached if cached is not None else _box_stats(g)
            keep = (g < b["whislo"]) | (g > b["whishi"])
        if not keep.any():
            continue
        xs = [tick + _jitter(i, lab) * spread for i, k in zip(idx, keep, strict=True) if k]
        ax.scatter(xs, g[keep], s=10, color="0.25", alpha=0.6, zorder=4, linewidths=0)


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
