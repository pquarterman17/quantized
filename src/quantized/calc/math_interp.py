"""Interpolation extras: along a curve, onto chosen points in 2-D / 3-D, and
B-spline resampling.

Origin's ``interp1trace``, ``interp3`` and ``bspline``. The long-standing
``interp1xy`` (a monotonic X) is ``calc.resample``; ``Z from XY`` is
``calc.interp2d``.

* **Trace interpolation** treats the curve as a path in the (x, y) plane, not as
  y(x): the X values need not be monotonic and may double back. The path is
  parametrised by its cumulative chord length ``s`` and ``x(s)``, ``y(s)`` are
  interpolated (linear, PCHIP or a cubic spline; ``periodic`` closes the path
  with a smooth wrap). Output points are ``n`` equal steps of arc length from
  start to end, a fixed ``spacing``, or explicit positions ``at``.
* **Scattered interpolation** onto chosen points in 2-D or 3-D (the value
  ``w(x, y)`` or ``w(x, y, z)``): ``linear`` (Delaunay; blank outside the hull
  unless ``extrapolation = "nearest"``), ``nearest``, or ``rbf`` (thin-plate
  spline, smooth, extrapolates). Duplicate points are merged by their mean.
* **B-spline resampling** fits a degree-k B-spline to y(x) (an interpolating
  spline, or a smoothing one with ``smoothing > 0``: the largest allowed sum of
  squared residuals) and samples it at ``n`` points or every ``spacing`` along
  the x range.

Fail closed: non-finite input, too few points, a degenerate (collinear /
coplanar) cloud, a position outside the trace, or more than a million output
points are refused with a message.

Pure layer: arrays in, dataclasses out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.interpolate import (
    CubicSpline,
    LinearNDInterpolator,
    NearestNDInterpolator,
    PchipInterpolator,
    RBFInterpolator,
    splev,
    splrep,
)

__all__ = [
    "MAX_OUTPUT",
    "BSplineResult",
    "ScatterResult",
    "TraceResult",
    "bspline_resample",
    "scattered_interpolate",
    "trace_interpolate",
]

_Arr = NDArray[np.float64]
MAX_OUTPUT = 1_000_000


@dataclass(frozen=True)
class TraceResult:
    x: _Arr
    y: _Arr
    s: _Arr
    total_length: float
    n_input: int
    merged: int


@dataclass(frozen=True)
class ScatterResult:
    w: _Arr
    method: str
    n_points: int
    merged: int
    outside: int


@dataclass(frozen=True)
class BSplineResult:
    x: _Arr
    y: _Arr
    degree: int
    n_knots: int
    smoothing: float
    residual: float


def _finite_pair(x: ArrayLike, y: ArrayLike, what: str = "curve") -> tuple[_Arr, _Arr]:
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"{what}: X and Y must have the same number of points")
    if not (np.all(np.isfinite(xv)) and np.all(np.isfinite(yv))):
        raise ValueError(f"{what}: every X and Y value must be finite")
    return xv, yv


def _count_or_step(lo: float, hi: float, n: int | None, spacing: float | None) -> _Arr:
    """``n`` points over [lo, hi], or ``lo, lo+spacing, ...`` up to ``hi``."""
    if (n is None) == (spacing is None):
        raise ValueError("give either the number of points or the spacing, not both or neither")
    if n is not None:
        if n < 2:
            raise ValueError("the number of points must be at least 2")
        if n > MAX_OUTPUT:
            raise ValueError(f"{n:,} points exceed the limit of {MAX_OUTPUT:,}")
        return np.linspace(lo, hi, int(n))
    assert spacing is not None
    if not np.isfinite(spacing) or spacing <= 0:
        raise ValueError("the spacing must be a positive number")
    count = int(np.floor((hi - lo) / spacing * (1 + 1e-12))) + 1
    if count < 2:
        raise ValueError("the spacing is longer than the whole range")
    if count > MAX_OUTPUT:
        raise ValueError(f"{count:,} points exceed the limit of {MAX_OUTPUT:,}")
    return np.asarray(lo + spacing * np.arange(count), dtype=float)


def trace_interpolate(
    x: ArrayLike,
    y: ArrayLike,
    *,
    n: int | None = None,
    spacing: float | None = None,
    at: ArrayLike | None = None,
    kind: Literal["linear", "pchip", "cubic"] = "linear",
    periodic: bool = False,
) -> TraceResult:
    """Resample the path through (x, y) by arc length."""
    xv, yv = _finite_pair(x, y)
    keep = np.ones(xv.size, dtype=bool)
    keep[1:] = (np.diff(xv) != 0) | (np.diff(yv) != 0)
    merged = int(np.count_nonzero(~keep))
    px, py = xv[keep], yv[keep]
    if periodic and px.size > 1 and px[0] == px[-1] and py[0] == py[-1]:
        px, py = px[:-1], py[:-1]
    min_points = 3 if (kind == "cubic" or periodic) else 2
    if px.size < min_points:
        raise ValueError(f"at least {min_points} distinct points are needed")
    if periodic:
        px, py = np.append(px, px[0]), np.append(py, py[0])
    s = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(px), np.diff(py)))])
    total = float(s[-1])
    if at is not None:
        if n is not None or spacing is not None:
            raise ValueError("give positions or a count / spacing, not both")
        sq = np.asarray(at, dtype=float).ravel()
        if sq.size == 0 or sq.size > MAX_OUTPUT or not np.all(np.isfinite(sq)):
            raise ValueError("the positions must be a finite, non-empty list")
        if np.any(sq < 0) or np.any(sq > total * (1 + 1e-12)):
            raise ValueError(f"every position must lie between 0 and the arc length {total:g}")
        sq = np.clip(sq, 0.0, total)
    else:
        sq = _count_or_step(0.0, total, n, spacing)
    if kind == "linear":
        ox, oy = np.interp(sq, s, px), np.interp(sq, s, py)
    elif kind == "pchip":
        ox, oy = PchipInterpolator(s, px)(sq), PchipInterpolator(s, py)(sq)
    else:
        if s.size < 4 and not periodic:
            raise ValueError("a cubic spline needs at least 4 distinct points")
        bc = "periodic" if periodic else "not-a-knot"
        ox, oy = CubicSpline(s, px, bc_type=bc)(sq), CubicSpline(s, py, bc_type=bc)(sq)
    return TraceResult(np.asarray(ox), np.asarray(oy), sq, total, int(xv.size), merged)


def _merge_duplicates(pts: _Arr, w: _Arr) -> tuple[_Arr, _Arr, int]:
    uniq, inv = np.unique(pts, axis=0, return_inverse=True)
    inv = inv.ravel()
    if uniq.shape[0] == pts.shape[0]:
        return pts, w, 0
    sums = np.bincount(inv, weights=w, minlength=uniq.shape[0])
    counts = np.bincount(inv, minlength=uniq.shape[0])
    return uniq, sums / counts, pts.shape[0] - uniq.shape[0]


def scattered_interpolate(
    points: ArrayLike,
    values: ArrayLike,
    queries: ArrayLike,
    *,
    method: Literal["linear", "nearest", "rbf"] = "linear",
    extrapolation: Literal["none", "nearest"] = "none",
) -> ScatterResult:
    """Interpolate ``values`` at scattered ``points`` ((n, 2) or (n, 3)) onto ``queries``."""
    pts = np.asarray(points, dtype=float)
    w = np.asarray(values, dtype=float).ravel()
    q = np.asarray(queries, dtype=float)
    if pts.ndim != 2 or pts.shape[1] not in (2, 3):
        raise ValueError("points must have 2 or 3 coordinates each")
    if q.ndim != 2 or q.shape[1] != pts.shape[1]:
        raise ValueError(f"queries must have {pts.shape[1]} coordinates each, like the points")
    if pts.shape[0] != w.size:
        raise ValueError("there must be one value per point")
    if not (np.all(np.isfinite(pts)) and np.all(np.isfinite(w)) and np.all(np.isfinite(q))):
        raise ValueError("points, values and queries must all be finite")
    if q.shape[0] == 0 or q.shape[0] > MAX_OUTPUT:
        raise ValueError("give between 1 and a million query points")
    pts, w, merged = _merge_duplicates(pts, w)
    d = pts.shape[1]
    if pts.shape[0] < d + 1:
        raise ValueError(f"at least {d + 1} distinct points are needed in {d}-D")
    # Condition the coordinates so a tiny axis does not dominate the hull test.
    lo, span = pts.min(axis=0), np.ptp(pts, axis=0)
    if np.any(span <= 0):
        raise ValueError("the points all share one coordinate value, so they do not span 2-D / 3-D")
    pn, qn = (pts - lo) / span, (q - lo) / span
    outside = 0
    if method == "nearest":
        out = NearestNDInterpolator(pn, w)(qn)
    elif method == "rbf":
        if pn.shape[0] > 5000:
            raise ValueError("rbf is limited to 5,000 points; thin the data or use linear")
        try:
            out = RBFInterpolator(pn, w, kernel="thin_plate_spline", degree=1)(qn)
        except np.linalg.LinAlgError as exc:
            raise ValueError("the points are degenerate (collinear or coplanar)") from exc
    elif method == "linear":
        try:
            out = LinearNDInterpolator(pn, w)(qn)
        except Exception as exc:  # scipy's QhullError is not part of its public API
            raise ValueError(
                "the points are collinear or coplanar, so no triangulation exists"
            ) from exc
        miss = ~np.isfinite(out)
        outside = int(np.count_nonzero(miss))
        if outside and extrapolation == "nearest":
            out[miss] = NearestNDInterpolator(pn, w)(qn[miss])
    else:
        raise ValueError(f"unknown method {method!r}")
    return ScatterResult(np.asarray(out, dtype=float), method, int(pts.shape[0]), merged, outside)


def bspline_resample(
    x: ArrayLike,
    y: ArrayLike,
    *,
    n: int | None = None,
    spacing: float | None = None,
    degree: int = 3,
    smoothing: float = 0.0,
) -> BSplineResult:
    """Fit a degree-``degree`` B-spline to y(x) and sample it on a regular x grid."""
    xv, yv = _finite_pair(x, y)
    if not 1 <= degree <= 5:
        raise ValueError("the spline degree must be between 1 and 5")
    if not np.isfinite(smoothing) or smoothing < 0:
        raise ValueError("the smoothing must be zero or positive")
    order = np.argsort(xv, kind="stable")
    xs, ys = xv[order], yv[order]
    uniq, inv = np.unique(xs, return_inverse=True)
    if uniq.size != xs.size:  # repeated X: average, a B-spline needs distinct knots
        inv = inv.ravel()
        ys = np.bincount(inv, weights=ys) / np.bincount(inv)
        xs = uniq
    if xs.size <= degree:
        raise ValueError(f"a degree-{degree} spline needs at least {degree + 1} distinct X values")
    grid = _count_or_step(float(xs[0]), float(xs[-1]), n, spacing)
    tck = splrep(xs, ys, k=degree, s=float(smoothing))
    out = np.asarray(splev(grid, tck), dtype=float)
    residual = float(np.sum((np.asarray(splev(xs, tck)) - ys) ** 2))
    return BSplineResult(grid, out, degree, int(len(tck[0])), float(smoothing), residual)
