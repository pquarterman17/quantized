"""Measurements on raw curves: intersection, level crossings, rise / fall time.

Pure calc layer (numpy only). Every function treats a curve as the piecewise
linear interpolant through its samples, which is how a plotted line is drawn,
so a reported position is where the *drawn* line crosses, not a fitted model.
Inputs are never modified.

Shared curve preparation (``_prepare``): X and Y must be equal-length, finite
(or, with ``nonfinite="drop"``, the non-finite pairs are removed and counted),
and hold at least two points. The curve is sorted by X (stable), and samples
that share an X are merged into their mean Y, because a vertical segment has no
single interpolated value. The number of merged samples is reported.

Methods
-------
* :func:`intersect_curves` -- both curves are interpolated onto the union of
  their X samples inside the overlapping X range. Their difference is
  piecewise linear on that grid, so linear interpolation of the difference
  between neighbouring grid points is exact, not an approximation.
* :func:`level_crossings` -- every X where one curve passes through a Y level,
  by linear interpolation inside the segment that straddles the level, with an
  optional dead band (hysteresis, a Schmitt trigger) so noise near the level
  does not produce a burst of crossings.
* :func:`step_time` -- the time between two fractions of a step height
  (default 10 % and 90 %), from the interpolated crossings of the two levels;
  the base and top levels are IEEE 181 histogram state levels (``step_levels``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.step_edge import median_up_edge
from quantized.calc.step_levels import PlateauMethod, plateau_levels

__all__ = [
    "Crossing",
    "Intersection",
    "IntersectionResult",
    "LevelCrossingResult",
    "StepTimeResult",
    "intersect_curves",
    "level_crossings",
    "step_time",
]

NonFinite = Literal["error", "drop"]
Direction = Literal["rising", "falling"]
Edge = Literal["auto", "rise", "fall"]

_MIN_POINTS = 2
_STEP_MIN_POINTS = 5


@dataclass(frozen=True)
class Crossing:
    """One level crossing: its X and whether the curve rose or fell through it."""

    x: float
    direction: Direction


@dataclass(frozen=True)
class LevelCrossingResult:
    """Every crossing of ``level`` in ascending X, plus how the curve was read."""

    level: float
    hysteresis: float
    crossings: tuple[Crossing, ...]
    n_points: int
    dropped: int
    merged_duplicates: int


@dataclass(frozen=True)
class Intersection:
    """One place the two curves meet.

    ``kind`` is ``"cross"`` (A - B changes sign), ``"touch"`` (they meet and
    separate again on the same side) or ``"coincident"`` (they agree over the
    stretch ``x`` to ``x_end``; ``x`` is where it starts). ``direction`` is the
    way A - B changes sign at a crossing (``"rising"`` = A goes from below B to
    above it) and ``None`` otherwise.
    """

    x: float
    y: float
    kind: Literal["cross", "touch", "coincident"]
    direction: Direction | None
    x_end: float


@dataclass(frozen=True)
class IntersectionResult:
    intersections: tuple[Intersection, ...]
    x_min: float
    x_max: float
    n_grid: int
    dropped_a: int
    dropped_b: int
    merged_a: int
    merged_b: int


@dataclass(frozen=True)
class StepTimeResult:
    """A rise or fall time and the two positions it is the difference of.

    ``x_low`` / ``x_high`` are where the curve crosses the low / high reference
    level (for a fall, ``x_high`` comes first). ``time`` is positive.
    """

    edge: Literal["rise", "fall"]
    time: float
    x_low: float
    x_high: float
    low_fraction: float
    high_fraction: float
    low_plateau: float
    high_plateau: float
    low_level: float
    high_level: float
    plateaus_estimated: tuple[bool, bool]
    plateau_method: PlateauMethod
    n_points: int
    dropped: int
    merged_duplicates: int


# --------------------------------------------------------------------------- #
# Preparation
# --------------------------------------------------------------------------- #


def _prepare(
    x: ArrayLike, y: ArrayLike, name: str, nonfinite: NonFinite, min_points: int = _MIN_POINTS
) -> tuple[NDArray[np.float64], NDArray[np.float64], int, int]:
    """Validated, X-sorted curve with duplicate X merged: (x, y, dropped, merged)."""
    if nonfinite not in ("error", "drop"):
        raise ValueError("nonfinite must be 'error' or 'drop'")
    xa = np.asarray(x, dtype=float).ravel()
    ya = np.asarray(y, dtype=float).ravel()
    if xa.size != ya.size:
        raise ValueError(f"{name}: X and Y must have the same length ({xa.size} vs {ya.size})")
    ok = np.isfinite(xa) & np.isfinite(ya)
    dropped = int(ok.size - np.count_nonzero(ok))
    if dropped and nonfinite == "error":
        raise ValueError(
            f"{name}: {dropped} point(s) are not finite (NaN or infinite); "
            "remove them or ask to drop them"
        )
    xa, ya = xa[ok], ya[ok]
    if xa.size < min_points:
        raise ValueError(f"{name}: needs at least {min_points} finite points, has {xa.size}")
    order = np.argsort(xa, kind="stable")
    xa, ya = xa[order], ya[order]
    uniq, start = np.unique(xa, return_index=True)
    merged = int(xa.size - uniq.size)
    if merged:
        ya = np.add.reduceat(ya, start) / np.diff(np.append(start, xa.size))
        xa = uniq
    if xa.size < min_points:
        raise ValueError(f"{name}: needs at least {min_points} distinct X values, has {xa.size}")
    return xa, np.asarray(ya, dtype=float), dropped, merged


def _finite(value: float, name: str) -> float:
    v = float(value)
    if not math.isfinite(v):
        raise ValueError(f"{name} must be a finite number")
    return v


# --------------------------------------------------------------------------- #
# Intersection of two curves
# --------------------------------------------------------------------------- #


def intersect_curves(
    x1: ArrayLike,
    y1: ArrayLike,
    x2: ArrayLike,
    y2: ArrayLike,
    *,
    nonfinite: NonFinite = "error",
) -> IntersectionResult:
    """Every place curve A (``x1, y1``) meets curve B (``x2, y2``).

    Method: restrict to the X range both curves cover, build the union grid of
    both curves' X samples inside it (plus the range ends), interpolate both
    curves linearly onto it and look at ``d = A - B``. A sign change between
    neighbouring grid points is a crossing, located by linear interpolation of
    ``d`` (exact, since ``d`` is piecewise linear there). Grid points where
    ``|d|`` is within ``1e-12`` of the larger curve amplitude are zeros: an
    isolated zero between opposite signs is a crossing, an isolated zero with
    the same sign on both sides is a touch, and a run of zeros is a stretch
    where the curves coincide.

    Raises ``ValueError`` for too few points, non-finite data (unless
    ``nonfinite="drop"``) and curves that share no X range.
    """
    xa, ya, drop_a, merge_a = _prepare(x1, y1, "curve A", nonfinite)
    xb, yb, drop_b, merge_b = _prepare(x2, y2, "curve B", nonfinite)
    lo = max(float(xa[0]), float(xb[0]))
    hi = min(float(xa[-1]), float(xb[-1]))
    if lo > hi:
        raise ValueError(
            "the curves do not overlap in X "
            f"(A covers {xa[0]:g} to {xa[-1]:g}, B covers {xb[0]:g} to {xb[-1]:g})"
        )
    inside_a = xa[(xa >= lo) & (xa <= hi)]
    inside_b = xb[(xb >= lo) & (xb <= hi)]
    grid = np.unique(np.concatenate(([lo, hi], inside_a, inside_b)))
    ia = np.interp(grid, xa, ya)
    ib = np.interp(grid, xb, yb)
    diff = ia - ib
    tol = 1e-12 * max(float(np.max(np.abs(ya))), float(np.max(np.abs(yb))), 1e-300)
    sign = np.where(np.abs(diff) <= tol, 0, np.sign(diff)).astype(int)
    found: list[Intersection] = []
    n = grid.size
    i = 0
    while i < n:
        if sign[i] == 0:
            j = i
            while j + 1 < n and sign[j + 1] == 0:
                j += 1
            before = int(sign[i - 1]) if i > 0 else 0
            after = int(sign[j + 1]) if j + 1 < n else 0
            if j > i:
                found.append(
                    Intersection(float(grid[i]), float(ia[i]), "coincident", None, float(grid[j]))
                )
            elif before != 0 and after != 0 and before != after:
                way: Direction = "rising" if after > 0 else "falling"
                found.append(
                    Intersection(float(grid[i]), float(ia[i]), "cross", way, float(grid[i]))
                )
            else:
                found.append(
                    Intersection(float(grid[i]), float(ia[i]), "touch", None, float(grid[i]))
                )
            i = j + 1
            continue
        if i + 1 < n and sign[i + 1] != 0 and sign[i + 1] != sign[i]:
            t = diff[i] / (diff[i] - diff[i + 1])
            cx = float(grid[i] + t * (grid[i + 1] - grid[i]))
            cy = float(ia[i] + t * (ia[i + 1] - ia[i]))
            way2: Direction = "rising" if sign[i + 1] > 0 else "falling"
            found.append(Intersection(cx, cy, "cross", way2, cx))
        i += 1
    return IntersectionResult(tuple(found), lo, hi, int(n), drop_a, drop_b, merge_a, merge_b)


# --------------------------------------------------------------------------- #
# Level crossings
# --------------------------------------------------------------------------- #


def _crossing_x(x: NDArray[np.float64], y: NDArray[np.float64], k: int, level: float) -> float:
    """X where the segment k..k+1 passes through ``level`` (its ends straddle it)."""
    dy = y[k + 1] - y[k]
    if dy == 0.0:
        return float(x[k])
    return float(x[k] + (level - y[k]) / dy * (x[k + 1] - x[k]))


def _last_up_crossing(y: NDArray[np.float64], level: float, lo: int, hi: int) -> int:
    """Largest k in [lo, hi) with ``y[k] <= level < y[k+1]``; -1 when none."""
    for k in range(hi - 1, lo - 1, -1):
        if y[k] <= level < y[k + 1]:
            return k
    return -1


def _last_down_crossing(y: NDArray[np.float64], level: float, lo: int, hi: int) -> int:
    """Largest k in [lo, hi) with ``y[k] >= level > y[k+1]``; -1 when none."""
    for k in range(hi - 1, lo - 1, -1):
        if y[k] >= level > y[k + 1]:
            return k
    return -1


def _schmitt_crossings(
    xs: NDArray[np.float64],
    ys: NDArray[np.float64],
    lv: float,
    hy: float,
    direction: str,
) -> list[Crossing]:
    """The Schmitt-trigger state machine of :func:`level_crossings`, over the samples as given.

    ``xs`` need not ascend (the sweep-order variant, ``curve_measure_ordered``, relies on that): a
    crossing is interpolated inside the consecutive pair that straddles the level, whatever their X.
    """
    upper, lower = lv + hy, lv - hy
    state = 0  # +1 high, -1 low, 0 not yet known
    anchor = 0  # sample that set the current state
    out: list[Crossing] = []
    for j in range(ys.size):
        v = ys[j]
        new = 1 if v > upper else -1 if v < lower else 0
        if new == 0 or new == state:
            continue
        if state != 0:
            if new > 0:
                k = _last_up_crossing(ys, lv, anchor, j)
                if k >= 0 and direction != "falling":
                    out.append(Crossing(_crossing_x(xs, ys, k, lv), "rising"))
            else:
                k = _last_down_crossing(ys, lv, anchor, j)
                if k >= 0 and direction != "rising":
                    out.append(Crossing(_crossing_x(xs, ys, k, lv), "falling"))
        state, anchor = new, j
    return out


def level_crossings(
    x: ArrayLike,
    y: ArrayLike,
    level: float,
    *,
    hysteresis: float = 0.0,
    direction: Literal["both", "rising", "falling"] = "both",
    nonfinite: NonFinite = "error",
) -> LevelCrossingResult:
    """Every X where the curve passes through ``level``, in ascending X.

    Method: a Schmitt trigger. The curve is *high* once a sample lies above
    ``level + hysteresis`` and *low* once one lies below ``level - hysteresis``;
    samples in between keep the last state, so noise inside the dead band never
    flips it. Each flip is one crossing, reported at the *last* place the
    interpolated curve passed through ``level`` before the flip (the passage
    that actually led to the new state), by linear interpolation inside that
    segment. With ``hysteresis = 0`` a sample exactly on the level keeps the
    previous state, so touching the level without crossing it reports nothing.
    The first state is established silently, so a curve that merely starts on
    one side has no crossing. A level the curve never passes gives an empty
    result, not an error.

    ``direction`` keeps only rising or falling crossings (the state machine
    still runs over both, so the filter never shifts the others).
    """
    lv = _finite(level, "level")
    hy = _finite(hysteresis, "hysteresis")
    if hy < 0.0:
        raise ValueError("hysteresis must not be negative")
    if direction not in ("both", "rising", "falling"):
        raise ValueError("direction must be 'both', 'rising' or 'falling'")
    xs, ys, dropped, merged = _prepare(x, y, "curve", nonfinite)
    out = _schmitt_crossings(xs, ys, lv, hy, direction)
    return LevelCrossingResult(lv, hy, tuple(out), int(xs.size), dropped, merged)


# --------------------------------------------------------------------------- #
# Rise / fall time
# --------------------------------------------------------------------------- #


def _up_edge(
    x: NDArray[np.float64], y: NDArray[np.float64], start: float, end: float
) -> tuple[float, float] | None:
    """Legacy ("band") rising passage from ``start`` up through ``end`` (start < end).

    Returns (x where it crosses ``start``, x where it crosses ``end``): the
    first sample at or below ``start`` opens the search, the first later sample
    at or above ``end`` closes it, and the start crossing is the last upward
    passage of ``start`` before that, so noise on the lower plateau is skipped.
    """
    below = np.flatnonzero(y <= start)
    if below.size == 0:
        return None
    i0 = int(below[0])
    above = np.flatnonzero(y[i0:] >= end)
    if above.size == 0:
        return None
    j = i0 + int(above[0])
    k_end = j - 1  # y[j-1] < end <= y[j]
    k_start = _last_up_crossing(y, start, i0, j)
    x_end = _crossing_x(x, y, k_end, end)
    return _crossing_x(x, y, k_start, start), x_end


def step_time(
    x: ArrayLike,
    y: ArrayLike,
    *,
    low_fraction: float = 0.1,
    high_fraction: float = 0.9,
    edge: Edge = "auto",
    low_level: float | None = None,
    high_level: float | None = None,
    plateau_band: float = 0.1,
    plateau_method: PlateauMethod = "state",
    nonfinite: NonFinite = "error",
) -> StepTimeResult:
    """Rise or fall time: the X distance between two fractions of a step.

    Reference levels: ``low_level`` and ``high_level`` when given. Each one that
    is not given is estimated by ``plateau_method`` (see ``step_levels``): by
    default the IEEE 181 histogram state levels, which refuse a trace with no
    clear two-level shape; ``"band"`` is the previous median-of-the-outer-band
    estimate (``plateau_band``). Give the levels for a curve that never settles.

    With height ``H = high_plateau - low_plateau`` the two measured levels are
    ``low_plateau + low_fraction * H`` and ``low_plateau + high_fraction * H``.
    A rise is timed from the low level to the high level; a fall, from the
    high level down to the low level. Each level's instant is where the
    interpolated curve passes through it; on a noisy step, which crosses a
    level several times in a burst, it is the median of those passages inside
    the transition (see ``step_edge``), so the noise does not bias the time.
    A clean step has one passage per level, reported exactly. With
    ``plateau_method="band"`` (the rule steps saved before state levels
    used) the low instant is instead the last upward passage before the first
    passage through the high level, so a noisy step reads short. ``time`` is
    the positive distance between the two instants, both returned. ``edge="auto"``
    picks whichever polarity the curve shows first; ``"rise"`` / ``"fall"``
    force it, and a trace with several edges reports the first of that
    polarity.

    Raises ``ValueError`` for fewer than 5 points, fractions outside
    ``0 < low < high < 1``, no step height, or an edge that is not in the data.
    """
    lf = _finite(low_fraction, "low_fraction")
    hf = _finite(high_fraction, "high_fraction")
    if not 0.0 < lf < hf < 1.0:
        raise ValueError("fractions must satisfy 0 < low < high < 1")
    band = _finite(plateau_band, "plateau_band")
    if not 0.0 < band < 0.5:
        raise ValueError("plateau_band must be between 0 and 0.5")
    if edge not in ("auto", "rise", "fall"):
        raise ValueError("edge must be 'auto', 'rise' or 'fall'")
    xs, ys, dropped, merged = _prepare(x, y, "curve", nonfinite, _STEP_MIN_POINTS)
    est_low = low_level is None
    est_high = high_level is None
    if est_low or est_high:
        p_low, p_high = plateau_levels(
            ys, plateau_method, band, check_low=est_low, check_high=est_high
        )
    low_p = _finite(low_level, "low_level") if low_level is not None else p_low
    high_p = _finite(high_level, "high_level") if high_level is not None else p_high
    height = high_p - low_p
    if not height > 0.0:
        raise ValueError(
            f"the high level ({high_p:g}) must be above the low level ({low_p:g}); "
            "there is no step to measure"
        )
    lo_ref = low_p + lf * height
    hi_ref = low_p + hf * height
    if plateau_method == "band":
        # The saved-before-#1232 rule: keep those numbers on a re-measure.
        rise = _up_edge(xs, ys, lo_ref, hi_ref) if edge != "fall" else None
        fall = _up_edge(xs, -ys, -hi_ref, -lo_ref) if edge != "rise" else None
    else:
        rise = median_up_edge(xs, ys, lo_ref, hi_ref, low_p, high_p) if edge != "fall" else None
        fall = median_up_edge(xs, -ys, -hi_ref, -lo_ref, -high_p, -low_p) if edge != "rise" else None
    chosen: Literal["rise", "fall"]
    if edge == "auto":
        if rise is None and fall is None:
            raise ValueError(
                "the curve never crosses both reference levels, so there is no edge to measure"
            )
        chosen = "rise" if fall is None or (rise is not None and rise[0] <= fall[0]) else "fall"
    else:
        chosen = "rise" if edge == "rise" else "fall"
    found = rise if chosen == "rise" else fall
    if found is None:
        raise ValueError(
            f"the curve has no {chosen} from {lo_ref:g} to {hi_ref:g}; "
            "check the reference levels, or the edge direction"
        )
    if chosen == "rise":
        x_low, x_high = found
    else:
        x_high, x_low = found
    return StepTimeResult(
        edge=chosen,
        time=abs(x_high - x_low),
        x_low=x_low,
        x_high=x_high,
        low_fraction=lf,
        high_fraction=hf,
        low_plateau=low_p,
        high_plateau=high_p,
        low_level=lo_ref,
        high_level=hi_ref,
        plateaus_estimated=(est_low, est_high),
        plateau_method=plateau_method,
        n_points=int(xs.size),
        dropped=dropped,
        merged_duplicates=merged,
    )
