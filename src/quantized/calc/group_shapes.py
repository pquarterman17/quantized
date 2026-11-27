"""Group shapes for a scatter: the centroid, the convex hull and the two confidence
ellipses (plan item 24, Origin's "subset centroid with hull or ellipse").

Pure geometry on one group's finite ``(x, y)`` points, behind the scatter overlays
(``calc.figure_overlays``): the live plot and the vector export draw the same numbers.

Two different ellipses, never merged, both named in the UI and the legend:

* **Data ellipse** (``kind="data"``): where the POINTS fall. With sample covariance
  ``S`` and mean ``m``, the region ``(p - m)' S^-1 (p - m) <= c`` with
  ``c = chi2_2(level) = -2 ln(1 - level)`` (the chi-square quantile with 2 degrees of
  freedom has this closed form). Semi-axes are ``sqrt(c * lambda_i)`` for the
  eigenvalues ``lambda_i`` of ``S``.
* **Mean ellipse** (``kind="mean"``): where the group's MEAN lies, the confidence
  region of Hotelling's T-squared. The covariance of the mean is ``S / n`` and the
  critical value is ``T2 = 2 (n - 1) / (n - 2) * F_{2, n-2}(level)``, so the region is
  ``(p - m)' (S / n)^-1 (p - m) <= T2`` and the semi-axes are
  ``sqrt(T2 * lambda_i / n)``. F with 2 numerator degrees of freedom has the closed
  quantile ``(d / 2) ((1 - level)^(-2/d) - 1)`` for ``d = n - 2``, which gives
  ``T2 = (n - 1) ((1 - level)^(-2 / (n - 2)) - 1)`` (exact for normal data; tends to
  the chi-square value as ``n`` grows).

The hull is the monotone-chain convex hull, vertices counter-clockwise from the
lowest-then-leftmost point. Collinearity is judged in coordinates scaled by each
axis' range, so it does not depend on the units of X against Y. A collinear group
has a DEGENERATE hull (its two end points, a segment) and says so.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = [
    "ELLIPSE_KINDS",
    "MEAN_ELLIPSE_MIN_POINTS",
    "centroid",
    "convex_hull_indices",
    "ellipse_geometry",
    "hull_outline",
    "mean_ellipse_factor",
]

ELLIPSE_KINDS = ("data", "mean")
#: Hotelling's T-squared needs ``n - 2 > 0`` degrees of freedom.
MEAN_ELLIPSE_MIN_POINTS = 3
ELLIPSE_POINTS = 120
#: A hull whose scaled area is below this fraction of its scaled bounding box is a line.
_COLLINEAR_AREA = 1e-9


class ShapeRefused(ValueError):
    """A shape that cannot be drawn honestly; the message is the reason."""


def centroid(x: NDArray[np.float64], y: NDArray[np.float64]) -> tuple[float, float]:
    """The group mean ``(mean x, mean y)``."""
    return float(x.mean()), float(y.mean())


def mean_ellipse_factor(n: int, level: float) -> float:
    """Hotelling's critical value ``T2 = 2(n-1)/(n-2) * F_{2,n-2}(level)`` in closed form."""
    if n < MEAN_ELLIPSE_MIN_POINTS:
        raise ShapeRefused(
            f"a mean confidence ellipse needs at least {MEAN_ELLIPSE_MIN_POINTS} points "
            f"with a value in both X and Y (this has {n})"
        )
    return float((n - 1) * math.expm1(-2.0 * math.log1p(-level) / (n - 2)))


def data_ellipse_factor(level: float) -> float:
    """The chi-square quantile with 2 degrees of freedom, ``-2 ln(1 - level)``."""
    return float(-2.0 * math.log1p(-level))


def ellipse_geometry(
    x: NDArray[np.float64], y: NDArray[np.float64], level: float, kind: str
) -> dict[str, Any]:
    """The ellipse of ``kind`` at ``level``: centre, semi-axes (major first), the major
    axis' angle from +X in degrees (-90, 90] and a closed outline polyline."""
    n = int(x.size)
    if kind == "mean":
        factor = mean_ellipse_factor(n, level)
        per_n = 1.0 / n
    else:
        factor = data_ellipse_factor(level)
        per_n = 1.0
    cov = np.cov(np.vstack([x, y]))
    vals, vecs = np.linalg.eigh(cov)
    scale = float(max(abs(cov[0, 0]), abs(cov[1, 1])))
    if scale <= 0.0 or float(vals[0]) <= 1e-12 * scale:
        raise ShapeRefused("an ellipse needs points that are not on a straight line")
    semi = np.sqrt(factor * per_n * vals)  # ascending: minor, major
    angle = math.degrees(math.atan2(float(vecs[1, 1]), float(vecs[0, 1])))
    if angle <= -90.0:
        angle += 180.0
    elif angle > 90.0:
        angle -= 180.0
    cx, cy = centroid(x, y)
    t = np.linspace(0.0, 2.0 * math.pi, ELLIPSE_POINTS + 1)
    circle = np.vstack([np.cos(t), np.sin(t)]) * semi[:, None]
    pts = vecs @ circle + np.array([[cx], [cy]])
    return {
        "x": pts[0].tolist(),
        "y": pts[1].tolist(),
        "kind": kind,
        "level": level,
        "n": n,
        "center": [cx, cy],
        "semi_axes": [float(semi[1]), float(semi[0])],
        "angle_deg": angle,
        "factor": factor,
    }


def convex_hull_indices(x: NDArray[np.float64], y: NDArray[np.float64]) -> list[int]:
    """Indices of the hull's vertices, counter-clockwise from the lowest-then-leftmost
    point (Andrew's monotone chain; points on an edge are not vertices). Duplicate points
    count once. One or two indices come back for a point or a segment."""
    order = sorted(range(int(x.size)), key=lambda i: (float(x[i]), float(y[i])))
    pts: list[int] = []
    for i in order:
        if not pts or (x[i], y[i]) != (x[pts[-1]], y[pts[-1]]):
            pts.append(i)
    if len(pts) <= 2:
        return pts

    def cross(o: int, a: int, b: int) -> float:
        return float((x[a] - x[o]) * (y[b] - y[o]) - (y[a] - y[o]) * (x[b] - x[o]))

    lower: list[int] = []
    for i in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], i) <= 0.0:
            lower.pop()
        lower.append(i)
    upper: list[int] = []
    for i in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], i) <= 0.0:
            upper.pop()
        upper.append(i)
    ring = lower[:-1] + upper[:-1]
    # "Lowest then leftmost" start: rotate so the minimum (y, x) comes first.
    start = min(range(len(ring)), key=lambda k: (float(y[ring[k]]), float(x[ring[k]])))
    return ring[start:] + ring[:start]


def _scaled(v: NDArray[np.float64]) -> NDArray[np.float64]:
    span = float(np.ptp(v))
    return (v - float(v.min())) / span if span > 0.0 else np.zeros_like(v)


def hull_outline(x: NDArray[np.float64], y: NDArray[np.float64]) -> dict[str, Any]:
    """The convex hull of the points: a closed outline, or a degenerate one.

    ``degenerate`` is True when every point lies on one line (the outline is then the
    two end points, a segment). All points identical is refused: there is nothing to draw.
    """
    n = int(x.size)
    if n < 3:
        raise ShapeRefused(
            f"a hull needs at least 3 points with a value in both X and Y (this has {n})"
        )
    if float(np.ptp(x)) <= 0.0 and float(np.ptp(y)) <= 0.0:
        raise ShapeRefused("a hull needs points that are not all the same")
    xs, ys = _scaled(x), _scaled(y)
    ring = convex_hull_indices(xs, ys)
    area = 0.0
    if len(ring) >= 3:
        rx, ry = xs[ring], ys[ring]
        area = 0.5 * abs(float(np.dot(rx, np.roll(ry, -1)) - np.dot(ry, np.roll(rx, -1))))
    degenerate = len(ring) < 3 or area <= _COLLINEAR_AREA
    if degenerate:
        # The segment between the two extreme points along the longer scaled direction.
        along = xs if float(np.ptp(xs)) >= float(np.ptp(ys)) else ys
        ends = [int(np.argmin(along)), int(np.argmax(along))]
        ends.sort(key=lambda i: (float(y[i]), float(x[i])))
        ring = ends
    vx = [float(x[i]) for i in ring]
    vy = [float(y[i]) for i in ring]
    if not degenerate:
        vx.append(vx[0])
        vy.append(vy[0])
    return {
        "x": vx,
        "y": vy,
        "n": n,
        "n_vertices": len(ring),
        "degenerate": degenerate,
    }
