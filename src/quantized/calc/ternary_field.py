"""Composition maps on the ternary triangle: the numerics (pure, no matplotlib).

Plan item 21 (ORIGIN_FEATURE_GAP_PLAN). Three composition columns plus a value
column Z become a *surface over the triangle*:

* **Normalisation** -- each row is divided by its sum, so compositions given as
  fractions (sum 1) or percentages (sum 100) are the same input. A row that
  cannot be normalised (a non-finite or negative component, an all-zero row, a
  non-finite Z) is refused, and the refusal is *counted* (``dropped``) so the
  renderer can say "N of M rows left out" instead of failing the whole figure.
* **Interpolation** -- the points are placed in Cartesian ternary coordinates
  (``x = c + a/2``, ``y = sqrt(3)/2 * a``), Delaunay-triangulated, and Z is
  interpolated **linearly on each triangle** (barycentric weights). Outside the
  convex hull of the points the value is NaN: the surface is never
  extrapolated. Points that coincide (after normalisation) are merged to the
  mean of their Z, because a Delaunay triangulation cannot hold two vertices at
  one place.
* **Levels and colours** -- ``contour_bounds`` splits ``[lo, hi]`` into equal
  bands; band ``i`` takes the colour-map fraction ``(i + 1/2) / n``
  (``band_fractions``). Contour lines sit on the interior bounds. The screen
  preview is the export's own render, and the shared wire fixture pins these
  three functions.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.spatial import ConvexHull, Delaunay, QhullError

__all__ = [
    "MAX_HEAT_DIV",
    "MAX_LEVELS",
    "NormalisedRows",
    "TernarySurface",
    "band_fractions",
    "contour_bounds",
    "heat_cells",
    "normalise_rows",
    "ternary_xy",
]

_SQRT3_2 = float(np.sqrt(3) / 2)
_MERGE_DECIMALS = 9
MAX_LEVELS = 64
MAX_HEAT_DIV = 200

Floats = NDArray[np.float64]


def ternary_xy(abc: ArrayLike) -> tuple[Floats, Floats]:
    """Cartesian ``(x, y)`` of composition rows ``(a, b, c)`` summing to 1."""
    arr = np.asarray(abc, dtype=float).reshape(-1, 3)
    return (
        np.asarray(arr[:, 2] + 0.5 * arr[:, 0], dtype=float),
        np.asarray(_SQRT3_2 * arr[:, 0], dtype=float),
    )


@dataclass(frozen=True)
class NormalisedRows:
    """Rows kept after normalisation, and how many were refused."""

    abc: Floats  # (m, 3), each row sums to 1
    z: Floats  # (m,)
    kept: NDArray[np.intp]  # indices of the kept input rows
    dropped: int

    def warning(self, total: int) -> str | None:
        """One sentence on the refused rows, or None when none were."""
        if self.dropped <= 0:
            return None
        one = self.dropped == 1
        return (
            f"{self.dropped} of {total} rows {'has' if one else 'have'} a non-finite, "
            f"negative or all-zero composition (or a non-finite value) and "
            f"{'was' if one else 'were'} left out."
        )


def normalise_rows(data: ArrayLike, z: ArrayLike) -> NormalisedRows:
    """Divide each composition row by its sum; refuse rows that cannot be.

    Fractions (sum 1) and percentages (sum 100) both normalise to sum 1.
    """
    arr = np.asarray(data, dtype=float)
    zz = np.asarray(z, dtype=float).reshape(-1)
    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ValueError(f"data must be an (n, 3) array of compositions, got shape {arr.shape}")
    if zz.shape[0] != arr.shape[0]:
        raise ValueError(f"z has {zz.shape[0]} entries, data has {arr.shape[0]} rows")
    sums = arr.sum(axis=1)
    with np.errstate(invalid="ignore"):
        ok = (
            np.isfinite(arr).all(axis=1)
            & (arr >= 0).all(axis=1)
            & np.isfinite(sums)
            & (sums > 0)
            & np.isfinite(zz)
        )
    kept = np.flatnonzero(ok)
    abc = np.asarray(arr[kept] / sums[kept, None], dtype=float)
    z_kept = np.asarray(zz[kept], dtype=float)
    return NormalisedRows(abc, z_kept, kept, int(arr.shape[0] - kept.size))


class TernarySurface:
    """Z over the ternary triangle: Delaunay triangulation, linear on triangles.

    ``x``, ``y`` are Cartesian ternary coordinates. Evaluation outside the
    convex hull of the points returns NaN (no extrapolation).
    """

    def __init__(self, x: ArrayLike, y: ArrayLike, z: ArrayLike) -> None:
        xs, ys, zs = (np.asarray(v, dtype=float).reshape(-1) for v in (x, y, z))
        # Coincident points -> one vertex carrying the mean Z.
        key = np.round(np.column_stack([xs, ys]), _MERGE_DECIMALS)
        uniq_key, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        uniq = np.column_stack([xs[first], ys[first]])
        inv = inv.reshape(-1)
        zmean = np.bincount(inv, weights=zs) / np.bincount(inv)
        if uniq_key.shape[0] < 3:
            raise ValueError("need at least 3 distinct compositions to triangulate")
        try:
            self._tri = Delaunay(uniq)
            self._hull = ConvexHull(uniq)
        except QhullError as exc:
            raise ValueError(
                "the compositions are collinear: they cannot be triangulated"
            ) from exc
        self.x = np.asarray(uniq[:, 0], dtype=float)
        self.y = np.asarray(uniq[:, 1], dtype=float)
        self.z = np.asarray(zmean, dtype=float)

    @property
    def triangles(self) -> NDArray[np.intp]:
        """(t, 3) vertex indices of the Delaunay triangles."""
        return np.asarray(self._tri.simplices, dtype=np.intp)

    @property
    def hull_xy(self) -> Floats:
        """(h, 2) convex-hull vertices in counter-clockwise order."""
        idx = self._hull.vertices
        return np.asarray(np.column_stack([self.x[idx], self.y[idx]]), dtype=float)

    def __call__(self, x: ArrayLike, y: ArrayLike) -> Floats:
        """Linear interpolation at ``(x, y)``; NaN outside the hull."""
        xq = np.asarray(x, dtype=float)
        yq = np.asarray(y, dtype=float)
        pts = np.column_stack([xq.reshape(-1), yq.reshape(-1)])
        simplex = self._tri.find_simplex(pts, tol=1e-10)
        out = np.full(pts.shape[0], np.nan)
        inside = simplex >= 0
        if inside.any():
            s = simplex[inside]
            tr = self._tri.transform[s]
            b2 = np.einsum("ijk,ik->ij", tr[:, :2, :], pts[inside] - tr[:, 2, :])
            w = np.column_stack([b2, 1.0 - b2.sum(axis=1)])
            out[inside] = np.einsum("ij,ij->i", w, self.z[self._tri.simplices[s]])
        return np.asarray(out.reshape(xq.shape), dtype=float)


def contour_bounds(z: ArrayLike, levels: int, limits: tuple[float, float] | None = None) -> Floats:
    """``levels`` equal bands over ``limits`` (default: the data's own range).

    Returns the ``levels + 1`` band edges; contour lines sit on the interior
    ones.
    """
    if not 1 <= levels <= MAX_LEVELS:
        raise ValueError(f"levels must be between 1 and {MAX_LEVELS}")
    if limits is None:
        zz = np.asarray(z, dtype=float)
        zz = zz[np.isfinite(zz)]
        if zz.size == 0:
            raise ValueError("no finite Z values to contour")
        lo, hi = float(zz.min()), float(zz.max())
    else:
        lo, hi = float(limits[0]), float(limits[1])
    if not (np.isfinite(lo) and np.isfinite(hi)) or hi <= lo:
        raise ValueError(
            "Z has no range to contour (the values are all equal, or the limits are not increasing)"
        )
    return np.asarray(np.linspace(lo, hi, levels + 1), dtype=float)


def band_fractions(levels: int) -> Floats:
    """Colour-map fraction of each band: the midpoint of its slice of [0, 1]."""
    return np.asarray((np.arange(levels) + 0.5) / levels, dtype=float)


def heat_cells(surface: TernarySurface, div: int) -> tuple[Floats, Floats]:
    """Triangular cells of the ternary lattice and their interpolated Z.

    The triangle is cut into ``div ** 2`` small equilateral triangles; each
    takes the surface value at its centroid. Cells whose centroid lies outside
    the data's hull are omitted (the renderer additionally clips the rest to the
    hull). Returns ``(polygons (m, 3, 2), z (m,))``.
    """
    if not 2 <= div <= MAX_HEAT_DIV:
        raise ValueError(f"heat_div must be between 2 and {MAX_HEAT_DIV}")
    polys: list[list[tuple[int, int, int]]] = []
    for i in range(div):  # a index
        for j in range(div - i):  # c index
            k = div - i - j  # b index at the up triangle's base vertex
            polys.append([(i, k, j), (i + 1, k - 1, j), (i, k - 1, j + 1)])
            if i + j < div - 1:
                polys.append([(i + 1, k - 1, j), (i + 1, k - 2, j + 1), (i, k - 1, j + 1)])
    abc = np.asarray(polys, dtype=float) / div  # (m, 3 vertices, 3 components)
    x = abc[:, :, 2] + 0.5 * abc[:, :, 0]
    y = _SQRT3_2 * abc[:, :, 0]
    cells = np.stack([x, y], axis=2)
    zc = surface(x.mean(axis=1), y.mean(axis=1))
    keep = np.isfinite(zc)
    return np.asarray(cells[keep], dtype=float), np.asarray(zc[keep], dtype=float)
