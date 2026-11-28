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
- **Side.** A half violin sits on the side its ``sides`` entry names: RIGHT by
  default, LEFT when asked (``Stage`` "left half"); the shape is the mirror image.
- **Inner marks.** ``marks`` adds each violin's median and / or quartile segments
  (``statplots_vmarks``): ``violin["marks"]`` is present only when marks are drawn.
- **Mean and rain.** ``mean`` adds each violin's mean marker (``violin["mean"]``), ``rain`` its
  raw points (``violin["rain"]``, half violins only: a split violin has no free side);
  both read ``data`` and are absent unless asked (``statplots_vmarks``).
- **Colour.** A half violin takes the colour of its position, a split violin the
  colour of its SIDE (0 = left, 1 = right), so one colour always means one level.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from quantized.calc.statplots_vmarks import (
    MEAN_OFFSET,
    VIOLIN_MARKS,
    mark_segments,
    rain_points,
    violin_mean,
)

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
    result: dict[str, Any],
    slots: Sequence[int],
    sides: Sequence[str],
    style: str = "half",
    *,
    data: Sequence[Any] | None = None,
    marks: str = "none",
    mean: bool = False,
    rain: bool = False,
) -> dict[str, Any]:
    """The vertices each renderer draws, from a ``ridgeline_series`` result (or
    its JSON): ``x_domain``, ``y_domain`` and per group its ``slot``, ``side``,
    ``color`` index, closed ``fill`` polygon and open ``line`` outline, plus its
    ``marks`` segments when ``marks`` asks for any, its ``mean`` marker and its ``rain``
    points when asked (``data`` = each group's values)."""
    if style not in SIDE_STYLES:
        raise ValueError(f"style must be one of {SIDE_STYLES}")
    if marks not in VIOLIN_MARKS:
        raise ValueError(f"marks must be one of {VIOLIN_MARKS}")
    if (marks != "none" or mean or rain) and (data is None or len(data) != len(result["groups"])):
        raise ValueError("inner marks, the mean marker and rain points need each group's values")
    if rain and style != "half":
        raise ValueError("rain points are drawn beside a half violin, not a split one")
    groups = result["groups"]
    slots, sides, m = sideviolin_layout(slots, sides, len(groups))
    scale = SIDE_HALF_WIDTH / result["d_max"]
    violins: list[dict[str, Any]] = []
    for k, (g, p, s) in enumerate(zip(groups, slots, sides, strict=True)):
        sign = -1.0 if s == "left" else 1.0
        line = [[p + sign * d * scale, x] for x, d in zip(g["x"], g["density"], strict=True)]
        fill = [[float(p), line[0][1]], *line, [float(p), line[-1][1]]]
        color = (0 if s == "left" else 1) if style == "split" else p
        violin: dict[str, Any] = {"slot": p, "side": s, "color": color, "fill": fill, "line": line}
        if marks != "none" and data is not None:
            violin["marks"] = mark_segments(g, data[k], p, sign, scale, marks)
        if mean and data is not None:
            violin["mean"] = {"x": p + sign * MEAN_OFFSET, "y": violin_mean(data[k])}
        if rain and data is not None:
            violin["rain"] = rain_points(data[k], p, sign)
        violins.append(violin)
    return {
        "x_domain": [-0.5, m - 0.5], "y_domain": result["domain"], "slots": m, "violins": violins,
    }
