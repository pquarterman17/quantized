"""Ridgeline plots: stacked, offset density curves, one per group.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). Each curve is the
Gaussian KDE the violin plot already draws (``statplots.violin_kde``), so a
ridge is exactly a violin's half-outline with the same bandwidth rule. The
canvas painter (``frontend/src/lib/statRidgeline.ts``) and the matplotlib
export (``calc.figure_dist2``) both draw :func:`ridgeline_geometry`, pinned by
``tests/fixtures/wire/stat_ridgeline.json``.

Conventions, each stated once here:

- **Bandwidth.** ``"scott"`` or ``"silverman"`` (scipy's rules), or a positive
  number: scipy's scalar ``bw_method``, the factor that multiplies the sample's
  standard deviation (smaller = wigglier). Every group uses the same setting.
- **Density scale.** One scale for every group, so a ridge's height is its
  density and areas stay comparable: the TALLEST peak of any group is
  ``overlap`` row spacings high. ``overlap = 1`` just touches the next ridge
  up; larger values overlap it.
- **Rows.** The first group is the TOP ridge (reading order); baselines sit at
  ``n - 1 - k``, one unit apart. Ridges are listed in drawing order (top ridge
  first), so a lower ridge is painted over the one above it.
- **Each curve** spans its own data extended by ``cut`` bandwidths, so the
  X domain is the union of the curves' ranges.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.statplots import violin_kde

__all__ = [
    "RIDGE_BW_NAMES",
    "RIDGE_OVERLAP_MAX",
    "RIDGE_PAD",
    "RIDGE_POINTS",
    "ridgeline_geometry",
    "ridgeline_series",
]

RIDGE_BW_NAMES = ("scott", "silverman")
RIDGE_POINTS = 256
RIDGE_OVERLAP_MAX = 5.0
RIDGE_PAD = 0.05  # headroom below the bottom baseline and above the top peak
_MAX_GROUPS = 64


def _bw(bw: str | float) -> str | float:
    if isinstance(bw, str):
        if bw not in RIDGE_BW_NAMES:
            raise ValueError(f"bandwidth must be one of {RIDGE_BW_NAMES} or a positive number")
        return bw
    if isinstance(bw, bool) or not math.isfinite(bw) or bw <= 0:
        raise ValueError(f"bandwidth must be one of {RIDGE_BW_NAMES} or a positive number")
    return float(bw)


def ridgeline_series(
    groups: Sequence[ArrayLike],
    *,
    bw: str | float = "scott",
    n_points: int = RIDGE_POINTS,
    cut: float = 2.0,
) -> dict[str, Any]:
    """The KDE of every group on its own grid, plus the shared ``domain`` and
    the tallest ``d_max``. A group needs at least two distinct finite values;
    one that has fewer is refused by number (a density of nothing has no ridge)."""
    if not 1 <= len(groups) <= _MAX_GROUPS:
        raise ValueError(f"a ridgeline plot takes 1 to {_MAX_GROUPS} groups")
    method = _bw(bw)
    out: list[dict[str, Any]] = []
    for i, g in enumerate(groups):
        v = np.asarray(g, dtype=float).ravel()
        v = v[np.isfinite(v)]
        if v.size < 2 or float(np.ptp(v)) == 0.0:
            raise ValueError(f"group {i + 1} needs at least 2 distinct finite values")
        k = violin_kde(v, bw_method=method, n_points=n_points, cut=cut)
        out.append({"n": k["n"], "x": k["x"], "density": k["density"], "bandwidth": k["bandwidth"]})
    return {
        "bw": method,
        "domain": [min(g["x"][0] for g in out), max(g["x"][-1] for g in out)],
        "d_max": max(max(g["density"]) for g in out),
        "groups": out,
    }


def ridgeline_geometry(result: dict[str, Any], overlap: float = 1.0) -> dict[str, Any]:
    """The vertices each renderer draws, from a :func:`ridgeline_series` result
    (or its JSON): the ``y_domain``, the ``baselines`` (top row first) and per
    ridge its closed ``fill`` polygon and open ``line`` curve."""
    if not math.isfinite(overlap) or not 0 < overlap <= RIDGE_OVERLAP_MAX:
        raise ValueError(f"overlap must be within (0, {RIDGE_OVERLAP_MAX}]")
    groups = result["groups"]
    n = len(groups)
    scale = overlap / result["d_max"]
    ridges: list[dict[str, Any]] = []
    baselines: list[float] = []
    for k, g in enumerate(groups):
        base = float(n - 1 - k)
        baselines.append(base)
        line = [[x, base + d * scale] for x, d in zip(g["x"], g["density"], strict=True)]
        fill = [[line[0][0], base], *line, [line[-1][0], base]]
        ridges.append({"base": base, "fill": fill, "line": line})
    return {
        "domain": result["domain"],
        "y_domain": [-RIDGE_PAD, n - 1 + overlap + RIDGE_PAD],
        "baselines": baselines,
        "ridges": ridges,
    }
