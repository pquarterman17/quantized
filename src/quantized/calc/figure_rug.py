"""Rug marks for the export: one short tick per finite value along the X axis.

Mirrors ``frontend/src/lib/statRug.ts`` (the canvas side); the vertices come
from ``calc.statplots_cdf.rug_ticks``, so screen and export place the same
ticks. Ticks live in axes-fraction height (``ax.get_xaxis_transform``), never
move the data limits, and carry a ``rug-<k>`` gid so a figure can be audited.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from numpy.typing import ArrayLike

from quantized.calc.statplots_cdf import RUG_LENGTH_DEFAULT, RUG_OPACITY_DEFAULT, rug_ticks
from quantized.heavy_import import heavy_imports

__all__ = ["draw_rug", "resolve_rug"]

_LENGTH = (0.01, 0.25)
_OPACITY = (0.05, 1.0)


def resolve_rug(rug: dict[str, Any] | None) -> tuple[float, float] | None:
    """``(length, opacity)`` of a request's ``rug`` option, or None when off.
    Out-of-range numbers are refused rather than silently clamped."""
    if not rug:
        return None
    length = float(rug.get("length", RUG_LENGTH_DEFAULT))
    opacity = float(rug.get("opacity", RUG_OPACITY_DEFAULT))
    if not _LENGTH[0] <= length <= _LENGTH[1]:
        raise ValueError(f"rug length must be within {_LENGTH}")
    if not _OPACITY[0] <= opacity <= _OPACITY[1]:
        raise ValueError(f"rug opacity must be within {_OPACITY}")
    return length, opacity


def draw_rug(
    ax: Any,
    columns: Sequence[ArrayLike],
    colors: Sequence[str | None] | None,
    rug: dict[str, Any] | None,
) -> int:
    """Draw each column's ticks as its own row; returns the tick count."""
    spec = resolve_rug(rug)
    if spec is None:
        return 0
    length, opacity = spec
    with heavy_imports("matplotlib.collections"):  # lazy: export only
        from matplotlib.collections import LineCollection

    total = 0
    for k, col in enumerate(columns):
        ticks = rug_ticks(col, k, length)
        if not ticks:
            continue
        c = colors[k] if colors and k < len(colors) and colors[k] else f"C{k}"
        lc = LineCollection(
            [[(x, y0), (x, y1)] for x, y0, y1 in ticks],
            colors=[c], alpha=opacity, linewidths=1.0, transform=ax.get_xaxis_transform(),
            gid=f"rug-{k}", zorder=2,
        )
        ax.add_collection(lc, autolim=False)
        total += len(ticks)
    return total
