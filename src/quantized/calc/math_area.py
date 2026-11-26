"""Areas: the polygon an XY curve encloses, and the surface area of a map.

Origin's ``polyarea`` and ``marea``.

* **Polygon area** is the shoelace sum over the points taken in order, the
  polygon being closed by a straight edge from the last point back to the
  first (a curve whose last point repeats its first is not closed twice). The
  result is the absolute area of the polygon as drawn; ``signed_area`` keeps
  the orientation (positive = counter-clockwise). A polygon that crosses
  itself has no single area -- the shoelace sum then nets the loops against
  each other -- so the result says so (``self_intersecting``) instead of
  presenting it as a plain area.
* **Surface area** of a map treats each grid cell as four triangles meeting at
  the cell centre, whose height is the mean of the four corner heights. That
  has no diagonal to choose, so the result does not depend on how the cell is
  split, and a plane ``z = a x + b y + c`` is exact (``A sqrt(1+a^2+b^2)``).
  Axes may be unevenly spaced. A cell with a corner that has no value cannot
  be measured: it is refused unless ``on_nan = "skip"``, which leaves those
  cells out and says how many.

Pure layer: ndarray / ``MapGrid`` in, dataclass out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.map_ops import MapGrid

__all__ = ["PolygonArea", "SurfaceArea", "polygon_area", "surface_area"]

_Arr = NDArray[np.float64]
#: Self-crossing is an O(n^2) test; beyond this many edges it is not run.
_CROSS_LIMIT = 2000


@dataclass(frozen=True)
class PolygonArea:
    area: float
    signed_area: float
    perimeter: float
    n_points: int
    dropped: int
    #: ``None`` when the polygon is too large for the self-crossing test.
    self_intersecting: bool | None


@dataclass(frozen=True)
class SurfaceArea:
    surface_area: float
    projected_area: float
    n_cells: int
    skipped_cells: int


def _clean(x: ArrayLike, y: ArrayLike, nonfinite: str) -> tuple[_Arr, _Arr, int]:
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("X and Y must have the same number of points")
    ok = np.isfinite(xv) & np.isfinite(yv)
    bad = int(np.count_nonzero(~ok))
    if bad and nonfinite != "drop":
        raise ValueError(
            f"{bad} point(s) are not finite; remove them or choose to drop non-finite points"
        )
    return xv[ok], yv[ok], bad


def _crosses(px: _Arr, py: _Arr) -> bool:
    """True when two non-adjacent edges of the closed polygon cross or touch."""
    n = px.size
    ax, ay = px, py
    bx, by = np.roll(px, -1), np.roll(py, -1)

    def orient(ux: _Arr, uy: _Arr, vx: _Arr, vy: _Arr, wx: _Arr, wy: _Arr) -> _Arr:
        return np.sign((vx - ux) * (wy - uy) - (vy - uy) * (wx - ux))

    o1 = orient(ax[:, None], ay[:, None], bx[:, None], by[:, None], ax[None, :], ay[None, :])
    o2 = orient(ax[:, None], ay[:, None], bx[:, None], by[:, None], bx[None, :], by[None, :])
    o3 = orient(ax[None, :], ay[None, :], bx[None, :], by[None, :], ax[:, None], ay[:, None])
    o4 = orient(ax[None, :], ay[None, :], bx[None, :], by[None, :], bx[:, None], by[:, None])
    hit = (o1 * o2 < 0) & (o3 * o4 < 0)  # proper crossings only
    idx = np.arange(n)
    gap = np.abs(idx[:, None] - idx[None, :])
    adjacent = (gap <= 1) | (gap == n - 1)
    return bool(np.any(hit & ~adjacent))


def polygon_area(
    x: ArrayLike, y: ArrayLike, *, nonfinite: Literal["error", "drop"] = "error"
) -> PolygonArea:
    """Area of the polygon through the points in order, closed by its endpoints."""
    px, py, dropped = _clean(x, y, nonfinite)
    if px.size > 1 and px[0] == px[-1] and py[0] == py[-1]:
        px, py = px[:-1], py[:-1]
    n = int(px.size)
    if n < 3:
        raise ValueError("a polygon needs at least 3 distinct points")
    qx, qy = np.roll(px, -1), np.roll(py, -1)
    # Centre on the mean first: the shoelace sum cancels badly far from the origin.
    cx, cy = float(px.mean()), float(py.mean())
    ux, uy, vx, vy = px - cx, py - cy, qx - cx, qy - cy
    signed = 0.5 * float(np.sum(ux * vy - vx * uy))
    perimeter = float(np.sum(np.hypot(qx - px, qy - py)))
    crossing = _crosses(px, py) if n <= _CROSS_LIMIT else None
    return PolygonArea(abs(signed), signed, perimeter, n, dropped, crossing)


def surface_area(g: MapGrid, *, on_nan: Literal["error", "skip"] = "error") -> SurfaceArea:
    """Surface area of the map ``g`` (``z[j, i]`` at ``(x[i], y[j])``)."""
    x, y, z = g.x, g.y, g.z
    if z.shape[0] < 2 or z.shape[1] < 2:
        raise ValueError("a surface needs at least a 2 x 2 grid")
    z00, z01 = z[:-1, :-1], z[:-1, 1:]
    z10, z11 = z[1:, :-1], z[1:, 1:]
    finite = np.isfinite(z00) & np.isfinite(z01) & np.isfinite(z10) & np.isfinite(z11)
    total = int(finite.size)
    skipped = total - int(np.count_nonzero(finite))
    if skipped and on_nan != "skip":
        raise ValueError(f"{skipped} cell(s) touch a blank value; fill them or choose to skip them")
    if not np.count_nonzero(finite):
        raise ValueError("no cell has four finite corners")
    dx = np.diff(x)[None, :]
    dy = np.diff(y)[:, None]
    zc = (z00 + z01 + z10 + z11) / 4.0

    def tri(za: _Arr, zb: _Arr, ax: _Arr, ay: _Arr, bx: _Arr, by: _Arr) -> _Arr:
        """Area of the triangle (centre, corner a, corner b); corners relative to the centre."""
        ex, ey, ez = ax, ay, za - zc
        fx, fy, fz = bx, by, zb - zc
        cx = ey * fz - ez * fy
        cy = ez * fx - ex * fz
        cz = ex * fy - ey * fx
        return 0.5 * np.sqrt(cx**2 + cy**2 + cz**2)

    hx, hy = dx / 2.0, dy / 2.0
    with np.errstate(invalid="ignore"):
        cell = (
            tri(z00, z01, -hx, -hy, hx, -hy)
            + tri(z01, z11, hx, -hy, hx, hy)
            + tri(z11, z10, hx, hy, -hx, hy)
            + tri(z10, z00, -hx, hy, -hx, -hy)
        )
    area = float(np.sum(cell[finite]))
    projected = float(np.sum((np.abs(dx) * np.abs(dy) * np.ones_like(zc))[finite]))
    return SurfaceArea(area, projected, total - skipped, skipped)
