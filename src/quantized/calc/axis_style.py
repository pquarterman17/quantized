"""The Axis dialog's axis-look fields for matplotlib export (gap-audit-2 #5).

The export half of ``frontend/src/lib/axisStyleExtras.ts``. Each field rides
the same ``AxisFormat`` mapping as ``calc.axis_extras`` (``x_fmt`` /
``y_fmt`` / ``y2_fmt``), but is applied LATE -- after the limits, the
plot-wide grid and the overrides -- because each one replaces something
those steps set:

* ``reverse`` -- a Y / Y2 axis drawn high-to-low (X keeps ``x_reversed``).
* ``grid`` -- ``{"major", "minor", "color", "dash"}``: this axis' grid lines,
  replacing the plot-wide grid on/off for this axis only.
* ``rotate`` -- X tick labels rotated counter-clockwise, anchored at their
  end as the screen draws them.
* ``offset`` -- the axis line, ticks and labels pushed outward by that many
  points. The frame line stays where it was, as on screen and in Origin.
* ``top`` -- a second X axis along the top (``calc.axis_top``).

Pure: matplotlib objects in, nothing returned; an absent or malformed field
leaves matplotlib's behaviour as it was.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from matplotlib.lines import Line2D
from matplotlib.ticker import AutoMinorLocator

from quantized.calc.axis_top import apply_top_axis

__all__ = ["DASHES", "apply_axis_style"]

# Dash patterns in points -- the screen's `GRID_DASH` (in px at 96/72).
DASHES: dict[str, tuple[float, tuple[float, float]] | str] = {
    "solid": "-",
    "dash": (0.0, (4.0, 2.5)),
    "dot": (0.0, (1.0, 2.0)),
}
_OUTWARD_EDGE = {
    "bottom": (0.0, 1.0, 0.0, 0.0),
    "left": (0.0, 0.0, 0.0, 1.0),
    "right": (1.0, 1.0, 0.0, 1.0),
}


def _number(v: Any, lo: float, hi: float) -> float | None:
    ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    return float(v) if ok and lo <= v <= hi else None


def _apply_grid(ax: Any, which: str, axis: Any, fmt: Mapping[str, Any], grid_alpha: float) -> None:
    grid = fmt.get("grid")
    if not isinstance(grid, Mapping):
        return
    ax.grid(False, which="both", axis=which)
    color = grid.get("color")
    style = DASHES.get(str(grid.get("dash")), "-")
    base_alpha = 1.0 if isinstance(color, str) else (grid_alpha or 0.3)
    kw: dict[str, Any] = {"linestyle": style, "linewidth": 0.8}
    if isinstance(color, str):
        kw["color"] = color
    if grid.get("major"):
        ax.grid(True, which="major", axis=which, alpha=base_alpha, **kw)
    if grid.get("minor") and axis.get_scale() == "linear":
        if not isinstance(fmt.get("minor"), int) or not fmt.get("minor"):
            # Minor grid lines with no minor ticks asked for: one line midway
            # between majors, with no minor tick marks (the screen's rule).
            axis.set_minor_locator(AutoMinorLocator(2))
            ax.tick_params(axis=which, which="minor", length=0)
        ax.grid(True, which="minor", axis=which, alpha=base_alpha * 0.5, **kw)


def _apply_offset(ax: Any, side: str, offset: float) -> None:
    spine = ax.spines[side]
    if spine.get_visible():
        # The frame line stays at the plot edge; only the axis moves.
        x0, x1, y0, y1 = _OUTWARD_EDGE[side]
        ax.add_line(
            Line2D(
                [x0, x1],
                [y0, y1],
                transform=ax.transAxes,
                color=spine.get_edgecolor(),
                linewidth=spine.get_linewidth(),
                clip_on=False,
                zorder=spine.get_zorder(),
            )
        )
    spine.set_visible(True)
    spine.set_position(("outward", offset))


def apply_axis_style(
    ax: Any,
    which: str,
    fmt: Mapping[str, Any] | None,
    *,
    side: str,
    grid_alpha: float = 0.0,
) -> None:
    """Apply ``fmt``'s axis-look fields (module doc) to ``ax``'s ``which``
    ("x" / "y") axis, drawn on ``side`` ("bottom" / "left" / "right")."""
    if not fmt:
        return
    axis = ax.xaxis if which == "x" else ax.yaxis
    if which == "y" and fmt.get("reverse") is True and not ax.yaxis_inverted():
        ax.invert_yaxis()
    _apply_grid(ax, which, axis, fmt, grid_alpha)
    rotate = _number(fmt.get("rotate"), -90, 90)
    if which == "x" and rotate:
        # "xtick" anchors each label at its end, as the canvas draws one.
        ax.tick_params(axis="x", labelrotation=rotate, labelrotation_mode="xtick")
    offset = _number(fmt.get("offset"), 0, 72)
    if offset and side in _OUTWARD_EDGE:
        _apply_offset(ax, side, offset)
    if which == "x" and isinstance(fmt.get("top"), Mapping):
        size = _number(fmt.get("size"), 0, 72)
        apply_top_axis(ax, fmt["top"], label_size=size or None)
