"""Export side of ``SeriesStyle.bars`` (an Origin column / bar graph drawn
as bars from zero at each X — frontend ``lib/uplotBars.ts``).

The bar width follows the screen's rule: 60% of the smallest gap between
neighbouring X values (a lone point gets a width of 1 in data units). Every
other series keeps the ordinary ``ax.plot`` line.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["BAR_FRACTION", "draw_series", "stacked_series"]

BAR_FRACTION = 0.6


def _bar_width(xv: NDArray[np.float64]) -> float:
    finite = np.unique(xv[np.isfinite(xv)])
    gaps = np.diff(finite)
    return float(gaps.min()) * BAR_FRACTION if gaps.size else 1.0


def stacked_series(
    xv: NDArray[np.float64],
    series: Sequence[tuple[str, Any]],
    series_styles: Sequence[Mapping[str, Any] | None] | None,
) -> tuple[Sequence[tuple[str, Any]], Sequence[Mapping[str, Any] | None] | None]:
    """Resolve ``stack`` (frontend ``lib/uplotStack.ts``): a stacked series sits
    on the running total of the stacked series before it (a missing value adds
    nothing). Its y becomes the NEW total (so the line, the error bars and the
    autoscale follow it) and its style gains ``stack_base`` (the total below),
    where a bar starts and a fill-under begins. Without ``stack`` the inputs
    come back untouched."""
    if not series_styles or not any(s and s.get("stack") for s in series_styles):
        return series, series_styles
    total = np.zeros(len(xv))
    out: list[tuple[str, Any]] = []
    styles: list[Mapping[str, Any] | None] = []
    for i, (label, y) in enumerate(series):
        spec = series_styles[i] if i < len(series_styles) else None
        if not spec or not spec.get("stack"):
            out.append((label, y))
            styles.append(spec)
            continue
        yv = np.asarray(y, dtype=float)
        if yv.shape != total.shape:
            raise ValueError("A stacked series must have one value per X row.")
        out.append((label, total + yv))  # NaN where this series has no value
        styles.append({**spec, "stack_base": total.copy()})
        total = total + np.where(np.isfinite(yv), yv, 0.0)
    return out, styles


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
        base = spec.get("stack_base")  # a stacked bar: yv is the new total
        floor = np.zeros(len(xv)) if base is None else np.asarray(base, dtype=float)
        bars = ax.bar(
            xv[keep], (yv - floor)[keep], width=_bar_width(xv), label=label,
            color=kw.get("color"), alpha=0.7, bottom=floor[keep],
        )
        color = bars.patches[0].get_facecolor() if bars.patches else kw.get("color")
        return bars, color
    (line,) = ax.plot(xv, yv, label=label, **kw)
    return line, line.get_color()
