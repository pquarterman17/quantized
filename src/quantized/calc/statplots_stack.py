"""Stacked histograms: several columns binned on shared edges, their bars stacked.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). The counts come from
``statplots.histogram_multi`` (the bin rule runs on the pooled values), so a
stacked histogram has exactly the bins the side-by-side multi-column histogram
has. The canvas painter (``Stage/statRenderHist.ts``) and the matplotlib export
(``calc.figure_hist_multi``) both draw :func:`stack_geometry`, pinned by
``tests/fixtures/wire/stat_stackhist.json``.

Series ``k`` sits on top of series ``0..k-1`` in every bin: a bar is
``[x0, x1, base, top]`` with ``base`` the running total below it. ``y_max`` is
the tallest stack.
"""

from __future__ import annotations

from typing import Any

__all__ = ["stack_geometry"]


def stack_geometry(result: dict[str, Any]) -> dict[str, Any]:
    """The stacked bars of a ``histogram_multi`` result (or its JSON)."""
    edges = result["edges"]
    running = [0.0] * (len(edges) - 1)
    bars: list[list[list[float]]] = []
    for s in result["series"]:
        row = []
        for i, c in enumerate(s["counts"]):
            row.append([edges[i], edges[i + 1], running[i], running[i] + c])
            running[i] += c
        bars.append(row)
    return {"edges": edges, "bars": bars, "y_max": max(running)}
