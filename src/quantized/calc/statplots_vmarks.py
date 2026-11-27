"""Inner marks of a half / split violin: its median and quartile lines.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). The canvas painter
(``frontend/src/lib/statDist3.ts``) and the matplotlib export
(``calc.figure_dist3``) both draw the segments :func:`mark_segments` returns,
pinned by ``tests/fixtures/wire/stat_dist3_variants.json``.

Conventions, each stated once here:

- **Statistics.** The quartiles and the median of a group's finite values with
  numpy's default (linear) interpolation, ``numpy.percentile``.
- **Marks.** ``median`` draws the median line, ``quartiles`` the first and third
  quartile lines, ``both`` all three (``VIOLIN_MARKS``); ``none`` draws none.
- **Segment.** A mark is a horizontal segment at the statistic's value, from the
  axis position to the violin's outline there (the KDE density linearly
  interpolated between its grid points, on the same one density scale as the
  shape), on the side the shape is drawn.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike

__all__ = ["MARK_NAMES", "VIOLIN_MARKS", "mark_segments", "violin_quartiles"]

VIOLIN_MARKS = ("none", "median", "quartiles", "both")
MARK_NAMES: dict[str, tuple[str, ...]] = {
    "none": (),
    "median": ("median",),
    "quartiles": ("q1", "q3"),
    "both": ("q1", "median", "q3"),
}


def violin_quartiles(values: ArrayLike) -> dict[str, float]:
    """``q1``, ``median`` and ``q3`` of the finite values (numpy's linear rule)."""
    v = np.asarray(values, dtype=float).ravel()
    v = v[np.isfinite(v)]
    if v.size == 0:
        raise ValueError("a violin mark needs at least one finite value")
    q1, med, q3 = (float(q) for q in np.percentile(v, [25, 50, 75]))
    return {"q1": q1, "median": med, "q3": q3}


def mark_segments(
    group: dict[str, Any], values: ArrayLike, slot: int, sign: float, scale: float, marks: str
) -> list[dict[str, Any]]:
    """The segments of one violin: ``name``, ``y`` and ``x`` = [axis, outline]."""
    if marks not in VIOLIN_MARKS:
        raise ValueError(f"marks must be one of {VIOLIN_MARKS}")
    if not MARK_NAMES[marks]:
        return []
    stats = violin_quartiles(values)
    grid, dens = np.asarray(group["x"], dtype=float), np.asarray(group["density"], dtype=float)
    out: list[dict[str, Any]] = []
    for name in MARK_NAMES[marks]:
        y = stats[name]
        reach = float(np.interp(y, grid, dens)) * scale
        out.append({"name": name, "y": y, "x": [float(slot), slot + sign * reach]})
    return out

