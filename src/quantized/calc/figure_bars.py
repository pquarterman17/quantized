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

__all__ = ["BAR_FRACTION", "draw_series", "floating_series", "mark_isolated", "stacked_series"]

BAR_FRACTION = 0.6


def _bar_width(xv: NDArray[np.float64]) -> float:
    finite = np.unique(xv[np.isfinite(xv)])
    gaps = np.diff(finite)
    return float(gaps.min()) * BAR_FRACTION if gaps.size else 1.0


def floating_series(
    series: Sequence[tuple[str, Any]],
    series_styles: Sequence[Mapping[str, Any] | None] | None,
) -> Sequence[Mapping[str, Any] | None] | None:
    """Resolve ``float`` (frontend ``lib/uplotStack.floatLowColumn``): a bar
    series flagged ``"high"`` that directly follows one flagged ``"low"`` draws
    its bars from the low series' value to its own (Origin's floating column).
    The high style gains ``stack_base`` (the low values: where a bar starts)
    and the low style is marked ``float_low`` and given ``bars`` so it draws
    nothing of its own. An unpaired flag is left as an ordinary series."""
    if not series_styles or not any(s and s.get("float") for s in series_styles):
        return series_styles
    styles: list[Mapping[str, Any] | None] = list(series_styles)
    for i in range(1, min(len(series), len(styles))):
        hi, lo = styles[i], styles[i - 1]
        if not (hi and lo and hi.get("float") == "high" and lo.get("float") == "low"):
            continue
        if not hi.get("bars"):
            continue
        low = np.asarray(series[i - 1][1], dtype=float)
        if low.shape != np.asarray(series[i][1], dtype=float).shape:
            raise ValueError("A floating column's two series must have one value per X row.")
        styles[i] = {**hi, "stack_base": low}
        styles[i - 1] = {**lo, "bars": lo.get("bars") or True, "float_low": True}
    return styles


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
    come back untouched. A floating column (:func:`floating_series`) is
    resolved first."""
    series_styles = floating_series(series, series_styles)
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


def mark_isolated(
    ax: Any, line: Any, xv: NDArray[np.float64], yv: NDArray[np.float64]
) -> None:
    """Dot the finite points a line cannot reach: both row-neighbours missing
    (a one-row file, an Inf/NaN-bracketed value, a lone reading between gaps).
    ``ax.plot`` draws nothing for them, so a markerless series lost them
    entirely; the screen marks them too (frontend ``isolatedPoints``). A series
    that already has markers is untouched, and the dots stay out of the legend."""
    if line.get_marker() not in ("None", "", None):
        return
    x, y = np.asarray(xv, dtype=float), np.asarray(yv, dtype=float)
    n = min(len(x), len(y))
    ok = np.isfinite(x[:n]) & np.isfinite(y[:n])
    prev = np.concatenate(([False], ok[:-1]))
    nxt = np.concatenate((ok[1:], [False]))
    lone = ok & ~prev & ~nxt
    if lone.any():
        ax.plot(
            x[:n][lone], y[:n][lone], linestyle="none", marker="o", markersize=4,
            color=line.get_color(), zorder=line.get_zorder(), label="_nolegend_",
        )


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
    if spec and spec.get("float_low"):  # a floating column's low end: the high series' bar spans it
        (line,) = ax.plot(xv, yv, label=label, **{**kw, "linestyle": "none", "marker": "none"})
        return line, line.get_color()
    if spec and spec.get("bars"):
        base = spec.get("stack_base")  # stacked: yv is the new total; floating: the low values
        floor = np.zeros(len(xv)) if base is None else np.asarray(base, dtype=float)
        keep = np.isfinite(xv) & np.isfinite(yv) & np.isfinite(floor)
        bars = ax.bar(
            xv[keep], (yv - floor)[keep], width=_bar_width(xv), label=label,
            color=kw.get("color"), alpha=0.7, bottom=floor[keep],
        )
        color = bars.patches[0].get_facecolor() if bars.patches else kw.get("color")
        return bars, color
    (line,) = ax.plot(xv, yv, label=label, **kw)
    mark_isolated(ax, line, xv, yv)
    return line, line.get_color()
