"""Export side of the Stat Stage's multi-column histogram (frontend
``Stage/statHistMulti.ts`` + ``statRenderHist.ts``): several columns binned on
shared edges (``calc.statplots.histogram_multi``), each drawn as translucent
bars in its own palette colour (alpha 0.45, opaque edge, like the canvas)
with a legend of the column names."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from matplotlib.colors import to_rgba

from quantized.calc.statplots import histogram_multi

__all__ = ["draw_histogram_multi", "is_multi"]


def is_multi(data: Any) -> bool:
    """True when ``data`` is a list of columns rather than one sample."""
    return len(data) > 0 and all(np.ndim(g) >= 1 for g in data)


def draw_histogram_multi(
    ax: Any,
    data: Sequence[Any],
    labels: Sequence[str] | None,
    bins: str | int,
    colors: Sequence[str | None] | None,
) -> None:
    h = histogram_multi([np.asarray(g, dtype=float).ravel() for g in data], bins=bins)
    edges = np.asarray(h["edges"])
    for i, s in enumerate(h["series"]):
        c = colors[i] if colors and i < len(colors) else None
        kw: dict[str, Any] = (
            {"facecolor": to_rgba(c, 0.45), "edgecolor": c} if c else {"alpha": 0.45}
        )
        ax.bar(
            edges[:-1], s["counts"], width=np.diff(edges), align="edge", linewidth=0.5,
            label=labels[i] if labels and i < len(labels) else f"column {i + 1}", **kw,
        )
    ax.legend()
