"""Lollipop (dot) plots: one dot per category, joined to the baseline by a stem.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). Pure numpy. The canvas
painter (``frontend/src/lib/statLollipop.ts``) and the matplotlib export
(``calc.figure_dist3``) both draw :func:`lollipop_geometry`, pinned by
``tests/fixtures/wire/stat_lollipop.json``.

Conventions, each stated once here:

- **Value.** The mean or the median of a group's finite values (``stat``); a
  group with none is refused by number.
- **Order.** ``sort`` is ``"none"`` (the groups' own order), ``"asc"`` or
  ``"desc"``; ties keep the groups' own order, so the three languages agree.
- **Baseline.** The stems start at 0, so the Y domain always contains 0 and is
  padded by 5 % of its span on both sides (a span of 0 pads by 1).
- **Positions.** Dot ``k`` of the sorted list sits at x = k, the X domain is
  ``[-0.5, n - 0.5]``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

__all__ = ["LOLLIPOP_SORTS", "LOLLIPOP_STATS", "lollipop_geometry", "lollipop_series"]

LOLLIPOP_STATS = ("mean", "median")
LOLLIPOP_SORTS = ("none", "asc", "desc")
_PAD = 0.05
_MAX_GROUPS = 500


def lollipop_series(
    groups: Sequence[ArrayLike], *, stat: str = "mean", sort: str = "none"
) -> dict[str, Any]:
    """Each group's ``value`` and ``n`` (in the groups' own order) and the
    display ``order`` (indices into the groups, after sorting)."""
    if stat not in LOLLIPOP_STATS:
        raise ValueError(f"stat must be one of {LOLLIPOP_STATS}")
    if sort not in LOLLIPOP_SORTS:
        raise ValueError(f"sort must be one of {LOLLIPOP_SORTS}")
    if not 1 <= len(groups) <= _MAX_GROUPS:
        raise ValueError(f"a lollipop plot takes 1 to {_MAX_GROUPS} groups")
    values: list[float] = []
    counts: list[int] = []
    for i, g in enumerate(groups):
        v = np.asarray(g, dtype=float).ravel()
        v = v[np.isfinite(v)]
        if v.size == 0:
            raise ValueError(f"group {i + 1} has no finite value")
        values.append(float(np.mean(v) if stat == "mean" else np.median(v)))
        counts.append(int(v.size))
    order = list(range(len(values)))
    if sort != "none":
        order.sort(key=lambda i: values[i], reverse=sort == "desc")  # stable both ways
    return {"stat": stat, "sort": sort, "values": values, "n": counts, "order": order}


def lollipop_geometry(result: dict[str, Any]) -> dict[str, Any]:
    """The vertices each renderer draws, from a :func:`lollipop_series` result
    (or its JSON): the ``stems`` ([[k, 0], [k, v]]), the ``dots`` and both
    domains, in display order."""
    vals = [result["values"][i] for i in result["order"]]
    lo, hi = min(0.0, *vals), max(0.0, *vals)
    pad = _PAD * (hi - lo) if hi > lo else 1.0
    return {
        "x_domain": [-0.5, len(vals) - 0.5],
        "y_domain": [lo - pad, hi + pad],
        "stems": [[[float(k), 0.0], [float(k), v]] for k, v in enumerate(vals)],
        "dots": [[float(k), v] for k, v in enumerate(vals)],
    }
