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
    if not spec or not isinstance(spec.get("size_by"), (list, tuple, np.ndarray)):
        return None  # absent, or an unresolved channel index / junk: no sizing
    lim = _size_lim(spec)
    z = np.full(n, np.nan)
    raw = np.asarray(spec["size_by"], dtype=float)[:n]
    z[: len(raw)] = raw
    if lim is None:
        return None  # no finite size value: the series draws normal markers, as on screen
    lo, hi = _range(spec)
    span = lim[1] - lim[0]
    t = np.full(n, 0.5) if span <= 0 else (z - lim[0]) / span
    t = np.where(np.isfinite(z), t, np.nan)
    return np.asarray(lo + t * (hi - lo), dtype=float)


def add_size_legend(ax: Any, spec: Mapping[str, Any], color: Any, marker: str = "o") -> None:
    """The size key: three markers (data min, middle, max) in a legend titled
    ``size_label``, bottom right. ONE key per distinct (title, range, size range) on the
    figure (series sized by the same column share it), and further keys stack upward from
    the first instead of overprinting it. ``add_artist`` keeps each when the series legend
    is (re)built afterwards."""
    lim = _size_lim(spec)
    if lim is None:
        return
    lo, hi = _range(spec)
    vals = [lim[0], (lim[0] + lim[1]) / 2, lim[1]] if lim[1] > lim[0] else [lim[0]]
    diam = [lo, (lo + hi) / 2, hi] if lim[1] > lim[0] else [(lo + hi) / 2]
    title = str(spec.get("size_label") or "")
    fig = ax.figure
    placed: list[tuple[Any, float]] = fig.__dict__.setdefault("_qz_size_keys", [])
    key = (title, lim, (lo, hi))
    if any(k == key for k, _ in placed):
        return
    with heavy_imports("matplotlib.legend", "matplotlib.lines", "matplotlib.transforms"):
        from matplotlib.legend import Legend
        from matplotlib.lines import Line2D
        from matplotlib.transforms import ScaledTranslation
    handles = [
        Line2D([], [], linestyle="none", marker=marker, markersize=d, color=color,
               markerfacecolor="none" if spec.get("marker_fill") == "hollow" else color)
        for d in diam
    ]
    below = sum(h for _, h in placed)  # points already used by earlier keys
    leg = Legend(
        ax, handles, [f"{v:.3g}" for v in vals], title=title or None,
        loc="lower right", frameon=False, labelspacing=1.0,
        bbox_to_anchor=(1.0, 0.0),
        bbox_transform=ax.transAxes + ScaledTranslation(0.0, below / 72.0, fig.dpi_scale_trans),
    )
    ax.add_artist(leg)
    rows = sum(max(d, 10.0) + 10.0 for d in diam)
    placed.append((key, rows + 28.0))  # rows + title + padding, in points
