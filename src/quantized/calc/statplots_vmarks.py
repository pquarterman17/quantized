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
- **Mean marker.** ``violin_mean`` is ``numpy.mean`` of the finite values, drawn as one
  point at ``MEAN_OFFSET`` from the axis on the side the shape is drawn (so a split
  violin's two levels each show their own).
- **Rain.** The raw finite values as points beside a HALF violin, on the side opposite the
  shape (a raincloud plot). A point's Y is its value; its X is the axis position moved
  ``RAIN_GAP`` + ``RAIN_WIDTH`` * (u + 1) / 2 outward, ``u`` being
  ``statplots.deterministic_jitter(i, "rain<slot>")`` with ``i`` the value's index in the
  group's list (non-finite values keep their index and draw no point), so the jitter is
  seeded: the same on screen and in the export, and no point moves when another is dropped.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.statplots import deterministic_jitter

__all__ = [
    "MARK_NAMES", "MEAN_OFFSET", "RAIN_GAP", "RAIN_WIDTH", "VIOLIN_MARKS", "mark_segments",
    "rain_points", "violin_mean", "violin_quartiles",
]

MEAN_OFFSET = 0.05
RAIN_GAP = 0.08
RAIN_WIDTH = 0.25

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



def violin_mean(values: ArrayLike) -> float:
    """``numpy.mean`` of the finite values."""
    v = np.asarray(values, dtype=float).ravel()
    v = v[np.isfinite(v)]
    if v.size == 0:
        raise ValueError("a violin mean marker needs at least one finite value")
    return float(np.mean(v))


def rain_points(values: ArrayLike, slot: int, sign: float) -> list[list[float]]:
    """The raincloud points of one half violin drawn on side ``sign`` (+1 right, -1 left):
    ``[x, y]`` per finite value, on the opposite side, seeded jitter (see the module doc)."""
    v = np.asarray(values, dtype=float).ravel()
    seed = f"rain{slot}"
    out: list[list[float]] = []
    for i, y in enumerate(v):
        if np.isfinite(y):
            u = deterministic_jitter(i, seed)
            out.append([slot - sign * (RAIN_GAP + RAIN_WIDTH * (u + 1.0) / 2.0), float(y)])
    return out
