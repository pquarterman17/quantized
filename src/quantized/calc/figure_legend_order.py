"""Legend row order under a waterfall -- the export half of the screen rule.

A waterfall lifts series ``i`` by ``i`` steps, so the LAST staggered series is
the TOP trace. The screen legend lists the top trace first
(``frontend/src/lib/waterfallOffset.ts``'s ``waterfallLegendOrder``, figures
audit #19); matplotlib lists handles in draw order, which put the bottom
curve's name at the top of the exported legend while the screen showed the
reverse. This module is the one place the export applies the same order:

* :func:`waterfall_legend_rows` reads the request's RESOLVED offsets (the same
  list ``calc.plotting.apply_waterfall_offsets`` applies) and answers how many
  leading series are staggered -- everything up to the last series that is
  actually lifted. Series after it (the fit / baseline / peak overlay columns
  the client pads with a zero offset) keep their place, as their rows do on
  screen.
* :func:`with_waterfall_legend` records that count in the override bag under
  :data:`LEGEND_TOP_FIRST`, so it reaches every renderer that already receives
  the bag (single axes, secondary axis, broken axis, page panel) without a new
  argument on each.
* :func:`tag_series_slots` marks each drawn series artist with its display
  slot, and :func:`draw_legend` builds the legend with the staggered slots in
  reverse. Slots, not handle positions: a series with an empty label has no
  legend row, so counting handles would reverse the wrong rows.

With no stagger the bag is returned untouched and :func:`draw_legend` makes
the exact ``ax.legend`` call the renderers made before, so an ordinary export
is byte-identical.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

__all__ = [
    "LEGEND_TOP_FIRST",
    "draw_legend",
    "preset_legend_kwargs",
    "tag_series_slots",
    "top_first_order",
    "waterfall_legend_rows",
    "with_waterfall_legend",
]

# Override-bag key: the number of leading series whose legend rows run top
# trace first. Internal -- written by ``with_waterfall_legend`` only.
LEGEND_TOP_FIRST = "legend_top_first"

_SLOT_ATTR = "_qz_legend_slot"


def waterfall_legend_rows(offsets: Sequence[float | None] | None) -> int:
    """How many leading series a waterfall staggers: one past the last finite,
    non-zero offset. ``0`` when nothing is lifted (no offsets, all zero, or
    only non-finite entries -- which ``apply_waterfall_offsets`` skips too)."""
    last = -1
    for i, raw in enumerate(offsets or ()):
        if raw is None:
            continue
        dy = float(raw)
        if dy != 0.0 and math.isfinite(dy):
            last = i
    return last + 1


def with_waterfall_legend(
    overrides: dict[str, Any] | None, offsets: Sequence[float | None] | None
) -> dict[str, Any] | None:
    """``overrides`` with the waterfall legend order recorded, or ``overrides``
    itself (same object, ``None`` included) when nothing is staggered."""
    rows = waterfall_legend_rows(offsets)
    if rows < 2:
        return overrides
    return {**(overrides or {}), LEGEND_TOP_FIRST: rows}


def preset_legend_kwargs(st: Any) -> dict[str, Any]:
    """The preset's own legend (no ``legend`` override): its frame, font size
    and location -- every preset's location is a matplotlib location string."""
    return {"frameon": st.legend_box, "fontsize": st.legend_font_size, "loc": st.legend_location}


def tag_series_slots(artists: Sequence[Any], slots: Sequence[int] | None = None) -> None:
    """Mark each series artist with its display slot (its index in the
    request's series list). ``slots`` overrides the default ``0..n-1`` for a
    renderer that draws a subset of the series on one axes (secondary axis)."""
    for i, artist in enumerate(artists):
        setattr(artist, _SLOT_ATTR, slots[i] if slots is not None else i)


def top_first_order(slots: Sequence[int | None], rows: int) -> list[int]:
    """The handle permutation that lists the staggered series (slot < ``rows``)
    top trace first: their positions keep the same set of places, filled in
    descending slot order. Every other handle keeps its place."""
    order = list(range(len(slots)))
    staggered = [k for k, slot in enumerate(slots) if slot is not None and slot < rows]
    by_top = sorted(staggered, key=lambda k: -(slots[k] or 0))
    for place, source in zip(staggered, by_top, strict=True):
        order[place] = source
    return order


def draw_legend(
    ax: Any, ov: Mapping[str, Any], kw: Mapping[str, Any], handles: Sequence[Any] | None = None
) -> Any:
    """``ax.legend`` for ``kw``, with the waterfall's top-first row order when
    the bag carries one. ``handles`` is the explicit handle list of a renderer
    that assembles its own (secondary axis, broken axis); ``None`` takes the
    axes' labelled artists, as a bare ``ax.legend(**kw)`` does."""
    rows = int(ov.get(LEGEND_TOP_FIRST) or 0)
    if handles is None:
        if rows < 2:
            return ax.legend(**kw)
        found, _ = ax.get_legend_handles_labels()
        if not found:
            return ax.legend(**kw)
        handles = found
    listed = list(handles)
    if rows >= 2:
        order = top_first_order([getattr(h, _SLOT_ATTR, None) for h in listed], rows)
        listed = [listed[i] for i in order]
    return ax.legend(listed, [h.get_label() for h in listed], **kw)
