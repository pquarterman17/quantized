"""matplotlib half of the Origin category X axis (``calc.axis_categories``).

``lib/categoricalTicks.ts`` is the screen twin: integer positions only, the
cell text at each, and thinning so neighbouring labels never overlap.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from matplotlib.ticker import Formatter, Locator

__all__ = ["CategoryFormatter", "CategoryLocator", "apply_category_axis", "category_step"]

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


def category_step(
    labels: Sequence[str], axis_pt: float, font_pt: float, span: float | None = None
) -> int:
    """Smallest integer step (in categories) at which labels of the longest
    text's width fit side by side across ``axis_pt`` points showing ``span``
    X units (default: one unit per label). The screen computes the same
    ``ceil(slot / pitch)`` from uPlot's px per unit (``categoricalXAxis``)."""
    longest = max((len(s) for s in labels), default=1)
    slot = longest * font_pt * _GLYPH_EM + _GAP_PT
    pitch = axis_pt / (span if span and span > 0 else max(len(labels), 1))
    return max(1, math.ceil(slot / pitch - 1e-9)) if pitch > 0 else 1


class CategoryLocator(Locator):
    """Integer category positions every ``category_step`` from ``base``, the
    step computed at DRAW time from the axis's own view interval and width
    (an axis range set after the format, e.g. Origin's 0.5..12.5, counts)."""

    def __init__(self, labels: Sequence[str], base: int, font_pt: float) -> None:
        self.labels = [str(s) for s in labels]
        self.base = int(base)
        self.font_pt = font_pt

    def __call__(self) -> list[float]:
        axis: Any = self.axis  # a real matplotlib Axis once the locator is set on one
        lo, hi = sorted(axis.get_view_interval()) if axis else (self.base, self.base)
        ax: Any = getattr(axis, "axes", None)
        axis_pt = float(ax.get_position().width * ax.figure.get_figwidth() * 72.0) if ax else 0.0
        step = category_step(self.labels, axis_pt, self.font_pt, hi - lo)
        first = self.base + max(0, math.ceil((lo - self.base - 1e-9) / step)) * step
        last = min(hi + 1e-9, self.base + len(self.labels) - 1)
        out: list[float] = []
        v = first
        while v <= last and len(out) < 10_000:
            out.append(float(v))
            v += step
        return out


def apply_category_axis(ax: Any, fmt: Mapping[str, Any]) -> None:
    """Label ``ax``'s X at integer positions with ``fmt["labels"]``, thinned
    to what the axis width holds."""
    labels = [str(s) for s in fmt.get("labels", [])]
    base = int(fmt.get("base", 1))
    font_pt = (
        float(ax.xaxis.get_ticklabels()[0].get_fontsize()) if ax.xaxis.get_ticklabels() else 10.0
    )
    ax.xaxis.set_major_formatter(CategoryFormatter(labels, base))
    ax.xaxis.set_major_locator(CategoryLocator(labels, base, font_pt))
