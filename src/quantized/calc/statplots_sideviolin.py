"""Half and split violins: a violin drawn on one side of its axis position.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). Each shape is the
Gaussian KDE the violin plot already draws (``statplots.violin_kde``, reached
through ``statplots_ridgeline.ridgeline_series``), so a half is exactly one half
of a full violin's outline. The canvas painter (``frontend/src/lib/statSideViolin.ts``)
and the matplotlib export (``calc.figure_dist3``) both draw
:func:`sideviolin_geometry`, pinned by ``tests/fixtures/wire/stat_sideviolin.json``.

Conventions, each stated once here:

- **Half violin.** One group per axis position, drawn on its RIGHT side only.
- **Split violin.** Two groups share an axis position back to back: the first
  level on the LEFT, the second on the RIGHT. A position may hold one side only
  (a level with no data there); two groups never claim the same side.
- **Width.** One density scale for every group: the TALLEST density of any group
  reaches ``SIDE_HALF_WIDTH`` position units from the axis, so shapes are
  comparable in area, not each stretched to the same width.
- **Position.** Positions are 0..m-1, the X domain ``[-0.5, m - 0.5]``; the Y
  domain is the union of the curves' ranges (each spans its data extended by the
  KDE ``cut``).
- **Colour.** A half violin takes the colour of its position, a split violin the
  colour of its SIDE (0 = left, 1 = right), so one colour always means one level.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

__all__ = ["SIDES", "SIDE_HALF_WIDTH", "SIDE_STYLES", "sideviolin_geometry", "sideviolin_layout"]

SIDES = ("left", "right")
SIDE_STYLES = ("half", "split")
SIDE_HALF_WIDTH = 0.45


def sideviolin_layout(
    slots: Sequence[int], sides: Sequence[str], n_groups: int
) -> tuple[list[int], list[str], int]:
    """Validate a request's per-group ``slots`` / ``sides`` and return them with
    the position count. Refuses a mismatch or two groups on one side."""
    if len(slots) != n_groups or len(sides) != n_groups:
        raise ValueError(f"slots and sides need one entry per group ({n_groups})")
    seen: set[tuple[int, str]] = set()
    for i, (p, s) in enumerate(zip(slots, sides, strict=True)):
        if isinstance(p, bool) or not isinstance(p, int) or p < 0:
            raise ValueError(f"group {i + 1}: slot must be a non-negative integer")
        if s not in SIDES:
            raise ValueError(f"group {i + 1}: side must be one of {SIDES}")
        if (p, s) in seen:
            raise ValueError(f"group {i + 1}: position {p} already has a {s} side")
        seen.add((p, s))
    return list(slots), list(sides), (max(slots) + 1 if slots else 0)


def sideviolin_geometry(
    result: dict[str, Any], slots: Sequence[int], sides: Sequence[str], style: str = "half"
) -> dict[str, Any]:
    """The vertices each renderer draws, from a ``ridgeline_series`` result (or
    its JSON): ``x_domain``, ``y_domain`` and per group its ``slot``, ``side``,
    ``color`` index, closed ``fill`` polygon and open ``line`` outline."""
    if style not in SIDE_STYLES:
        raise ValueError(f"style must be one of {SIDE_STYLES}")
    groups = result["groups"]
    slots, sides, m = sideviolin_layout(slots, sides, len(groups))
    scale = SIDE_HALF_WIDTH / result["d_max"]
    violins: list[dict[str, Any]] = []
    for g, p, s in zip(groups, slots, sides, strict=True):
        sign = -1.0 if s == "left" else 1.0
        line = [[p + sign * d * scale, x] for x, d in zip(g["x"], g["density"], strict=True)]
        fill = [[float(p), line[0][1]], *line, [float(p), line[-1][1]]]
        color = (0 if s == "left" else 1) if style == "split" else p
        violins.append({"slot": p, "side": s, "color": color, "fill": fill, "line": line})
    return {
        "x_domain": [-0.5, m - 0.5], "y_domain": result["domain"], "slots": m, "violins": violins,
    }
