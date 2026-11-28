"""Paired before-after plots: one line per subject from its "before" value to
its "after" value, with an optional mean +- 95 % CI marker on each side.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). Pure numpy/scipy. The
canvas painter (``frontend/src/lib/statPaired.ts``) and the matplotlib export
(``calc.figure_dist3``) both draw :func:`paired_geometry`, pinned by
``tests/fixtures/wire/stat_paired.json``.

Conventions, each stated once here:

- **Pairs.** A subject needs BOTH values finite; a row missing either is dropped
  from the lines, the points and the means together. At least two pairs remain
  or the plot is refused.
- **Positions.** "Before" sits at x = 0 and "after" at x = 1; the X domain is
  ``[-0.5, 1.5]``.
- **CI.** Per side, ``mean +- t(0.975, n - 1) * sd / sqrt(n)`` (the box plot's
  mean CI, ``statplots.box_stats``). It is the CI of each column's mean, not of
  the paired difference.
- **Direction.** With ``direction``, each subject is ``up`` (after > before),
  ``down`` (after < before) or ``same`` (exactly equal), and ``legend`` names the
  three with their counts: "increase (3)", "decrease (2)", "no change (1)".
- **Tolerance.** ``tol`` (absolute, default 0 = exact equality, today's rule) widens "no change":
  with ``d = after - before`` a subject is ``up`` when ``d > tol``, ``down`` when ``d < -tol``
  and ``same`` when ``|d| <= tol``.
- **Y domain.** The finite range of the values (and of the CI bounds when drawn)
  padded by 5 % (``statplots_cdf.padded_domain``).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike
from scipy import stats as sps

from quantized.calc.statplots_cdf import padded_domain

__all__ = [
    "DIRECTIONS", "DIRECTION_LABELS", "paired_directions", "paired_geometry", "paired_series",
]

DIRECTIONS = ("up", "down", "same")
DIRECTION_LABELS = ("increase", "decrease", "no change")


def paired_directions(before: list[float], after: list[float], tol: float = 0.0) -> list[str]:
    """Each subject's ``up`` / ``down`` / ``same``: ``same`` when ``|after - before| <= tol``
    (``tol`` 0 = exact equality)."""
    if not (math.isfinite(tol) and tol >= 0):
        raise ValueError("the no-change tolerance must be a finite number, 0 or more")
    out = []
    for u, v in zip(before, after, strict=True):
        d = v - u
        out.append("up" if d > tol else "down" if d < -tol else "same")
    return out


def paired_series(before: ArrayLike, after: ArrayLike) -> dict[str, Any]:
    """The complete ``before`` / ``after`` pairs and each side's mean and 95 % CI."""
    b = np.asarray(before, dtype=float).ravel()
    a = np.asarray(after, dtype=float).ravel()
    if b.size != a.size:
        raise ValueError("before and after need the same number of rows")
    keep = np.isfinite(b) & np.isfinite(a)
    b, a = b[keep], a[keep]
    if b.size < 2:
        raise ValueError("a paired plot needs at least 2 rows with both values finite")
    n = int(b.size)
    t = float(sps.t.ppf(0.975, n - 1))
    sides = []
    for v in (b, a):
        mean = float(np.mean(v))
        half = t * float(np.std(v, ddof=1)) / float(np.sqrt(n))
        sides.append({"mean": mean, "lo": mean - half, "hi": mean + half})
    return {"n": n, "before": [float(v) for v in b], "after": [float(v) for v in a], "sides": sides}


def paired_geometry(
    result: dict[str, Any], ci: bool = False, direction: bool = False, tol: float = 0.0
) -> dict[str, Any]:
    """The vertices each renderer draws, from a :func:`paired_series` result (or
    its JSON): the ``lines`` ([[0, before], [1, after]] per subject), the two
    point sets, the ``means`` markers (``ci`` only), both domains and, with
    ``direction``, each line's ``directions`` (``tol`` as above) and the ``legend`` rows."""
    b, a = result["before"], result["after"]
    values = [*b, *a]
    means: list[dict[str, float]] = []
    if ci:
        for x, s in enumerate(result["sides"]):
            means.append({"x": float(x), "mean": s["mean"], "lo": s["lo"], "hi": s["hi"]})
            values += [s["lo"], s["hi"]]
    lo, hi = padded_domain([np.asarray(values, dtype=float)])
    geo: dict[str, Any] = {
        "x_domain": [-0.5, 1.5],
        "y_domain": [lo, hi],
        "lines": [[[0.0, u], [1.0, v]] for u, v in zip(b, a, strict=True)],
        "before": [[0.0, u] for u in b],
        "after": [[1.0, v] for v in a],
        "means": means,
    }
    if direction:
        dirs = paired_directions(b, a, tol)
        geo["directions"] = dirs
        geo["legend"] = [
            {"key": k, "label": f"{label} ({dirs.count(k)})"}
            for k, label in zip(DIRECTIONS, DIRECTION_LABELS, strict=True)
        ]
    return geo
