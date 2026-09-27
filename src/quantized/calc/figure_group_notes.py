"""Group-accounting marks for categorical publication figures (P2.6 box 2).

PRIMARY_SOFTWARE_AUDIT_PLAN P2.6, "missing levels and unbalanced groups are
explicit". Pure matplotlib helpers shared by ``figure_statplots`` (box /
violin / strip), ``figure_categorical`` (bars) and ``figure_facets`` (their
small-multiple grids), so a flat panel and a faceted one mark the SAME things
the SAME way, and the interactive Canvas stage (``statRenderSlots.ts``) has
exactly one export behaviour to agree with:

* :func:`mark_empty_slots` -- an EMPTY category slot (a declared level with no
  usable rows, a level whose Y is all NaN/excluded, a nested combination that
  never occurs) keeps its tick and gets a muted ``n=0`` marker mid-panel. A
  missing level is shown as missing, never silently closed up.
* :func:`annotate_top_counts` -- the optional per-group ``n=K`` annotation,
  drawn as tick labels on a secondary TOP x-axis at the category ticks (the
  screen draws its ``n=`` captions in the same place, above the frame).
* :func:`add_caveat` -- a one-line figure footnote carrying the small-n /
  unbalanced-groups caveat, so summary statistics and error bars on such
  groups never leave the app without it. The TEXT is computed once, by the
  frontend (``lib/groupAxis.balanceCaveat``), and posted verbatim; this module
  only places it.
* :func:`connect_segments` -- where a connect-the-means line must break: at an
  empty slot, and (nested grouping) at every outer-factor boundary, mirroring
  ``lib/statstage.connectMeansBreaks`` on screen.

Every text element is plain ``<text>`` in SVG output (``svg.fonttype = none``
is set by the importing renderers), which is what the structural parity test
(``tests/test_statplot_levels_parity.py``) reads back.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from quantized.calc.figure_labels import safe_mathtext_label

__all__ = [
    "EMPTY_MARKER",
    "NESTED_LABEL_SEP",
    "add_caveat",
    "annotate_top_counts",
    "connect_segments",
    "mark_empty_slots",
    "supxlabel_above_caveat",
]

EMPTY_MARKER = "n=0"
# Mirrors ``lib/statschooser.NESTED_LABEL_SEP`` -- the join between the two
# halves of a nested ``lot = 1 / wafer = 3`` category label.
NESTED_LABEL_SEP = " / "
_MUTED = "0.45"
# The footnote band reserved at the bottom of the figure, as a figure
# fraction, when a caveat is present (``tight_layout(rect=...)``).
CAVEAT_BAND = 0.06
# P2.6 review finding 5: extra figure-fraction room a TIERED faceted grid's
# second tier (outer-level row, drawn per panel by
# `figure_category_axis.style_category_axis`'s `outer.secondary_xaxis`)
# needs below the ticks, so the shared figure-level `supxlabel` -- unlike the
# flat path's `(outer or ax).set_xlabel`, there is no single outer axis to
# attach a faceted grid's x title to -- clears every panel's own second tier
# instead of sitting on top of it.
TIER_BAND = 0.05


def mark_empty_slots(ax: Any, ticks: Sequence[float], empty: Sequence[bool]) -> None:
    """Draw a muted ``n=0`` marker, vertically centred in the panel, at every
    tick whose slot is empty. ``x`` is in data units, ``y`` in axes fraction
    (``get_xaxis_transform``), so the marker sits mid-panel whatever the value
    range is."""
    trans = ax.get_xaxis_transform()
    for tick, is_empty in zip(ticks, empty, strict=True):
        if is_empty:
            ax.text(
                tick, 0.5, EMPTY_MARKER, transform=trans, ha="center", va="center",
                color=_MUTED, fontsize="small", style="italic", zorder=6,
            )


def annotate_top_counts(ax: Any, ticks: Sequence[float], counts: Sequence[int]) -> None:
    """The optional ``n=K`` per-group annotation: tick labels on a secondary
    top x-axis, one per category tick (empty slots read ``n=0``)."""
    sec = ax.secondary_xaxis("top")
    sec.set_xticks(list(ticks))
    sec.set_xticklabels([f"n={int(c)}" for c in counts])
    sec.tick_params(length=0, labelsize="small", colors=_MUTED)


def add_caveat(
    fig: Any, caveat: str | None, tiered: bool = False,
) -> tuple[float, float, float, float] | None:
    """Place ``caveat`` as a one-line italic footnote at the bottom-left of
    ``fig`` and return the ``tight_layout`` rect that keeps the axes clear of
    it (``None`` = no caveat, lay out as before -- byte-identical output).
    De-mathed like every other label (``safe_mathtext_label``): it is a
    free-form API field, and an unbalanced ``$`` must not fail the export.

    ``tiered`` (P2.6 review finding 5, faceted grids only): ``True`` when at
    least one panel drew a two-tier nested axis (its own outer-level row,
    below the ticks) -- reserves :data:`TIER_BAND` more room so the caveat
    (and, via :func:`supxlabel_above_caveat`, the shared x title) cannot sit
    on top of it. Every FLAT caller (single panel) leaves this off: a flat
    plot's x title instead moves onto the outer axis directly
    (``(outer or ax).set_xlabel``, `figure_statplots.py` /
    `figure_categorical.py`), which needs no extra band here."""
    band = CAVEAT_BAND + (TIER_BAND if tiered else 0.0)
    if not caveat:
        return (0.0, band, 1.0, 1.0) if tiered else None
    fig.text(
        0.01, 0.01, safe_mathtext_label(caveat), ha="left", va="bottom", fontsize="small",
        style="italic",
    )
    return (0.0, band, 1.0, 1.0)


def supxlabel_above_caveat(
    fig: Any, x_label: str, caveat: str | None, tiered: bool = False,
) -> None:
    """A figure-level x title (the faceted grids' ``supxlabel``) that clears
    the caveat footnote. ``supxlabel`` sits at figure y=0.01 by default -- the
    footnote's own baseline -- so with a caveat it is lifted to the top of the
    reserved band instead (the axes are laid out above it by the
    ``tight_layout(rect=...)`` ``add_caveat`` returns). Review round 2: the two
    overprinted in every faceted export that carried a caveat.

    ``tiered`` (P2.6 review finding 5): ``True`` lifts it a further
    :data:`TIER_BAND` -- a faceted grid has no single outer axis the way a
    flat plot's ``(outer or ax).set_xlabel`` fix does, so at least one
    panel's own two-tier nested axis needs the shared title pushed clear of
    EVERY panel's second tier instead."""
    if not x_label:
        return
    band = CAVEAT_BAND + (TIER_BAND if tiered else 0.0)
    if caveat or tiered:
        fig.supxlabel(x_label, y=band, va="bottom")
    else:
        fig.supxlabel(x_label)


def _outer(label: str) -> str | None:
    i = label.find(NESTED_LABEL_SEP)
    return None if i < 0 else label[:i]


def connect_segments(
    labels: Sequence[str],
    empty: Sequence[bool],
    breaks: Sequence[bool] | None = None,
    tiers: Sequence[Sequence[str]] | None = None,
) -> list[list[int]]:
    """Slot indices of each connect-means polyline segment, in axis order.

    A segment ends at an empty slot (a line drawn across a missing level
    asserts a trend through data that does not exist) and, for NESTED labels,
    wherever the outer factor changes (the step from ``lot = 0 / wafer = 1``
    to ``lot = 1 / wafer = 0`` crosses into a different lot) -- the export
    twin of ``lib/statstage.connectMeansBreaks``. Single-point segments are
    kept; the caller simply draws nothing for them. ``breaks[i]`` (optional,
    parallel to ``labels``) forces a new segment AT slot ``i``: a HIDDEN empty
    level sat just before it, so the line must still lift there (the screen's
    ``AxisSlot.gapBefore``).

    ``tiers`` (P2.6 review finding 4, optional, parallel to ``labels``): the
    request's own ``[outer, inner]`` pairs (``axis_style.tiers``) -- when
    given, the outer factor is read straight off ``tiers[i][0]`` instead of
    re-splitting ``label`` on the first ``" / "`` (:func:`_outer`), so an
    outer level whose own text contains ``" / "`` (e.g. an alloy composition)
    still breaks at the right boundary instead of inside its own name."""
    segments: list[list[int]] = []
    current: list[int] = []
    prev_outer: str | None = None
    for i, (label, is_empty) in enumerate(zip(labels, empty, strict=True)):
        if is_empty:
            if current:
                segments.append(current)
            current = []
            prev_outer = None
            continue
        outer = str(tiers[i][0]) if tiers is not None and i < len(tiers) else _outer(label)
        forced = breaks is not None and i < len(breaks) and bool(breaks[i])
        nested = outer is not None and prev_outer is not None and outer != prev_outer
        if current and (forced or nested):
            segments.append(current)
            current = []
        current.append(i)
        prev_outer = outer
    if current:
        segments.append(current)
    return segments
