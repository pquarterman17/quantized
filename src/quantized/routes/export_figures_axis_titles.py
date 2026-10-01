"""``FigureRequest``'s axis-title wire fields (Format + drag, screen == export).

The canvas draws each axis title with its right-click Format choices
(``PlotView.axisLabelStyles``: size, bold, italic) at its dragged offset
(``PlotView.axisLabelOffsets``); these two fields carry both, and
:func:`request_overrides` folds them into the override bag as the one
``axis_titles`` map ``calc.figure_axis_titles`` applies (the flat figure, its
secondary axis, and a page panel). A faceted request never sends them: the
Stage's facet grid draws neither. A broken-x figure ignores them, as its
canvas panels do (``calc.figure_break``). Split out of ``export_figures.py``
for its 500-line ceiling, as a mixin like ``ExcludedRowsFields``.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

__all__ = ["AxisLabelStyle", "AxisTitleFields", "request_overrides"]

AxisKey = Literal["x", "y", "y2"]


class AxisLabelStyle(BaseModel):
    """One axis title's Format choices; an absent field keeps the preset's."""

    size: float | None = Field(
        default=None, gt=0, le=200,
        description="Font size: the screen's CSS px, read as points (the annotation `size` rule).",
    )
    bold: bool | None = None
    italic: bool | None = None


class AxisTitleFields(BaseModel):
    """The two axis-title fields, mixed into ``FigureRequest``."""

    axis_label_styles: dict[AxisKey, AxisLabelStyle] | None = Field(
        default=None,
        description="Per-axis title Format (size / bold / italic), as the canvas draws it.",
    )
    axis_label_offsets: dict[AxisKey, tuple[float, float]] | None = Field(
        default=None,
        description=(
            "Per-axis dragged title offset `[dx, dy]` in screen CSS px (x right, y DOWN), "
            "read as points like every other screen-px size on this request."
        ),
    )


def request_overrides(req: Any) -> dict[str, Any] | None:
    """``req.overrides`` with the axis-title fields folded in as
    ``axis_titles`` (``calc.figure_axis_titles``' shape); ``req.overrides``
    itself when the request sets neither."""
    styles: dict[str, AxisLabelStyle] = req.axis_label_styles or {}
    offsets: dict[str, tuple[float, float]] = req.axis_label_offsets or {}
    if not styles and not offsets:
        overrides: dict[str, Any] | None = req.overrides
        return overrides
    titles: dict[str, dict[str, Any]] = {}
    for key in ("x", "y", "y2"):
        entry: dict[str, Any] = {}
        if key in styles:
            entry.update(styles[key].model_dump(exclude_none=True))
        if key in offsets:
            entry["offset"] = [float(offsets[key][0]), float(offsets[key][1])]
        if entry:
            titles[key] = entry
    return {**(req.overrides or {}), "axis_titles": titles}
