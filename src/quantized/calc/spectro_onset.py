"""Peak / edge onset (gap audit 9, G21): two common definitions.

* **Tangent intersection** (the extrapolated onset of thermal analysis, e.g.
  ASTM E794 for DSC; cited as a convention, unverified, owner to check): the
  intersection of the fitted **baseline** line with the **tangent at the point
  of steepest slope** of the leading edge.
* **Threshold fraction**: the first X where the baseline-subtracted signal
  reaches ``fraction`` of its extreme (peak top / plateau), by linear
  interpolation between samples.

``side`` says which end of the window holds the baseline: ``"left"`` (the edge
rises toward larger X, the default) or ``"right"`` (mirror image). The
baseline is the least-squares line through the rows in the ``baseline`` X range
(default: the outer 10 % of the window's X span on that side; provisional,
owner to confirm). The edge to analyse is searched between the baseline range
and the extreme of the baseline-subtracted signal (the peak top, or for a step
the plateau's largest value, which noise can inflate). ``smooth`` (odd, rows;
1 = none) applies a Savitzky-Golay (order 2) filter used for the slope, the top
and the threshold. Uneven X is allowed (slopes use ``np.gradient`` on X).
Pure numpy/scipy.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from scipy.signal import savgol_filter

__all__ = ["peak_onset"]

Vec = NDArray[np.float64]
Side = Literal["left", "right"]


def _prepare(x: Vec, y: Vec, window: tuple[float | None, float | None]) -> tuple[Vec, Vec]:
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    if not (np.isfinite(xv).all() and np.isfinite(yv).all()):
        raise ValueError("onset needs a finite X and Y on every row (blank rows are refused)")
    d = np.diff(xv)
    if xv.size < 2 or not (np.all(d > 0) or np.all(d < 0)):
        raise ValueError("onset needs a strictly monotonic X")
    if d[0] < 0:
        xv, yv = xv[::-1], yv[::-1]
    lo, hi = window
    keep = np.ones(xv.size, dtype=bool)
    if lo is not None:
        keep &= xv >= lo
    if hi is not None:
        keep &= xv <= hi
    if lo is not None and hi is not None and lo >= hi:
        raise ValueError("window minimum must be below its maximum")
    xv, yv = xv[keep], yv[keep]
    if xv.size < 8:
        raise ValueError("the window holds fewer than 8 rows")
    return xv, yv


def peak_onset(
    x: Vec,
    y: Vec,
    *,
    side: Side = "left",
    window: tuple[float | None, float | None] = (None, None),
    baseline: tuple[float, float] | None = None,
    fraction: float = 0.1,
    smooth: int = 1,
) -> dict[str, Any]:
    """Onset by tangent intersection and by threshold fraction (see module doc)."""
    if side not in ("left", "right"):
        raise ValueError("side must be left or right")
    if not 0.0 < fraction < 1.0:
        raise ValueError("the threshold fraction must be between 0 and 1")
    xv, yv = _prepare(x, y, window)
    n = xv.size
    if int(smooth) != smooth or smooth < 1 or (smooth > 1 and smooth % 2 == 0):
        raise ValueError("smoothing must be 1 (none) or an odd whole number of rows")
    if smooth > 1:
        if smooth > n or smooth <= 2:
            raise ValueError("smoothing window must be 5 or more and no longer than the window")
        ys = np.asarray(savgol_filter(yv, int(smooth), 2), dtype=float)
    else:
        ys = yv
    span = float(xv[-1] - xv[0])
    if baseline is None:
        b_lo, b_hi = (
            (xv[0], xv[0] + 0.1 * span) if side == "left" else (xv[-1] - 0.1 * span, xv[-1])
        )
    else:
        b_lo, b_hi = float(baseline[0]), float(baseline[1])
        if not b_lo < b_hi:
            raise ValueError("baseline minimum must be below its maximum")
    bmask = (xv >= b_lo) & (xv <= b_hi)
    if int(bmask.sum()) < 3:
        raise ValueError("the baseline range holds fewer than 3 rows")
    bidx = np.flatnonzero(bmask)
    slope_b, icpt_b = np.polyfit(xv[bmask], yv[bmask], 1)
    base = icpt_b + slope_b * xv
    d = ys - base
    # Search region: beyond the baseline rows, on the far side.
    region = np.arange(bidx[-1] + 1, n) if side == "left" else np.arange(0, bidx[0])
    if region.size < 3:
        raise ValueError("no room beyond the baseline range for an edge; shrink the baseline range")
    k_local = int(np.argmax(np.abs(d[region])))
    k = int(region[k_local])
    sgn = 1.0 if d[k] >= 0 else -1.0
    if abs(d[k]) == 0:
        raise ValueError("the signal never leaves the baseline; there is no edge")
    edge = np.arange(bidx[-1], k + 1) if side == "left" else np.arange(k, bidx[0] + 1)
    if edge.size < 3:
        raise ValueError("the edge spans fewer than 3 rows; use a wider window or finer data")
    g = np.gradient(ys, xv)
    dirn = 1.0 if side == "left" else -1.0
    score = dirn * sgn * g[edge]
    s_local = int(np.argmax(score))
    s = int(edge[s_local])
    if score[s_local] <= 0:
        raise ValueError("no rising edge found between the baseline and the extreme")
    gs = float(g[s])
    denom = gs - float(slope_b)
    if abs(denom) <= 1e-12 * max(abs(gs), abs(slope_b), 1e-300):
        raise ValueError("the steepest tangent is parallel to the baseline")
    x_on = (icpt_b - ys[s] + gs * xv[s]) / denom
    y_on = icpt_b + slope_b * x_on
    # Threshold crossing, scanned from the baseline side toward the extreme.
    level = fraction * float(d[k])
    path = np.arange(bidx[-1], k + 1) if side == "left" else np.arange(bidx[0], k - 1, -1)
    target = sgn * level  # > 0: the level in the direction of the extreme
    sd = sgn * d[path]
    hit = np.flatnonzero(sd >= target)
    if hit.size == 0:  # pragma: no cover - the extreme itself always reaches the level
        raise ValueError("the threshold level was not reached")
    j = int(hit[0])
    if j == 0:
        x_th = float(xv[path[0]])
    else:
        a, b = path[j - 1], path[j]
        x_th = float(xv[a] + (level - d[a]) / (d[b] - d[a]) * (xv[b] - xv[a]))
    tangent = ys[s] + gs * (xv - xv[s])
    return {
        "side": side,
        "x": xv,
        "baseline_line": base,
        "tangent_line": tangent,
        "baseline": {
            "slope": float(slope_b),
            "intercept": float(icpt_b),
            "lo": float(b_lo),
            "hi": float(b_hi),
        },
        "top": {"x": float(xv[k]), "y": float(ys[k]), "height": float(d[k])},
        "tangent": {
            "x_onset": float(x_on),
            "y_onset": float(y_on),
            "slope": gs,
            "x_steepest": float(xv[s]),
            "y_steepest": float(ys[s]),
        },
        "threshold": {
            "x_onset": x_th,
            "y_onset": float(icpt_b + slope_b * x_th + level),
            "fraction": float(fraction),
            "level": level,
        },
    }
