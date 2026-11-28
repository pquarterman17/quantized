"""Rug marks on an XY series (plan item 20): a short tick for every finite point
along the X axis (``rug: "x"``), the Y axis (``"y"``) or both.

The canvas twin is ``frontend/src/lib/uplotRug.ts``: ticks of ``rug_length`` (a
fraction of the plot height for X ticks, of its width for Y ticks, default
:data:`RUG_LENGTH`) at ``rug_opacity``, in the series colour, from the axis
edge inward. Ticks live in axes-fraction coordinates on one side and data
coordinates on the other, so they never move the data limits. An unknown
``rug`` mode draws nothing (a figure never fails on a mark); an out-of-range
length or opacity falls back to its default.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.statplots_cdf import RUG_LENGTH_DEFAULT, RUG_OPACITY_DEFAULT
from quantized.heavy_import import heavy_imports

__all__ = ["RUG_MODES", "draw_series_rug", "rug_mode"]

RUG_MODES = ("x", "y", "both")


def rug_mode(spec: Mapping[str, Any] | None) -> str | None:
    """The series' valid rug mode, or None."""
    mode = spec.get("rug") if spec else None
    return str(mode) if mode in RUG_MODES else None


def _within(v: Any, lo: float, hi: float, default: float) -> float:
    ok = isinstance(v, int | float) and not isinstance(v, bool) and lo <= v <= hi
    return float(v) if ok else default


def draw_series_rug(
    ax: Any, xv: NDArray[np.float64], yv: NDArray[np.float64],
    spec: Mapping[str, Any] | None, color: Any,
) -> int:
    """Draw ``spec``'s rug for one series; returns the tick count."""
    mode = rug_mode(spec)
    if spec is None or mode is None:
        return 0
    with heavy_imports("matplotlib.collections"):  # lazy: export only
        from matplotlib.collections import LineCollection

    length = _within(spec.get("rug_length"), 0.01, 0.25, RUG_LENGTH_DEFAULT)
    opacity = _within(spec.get("rug_opacity"), 0.05, 1.0, RUG_OPACITY_DEFAULT)
    total = 0
    ok = np.isfinite(xv) & np.isfinite(yv)  # a point needs both coordinates, as on the canvas
    for axis, vals, transform in (
        ("x", xv, ax.get_xaxis_transform()),
        ("y", yv, ax.get_yaxis_transform()),
    ):
        if mode not in (axis, "both"):
            continue
        finite = np.asarray(vals, dtype=float)[ok]
        segs = [
            [(v, 0.0), (v, length)] if axis == "x" else [(0.0, v), (length, v)]
            for v in finite
        ]
        if segs:
            ax.add_collection(
                LineCollection(
                    segs, colors=[color], alpha=opacity, linewidths=1.0, transform=transform,
                    gid=f"series-rug-{axis}", zorder=1,
                ),
                autolim=False,
            )
            total += len(segs)
    return total
