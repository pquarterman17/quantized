"""Export side of the Stat Stage's multi-column histogram (frontend
``Stage/statHistMulti.ts`` + ``statRenderHist.ts``): several columns binned on
shared edges (``calc.statplots.histogram_multi``), each drawn as translucent
bars in its own palette colour (alpha 0.45, opaque edge, like the canvas)
with a legend of the column names (when there is more than one). ``stack`` stacks the series
(``statplots_stack.stack_geometry``) instead of overlaying them, ``percent`` (with ``stack``)
normalises each bin to 100 %."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from matplotlib.colors import to_rgba

from quantized.calc.statplots import histogram_multi
from quantized.calc.statplots_stack import stack_geometry

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
    *,
    stack: bool = False,
    percent: bool = False,
    opts: dict[str, Any] | None = None,
) -> None:
    """``opts`` (a request's ``dist3``) may carry ``stack`` / ``percent`` instead of the flags."""
    stack = stack or bool((opts or {}).get("stack"))
    percent = percent or bool((opts or {}).get("percent"))
    if percent and not stack:
        raise ValueError("a 100 % histogram is a stacked one")
    h = histogram_multi([np.asarray(g, dtype=float).ravel() for g in data], bins=bins)
    edges = np.asarray(h["edges"])
    bars = stack_geometry(h, percent)["bars"] if stack else None
    for i, s in enumerate(h["series"]):
        c = colors[i] if colors and i < len(colors) else None
        kw: dict[str, Any] = (
            {"facecolor": to_rgba(c, 0.45), "edgecolor": c} if c else {"alpha": 0.45}
        )
        heights = [b[3] - b[2] for b in bars[i]] if percent and bars else s["counts"]
        cont = ax.bar(
            edges[:-1], heights, width=np.diff(edges), align="edge", linewidth=0.5,
            bottom=[b[2] for b in bars[i]] if bars else None,
            label=labels[i] if labels and i < len(labels) else f"column {i + 1}", **kw,
        )
        for p in cont.patches:
            p.set_gid(f"hist-bar-{i}")
    if len(h["series"]) > 1:
        ax.legend()
