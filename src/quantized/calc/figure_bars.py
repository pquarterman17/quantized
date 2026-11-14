"""Export side of ``SeriesStyle.bars`` (an Origin column / bar graph drawn
as bars from zero at each X — frontend ``lib/uplotBars.ts``).

The bar width follows the screen's rule: 60% of the smallest gap between
neighbouring X values (a lone point gets a width of 1 in data units). Every
other series keeps the ordinary ``ax.plot`` line.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["BAR_FRACTION", "draw_series"]

BAR_FRACTION = 0.6


def _bar_width(xv: NDArray[np.float64]) -> float:
    finite = np.unique(xv[np.isfinite(xv)])
    gaps = np.diff(finite)
    return float(gaps.min()) * BAR_FRACTION if gaps.size else 1.0


def draw_series(
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    label: str,
    kw: dict[str, Any],
    spec: Mapping[str, Any] | None,
) -> tuple[Any, Any]:
    """``(artist, colour)`` for one series: ``ax.bar`` when its style asks for
    bars, else the usual ``ax.plot`` line."""
    if spec and spec.get("bars"):
        keep = np.isfinite(xv) & np.isfinite(yv)
        bars = ax.bar(
            xv[keep], yv[keep], width=_bar_width(xv), label=label, color=kw.get("color"),
            alpha=0.7,
        )
        color = bars.patches[0].get_facecolor() if bars.patches else kw.get("color")
        return bars, color
    (line,) = ax.plot(xv, yv, label=label, **kw)
    return line, line.get_color()
