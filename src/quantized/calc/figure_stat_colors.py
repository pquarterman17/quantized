"""Color-by on the categorical marks -- box / violin / strip / bar (P1.4 residual 3).

The export half of the frontend's ``lib/statColor.ts``. The client sends each
group's colour LEVEL (``color_levels``, aligned with the request's groups;
``None`` = coloured by position, i.e. left to the renderer's own default) and
the palette it paints with, resolved to hex (``palette``); group ``i`` is then
drawn in ``palette[level % len(palette)]`` -- the canvas' ``SERIES_VARS[level
% 8]`` -- at the canvas' own translucency (``BOX_ALPHA`` / ``VIOLIN_ALPHA`` /
``BAR_ALPHA``, ``Stage/statRenderBox.ts`` / ``statRender.ts`` /
``statRenderBar.ts``) and edged in the same colour. With no ``color_levels``
nothing here runs, so every figure without a colour factor is unchanged.

Pure: colours in, matplotlib artists styled.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from matplotlib.colors import to_rgba

__all__ = [
    "BAR_ALPHA",
    "BOX_ALPHA",
    "VIOLIN_ALPHA",
    "bar_colors",
    "check_aligned",
    "color_boxes",
    "color_violins",
    "level_colors",
]

#: The canvas' body fills: ``globalAlpha`` 0.28 (box), 0.32 (violin), 0.75 (bar).
BOX_ALPHA = 0.28
VIOLIN_ALPHA = 0.32
BAR_ALPHA = 0.75


def level_colors(
    levels: Sequence[int | None] | None, palette: Sequence[str] | None,
) -> list[str | None] | None:
    """Each group's colour: ``palette[level % len]``, or matplotlib's own
    ``"C{level}"`` cycle when no palette came (no theme resolved on the
    client). ``None`` in, ``None`` out -- per entry and for the whole list."""
    if levels is None:
        return None
    out: list[str | None] = []
    for lv in levels:
        if lv is None:
            out.append(None)
        elif palette:
            out.append(str(palette[int(lv) % len(palette)]))
        else:
            out.append(f"C{int(lv) % 10}")
    return out


def check_aligned(colors: Sequence[str | None] | None, n: int, what: str) -> None:
    """A level list must be aligned with the groups it colours."""
    if colors is not None and len(colors) != n:
        raise ValueError(f"color_levels must have one entry per {what} ({n}), got {len(colors)}")


def color_boxes(parts: dict[str, list[Any]], colors: Sequence[str | None]) -> None:
    """Style ``ax.boxplot(..., patch_artist=True)``'s artists per box: the body
    filled at ``BOX_ALPHA`` and edged, the whiskers, caps, median and fliers
    in the box's colour (the screen strokes all of them with it)."""
    for i, c in enumerate(colors):
        if c is None:
            continue
        box = parts["boxes"][i]
        box.set_facecolor(to_rgba(c, BOX_ALPHA))
        box.set_edgecolor(c)
        for line in (*parts["whiskers"][2 * i : 2 * i + 2], *parts["caps"][2 * i : 2 * i + 2]):
            line.set_color(c)
        parts["medians"][i].set_color(c)
        if i < len(parts.get("fliers", [])):
            parts["fliers"][i].set_markerfacecolor(c)
            parts["fliers"][i].set_markeredgecolor(c)


def color_violins(parts: dict[str, Any], colors: Sequence[str | None]) -> None:
    """Fill each violin body at ``VIOLIN_ALPHA`` and edge it (the screen's)."""
    for body, c in zip(parts["bodies"], colors, strict=True):
        if c is None:
            continue
        body.set_alpha(None)  # violinplot's own 0.3 would override the fill's alpha
        body.set_facecolor(to_rgba(c, VIOLIN_ALPHA))
        body.set_edgecolor(c)


def bar_colors(colors: Sequence[str | None] | None, series_index: int) -> dict[str, Any]:
    """``ax.bar`` keywords colouring each category's bar of series
    ``series_index`` by its category's colour: filled at ``BAR_ALPHA``, edged
    opaque (the screen's). A category with no colour keeps the series'
    ``"C{i}"``. Empty without colours, so the call is the one it always was."""
    if colors is None:
        return {}
    own = [c or f"C{series_index % 10}" for c in colors]
    return {"color": [to_rgba(c, BAR_ALPHA) for c in own], "edgecolor": own}
