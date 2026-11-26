"""Marginal plots: a scatter with the distribution of each axis drawn beside it.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). Pure numpy; the
distributions come from the primitives the Stat Stage already uses
(``statplots.histogram``, ``statplots.box_stats``, ``statplots_cdf.rug_ticks``),
so a marginal is exactly the histogram / box / rug a one-column plot of the same
values would show. The canvas painter (``frontend/src/lib/statMarginal.ts``) and
the matplotlib export (``calc.figure_dist2``) both draw :func:`marginal_geometry`,
pinned by ``tests/fixtures/wire/stat_marginal.json``.

Conventions, each stated once here:

- **Points.** A point needs BOTH coordinates finite; a row with either missing
  is dropped from the scatter AND from both marginals, so the three panels
  always describe the same rows.
- **Domain.** Each axis spans its finite range padded by 5 % (a constant column
  gets +-0.5), the rule the CDF plot uses. The marginal strips share it.
- **Layout.** The top strip is ``MARGINAL_RATIO`` of the plot's height, the
  right strip that fraction of its width, with a ``MARGINAL_GAP`` gap, all
  measured against the whole plot area. The canvas and the export use the same
  fractions.
- **Strip coordinates.** Along the strip the axis is data units; across it the
  value runs 0..1 from the edge touching the scatter outward. A histogram bar is
  as tall as ``HIST_PEAK * count / max count``, a box spans ``BOX_BAND``, and a
  rug tick spans ``RUG_BAND``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.statplots import box_stats, histogram
from quantized.calc.statplots_cdf import padded_domain, rug_ticks

__all__ = [
    "BOX_BAND",
    "HIST_PEAK",
    "MARGINAL_GAP",
    "MARGINAL_KINDS",
    "MARGINAL_RATIO",
    "RUG_BAND",
    "marginal_geometry",
    "marginal_series",
]

MARGINAL_KINDS = ("histogram", "box", "rug")
MARGINAL_RATIO = 0.2
MARGINAL_GAP = 0.02
HIST_PEAK = 0.9
BOX_BAND = (0.25, 0.75)
RUG_BAND = (0.0, 0.5)


def _pairs(
    x: ArrayLike, y: ArrayLike
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    xs = np.asarray(x, dtype=float).ravel()
    ys = np.asarray(y, dtype=float).ravel()
    if xs.size != ys.size:
        raise ValueError("x and y must have the same number of values")
    keep = np.isfinite(xs) & np.isfinite(ys)
    return xs[keep], ys[keep]


def _distribution(values: NDArray[np.float64], kind: str, bins: str | int) -> dict[str, Any]:
    if kind == "histogram":
        h = histogram(values, bins=bins)
        return {"edges": h["edges"], "counts": h["counts"]}
    if kind == "box":
        b = box_stats(values)
        return {k: b[k] for k in ("q1", "median", "q3", "whislo", "whishi", "fliers")}
    return {}  # rug: the ticks are the points themselves


def marginal_series(
    x: ArrayLike, y: ArrayLike, *, kind: str = "histogram", bins: str | int = "fd"
) -> dict[str, Any]:
    """Everything a marginal plot of ``(x, y)`` draws: the complete finite
    pairs, each axis's padded domain and its marginal distribution (``edges`` /
    ``counts`` for a histogram, the five box numbers and fliers for a box,
    nothing for a rug). Needs at least two complete points."""
    if kind not in MARGINAL_KINDS:
        raise ValueError(f"marginal kind must be one of {MARGINAL_KINDS}")
    xs, ys = _pairs(x, y)
    if xs.size < 2:
        raise ValueError("a marginal plot needs at least 2 complete (x, y) points")
    return {
        "kind": kind,
        "n": int(xs.size),
        "x": [float(v) for v in xs],
        "y": [float(v) for v in ys],
        "domain": {"x": list(padded_domain([xs])), "y": list(padded_domain([ys]))},
        "marginals": {
            "x": _distribution(xs, kind, bins),
            "y": _distribution(ys, kind, bins),
        },
    }


def _strip(kind: str, m: dict[str, Any], values: list[float]) -> dict[str, Any]:
    if kind == "histogram":
        counts = m["counts"]
        top = max(counts) or 1.0
        edges = m["edges"]
        bars = [
            [edges[i], edges[i + 1], HIST_PEAK * counts[i] / top] for i in range(len(counts))
        ]
        return {"kind": kind, "bars": bars}
    if kind == "box":
        return {
            "kind": kind,
            "box": [m["q1"], m["q3"]],
            "median": m["median"],
            "whiskers": [m["whislo"], m["whishi"]],
            "fliers": list(m["fliers"]),
        }
    length = RUG_BAND[1] - RUG_BAND[0]
    return {"kind": kind, "ticks": [list(t) for t in rug_ticks(values, 0, length)]}


def marginal_geometry(result: dict[str, Any]) -> dict[str, Any]:
    """The vertices each renderer draws, from a :func:`marginal_series` result
    (or its JSON): the scatter ``points``, and per axis a strip in strip
    coordinates (see the module docstring)."""
    kind = result["kind"]
    return {
        "domain": result["domain"],
        "points": [[a, b] for a, b in zip(result["x"], result["y"], strict=True)],
        "strips": {
            "x": _strip(kind, result["marginals"]["x"], result["x"]),
            "y": _strip(kind, result["marginals"]["y"], result["y"]),
        },
    }
