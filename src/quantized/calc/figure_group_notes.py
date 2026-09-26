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
]

EMPTY_MARKER = "n=0"
# Mirrors ``lib/statschooser.NESTED_LABEL_SEP`` -- the join between the two
# halves of a nested ``lot = 1 / wafer = 3`` category label.
NESTED_LABEL_SEP = " / "
_MUTED = "0.45"
# The footnote band reserved at the bottom of the figure, as a figure
# fraction, when a caveat is present (``tight_layout(rect=...)``).
CAVEAT_BAND = 0.06


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


def add_caveat(fig: Any, caveat: str | None) -> tuple[float, float, float, float] | None:
    """Place ``caveat`` as a one-line italic footnote at the bottom-left of
    ``fig`` and return the ``tight_layout`` rect that keeps the axes clear of
    it (``None`` = no caveat, lay out as before -- byte-identical output).
    De-mathed like every other label (``safe_mathtext_label``): it is a
    free-form API field, and an unbalanced ``$`` must not fail the export."""
    if not caveat:
        return None
    fig.text(
        0.01, 0.01, safe_mathtext_label(caveat), ha="left", va="bottom", fontsize="small",
        style="italic",
    )
    return (0.0, CAVEAT_BAND, 1.0, 1.0)


def _outer(label: str) -> str | None:
    i = label.find(NESTED_LABEL_SEP)
    return None if i < 0 else label[:i]


def connect_segments(labels: Sequence[str], empty: Sequence[bool]) -> list[list[int]]:
    """Slot indices of each connect-means polyline segment, in axis order.

    A segment ends at an empty slot (a line drawn across a missing level
    asserts a trend through data that does not exist) and, for NESTED labels,
    wherever the outer factor changes (the step from ``lot = 0 / wafer = 1``
    to ``lot = 1 / wafer = 0`` crosses into a different lot) -- the export
    twin of ``lib/statstage.connectMeansBreaks``. Single-point segments are
    kept; the caller simply draws nothing for them."""
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
        outer = _outer(label)
        if current and outer is not None and prev_outer is not None and outer != prev_outer:
            segments.append(current)
            current = []
        current.append(i)
        prev_outer = outer
    if current:
        segments.append(current)
    return segments
