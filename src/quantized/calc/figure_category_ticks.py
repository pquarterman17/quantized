"""matplotlib half of the Origin category X axis (``calc.axis_categories``).

``lib/categoricalTicks.ts`` is the screen twin: integer positions only, the
cell text at each, and thinning so neighbouring labels never overlap.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from matplotlib.ticker import FixedLocator, Formatter

__all__ = ["CategoryFormatter", "apply_category_axis"]

#: Average glyph width as a fraction of the font size (matches the screen's
#: ``categoricalXAxis`` estimate), plus the gap kept between labels, in points.
_GLYPH_EM = 0.6
_GAP_PT = 8.0


class CategoryFormatter(Formatter):
    """Tick ``x`` -> ``labels[x - base]`` when ``x`` is an in-range integer
    position, else blank (a fractional or out-of-range tick is never labelled)."""

    def __init__(self, labels: Sequence[str], base: int = 1) -> None:
        self.labels = [str(s) for s in labels]
        self.base = int(base)

    def __call__(self, x: float, pos: int | None = None) -> str:
        i = round(x)
        if abs(x - i) > 1e-6 or not 0 <= i - self.base < len(self.labels):
            return ""
        return self.labels[i - self.base]


def category_step(labels: Sequence[str], axis_pt: float, font_pt: float) -> int:
    """Smallest integer step (in categories) at which labels of the longest
    text's width fit side by side across ``axis_pt`` points."""
    longest = max((len(s) for s in labels), default=1)
    slot = longest * font_pt * _GLYPH_EM + _GAP_PT
    pitch = axis_pt / max(len(labels), 1)
    return max(1, math.ceil(slot / pitch)) if pitch > 0 else 1


def apply_category_axis(ax: Any, fmt: Mapping[str, Any]) -> None:
    """Label ``ax``'s X at integer positions with ``fmt["labels"]``, thinned
    to what the axis width holds."""
    labels = [str(s) for s in fmt.get("labels", [])]
    base = int(fmt.get("base", 1))
    fig = ax.figure
    axis_pt = float(ax.get_position().width * fig.get_figwidth() * 72.0)
    font_pt = (
        float(ax.xaxis.get_ticklabels()[0].get_fontsize()) if ax.xaxis.get_ticklabels() else 10.0
    )
    step = category_step(labels, axis_pt, font_pt)
    ax.xaxis.set_major_formatter(CategoryFormatter(labels, base))
    ax.xaxis.set_major_locator(FixedLocator(list(range(base, base + len(labels), step))))
