"""Marker size driven by a column (gap audit 3, N5) for the publication renderer.

``size_by`` (a per-row array, resolved from a channel index by
``calc.plotting.resolve_style_channels``) maps each point's marker DIAMETER
linearly over the array's finite range onto ``size_range`` (``[min, max]``
points, default :data:`DEFAULT_SIZE_RANGE`); matplotlib's ``s`` is the squared
diameter. The canvas rule is ``lib/sizescatter.ts``'s ``sizeDiameter`` (same
linear map; a constant column reads mid-range; a non-finite value draws no
point). :func:`add_size_legend` adds a size key (a second legend titled
``size_label``) so the mapping is legible.

Pure layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.heavy_import import heavy_imports

__all__ = ["DEFAULT_SIZE_RANGE", "add_size_legend", "size_diameters"]

#: Marker diameter range (points) for ``size_by`` -- ``lib/sizescatter.ts``'s
#: ``DEFAULT_SIZE_RANGE``.
DEFAULT_SIZE_RANGE = (3.0, 14.0)


def _range(spec: Mapping[str, Any]) -> tuple[float, float]:
    raw = spec.get("size_range")
    if isinstance(raw, (list, tuple)) and len(raw) == 2:
        try:
            lo, hi = float(raw[0]), float(raw[1])
        except (TypeError, ValueError):
            return DEFAULT_SIZE_RANGE
        if math.isfinite(lo) and math.isfinite(hi) and 0 < lo <= hi:
            return lo, hi
    return DEFAULT_SIZE_RANGE


def _size_lim(spec: Mapping[str, Any]) -> tuple[float, float] | None:
    z = np.asarray(spec.get("size_by", ()), dtype=float)
    fin = z[np.isfinite(z)]
    return (float(fin.min()), float(fin.max())) if fin.size else None


def size_diameters(spec: Mapping[str, Any] | None, n: int) -> NDArray[np.float64] | None:
    """Per-point marker diameters (points) for ``n`` rows, NaN where the size
    value is non-finite or missing; ``None`` when the style has no ``size_by``."""
    if not spec or spec.get("size_by") is None:
        return None
    lim = _size_lim(spec)
    z = np.full(n, np.nan)
    raw = np.asarray(spec["size_by"], dtype=float)[:n]
    z[: len(raw)] = raw
    if lim is None:
        return np.full(n, np.nan)
    lo, hi = _range(spec)
    span = lim[1] - lim[0]
    t = np.full(n, 0.5) if span <= 0 else (z - lim[0]) / span
    t = np.where(np.isfinite(z), t, np.nan)
    return np.asarray(lo + t * (hi - lo), dtype=float)


def add_size_legend(ax: Any, spec: Mapping[str, Any], color: Any, marker: str = "o") -> None:
    """The size key: three markers (data min, middle, max) in a second legend
    titled ``size_label``. ``add_artist`` keeps it when the series legend is
    (re)built afterwards."""
    lim = _size_lim(spec)
    if lim is None:
        return
    lo, hi = _range(spec)
    vals = [lim[0], (lim[0] + lim[1]) / 2, lim[1]] if lim[1] > lim[0] else [lim[0]]
    diam = [lo, (lo + hi) / 2, hi] if lim[1] > lim[0] else [(lo + hi) / 2]
    with heavy_imports("matplotlib.legend", "matplotlib.lines"):
        from matplotlib.legend import Legend
        from matplotlib.lines import Line2D
    handles = [
        Line2D([], [], linestyle="none", marker=marker, markersize=d, color=color,
               markerfacecolor="none" if spec.get("marker_fill") == "hollow" else color)
        for d in diam
    ]
    leg = Legend(
        ax, handles, [f"{v:.3g}" for v in vals], title=str(spec.get("size_label") or "") or None,
        loc="lower right", frameon=False, labelspacing=1.0,
    )
    ax.add_artist(leg)
