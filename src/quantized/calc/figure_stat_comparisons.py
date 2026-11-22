"""Significance brackets and compact letters over the categorical stat figures
(box / violin / strip / grouped bar), gap audit 8 lane SIG.

The export twin of the Canvas stage's ``statDrawComparisons.ts``. The statistics
and the LAYOUT are the client's (``lib/statComparisons`` + ``Stage/
statCompareLayout``: which pairs, which letters, and where, in axis slots and
data-value coordinates); this module only draws what it is given, so screen and
figure cannot disagree and there is no second test engine here. The footnote
naming the test and correction (``note``) rides the same payload
(``calc.figure_group_notes.footnote_text``).

Payload (``comparisons``)::

    {"note": str,
     "brackets": [{"a": slot, "b": slot, "y": value, "label": str}, ...],
     "letters":  [{"slot": slot, "y": value, "text": str}, ...],
     "tick": value-units, "top": value}

Slots index the axis's category positions (``positions[slot]`` is the x of that
slot: box/violin/strip ticks, or a bar's category centre). Anything out of range
is refused (``ValueError``) rather than drawn wrongly.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

__all__ = ["comparison_note", "draw_comparisons"]


def comparison_note(comparisons: dict[str, Any] | None) -> str | None:
    """The footnote line of a payload (``None`` when absent or blank)."""
    note = (comparisons or {}).get("note")
    return str(note) if note else None


def _slot(positions: Sequence[float], i: Any, what: str) -> float:
    if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(positions):
        raise ValueError(
            f"comparison {what} slot {i!r} is outside the {len(positions)} plotted slots"
        )
    return float(positions[i])


def _finite(v: Any, what: str) -> float:
    f = float(v)
    if not math.isfinite(f):
        raise ValueError(f"comparison {what} must be finite")
    return f


def draw_comparisons(
    ax: Any, comparisons: dict[str, Any] | None, positions: Sequence[float],
) -> None:
    """Draw the payload's brackets (a line with two end ticks, its label above)
    and letters into ``ax``, then widen the y-limits to hold ``top`` (label
    headroom included) so nothing is clipped. ``None`` / empty: no-op."""
    if not comparisons:
        return
    brackets = comparisons.get("brackets") or []
    letters = comparisons.get("letters") or []
    if not brackets and not letters:
        return
    tick = _finite(comparisons.get("tick", 0.0), "tick")
    for b in brackets:
        x1, x2 = _slot(positions, b["a"], "bracket"), _slot(positions, b["b"], "bracket")
        y = _finite(b["y"], "bracket y")
        ax.plot(
            [x1, x1, x2, x2], [y - tick, y, y, y - tick],
            color="black", linewidth=1.0, solid_joinstyle="miter", zorder=6,
            gid="significance-bracket",
        )
        ax.annotate(
            str(b["label"]), ((x1 + x2) / 2, y), xytext=(0, 1), textcoords="offset points",
            ha="center", va="bottom", fontsize="small", color="black", annotation_clip=False,
            zorder=6, gid="significance-label",
        )
    for t in letters:
        x = _slot(positions, t["slot"], "letter")
        ax.annotate(
            str(t["text"]), (x, _finite(t["y"], "letter y")), xytext=(0, 1),
            textcoords="offset points", ha="center", va="bottom", fontsize="small",
            color="black", annotation_clip=False, zorder=6, gid="significance-letter",
        )
    top = comparisons.get("top")
    if top is not None and math.isfinite(float(top)):
        lo, hi = ax.get_ylim()
        if float(top) > hi:
            ax.set_ylim(lo, float(top))
