"""Static 3-D helpers for ``calc.figure_map``: validation, the point caps, the
waterfall row stepping, separate-curve polylines and the log z-axis ticks.

Pure (ndarray in, ndarray / matplotlib calls out). Split out of ``figure_map``
for its 500-line module ceiling. Every refusal is a ``ValueError`` with a
reason a user can act on (the route turns it into a 422).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import matplotlib
import numpy as np
from numpy.typing import NDArray

__all__ = [
    "MAX_CURVE_POINTS",
    "MAX_SCATTER_POINTS",
    "check_angles",
    "check_curve_inputs",
    "check_extent",
    "check_grid_3d",
    "decimate",
    "draw_curves",
    "parse_curves",
    "set_log_zticks",
    "step_rows",
]

# A 3-D scatter renders every point: 250k points took 6 s as PNG and 20 s (50 MB)
# as SVG while holding the global render lock. Larger clouds are sampled evenly
# (and the figure says so); the frontend applies the same rule before sending.
MAX_SCATTER_POINTS = 50_000
MAX_CURVE_POINTS = 200_000
_MAX_ABS = 1e100  # beyond this numpy/matplotlib overflow with unreadable errors

Curve = tuple[NDArray[np.float64], NDArray[np.float64], float]


def check_angles(elev: float, azim: float) -> None:
    if not (math.isfinite(elev) and -90.0 <= elev <= 90.0):
        raise ValueError("view_elev must be a finite number from -90 to 90 degrees")
    if not (math.isfinite(azim) and -360.0 <= azim <= 360.0):
        raise ValueError("view_azim must be a finite number from -360 to 360 degrees")


def check_extent(*arrays: NDArray[np.float64]) -> None:
    """Refuse values too large to span an axis (they overflow into 'Singular
    matrix' / 'arange' errors deep inside matplotlib)."""
    for a in arrays:
        f = a[np.isfinite(a)]
        if f.size and float(np.max(np.abs(f))) > _MAX_ABS:
            raise ValueError("3-D values beyond +/-1e100 cannot be drawn on an axis")


def decimate(
    n: int, limit: int = MAX_SCATTER_POINTS
) -> NDArray[np.intp]:
    """Indices of at most ``limit`` of ``n`` points, evenly spread, first and
    last kept, in original order. Identical to the frontend's rule."""
    if n <= limit:
        return np.arange(n)
    return np.unique(np.linspace(0, n - 1, limit).round().astype(np.intp))


def step_rows(z: NDArray[np.float64], max_lines: int) -> list[int]:
    """Rows of a grid to draw as waterfall lines: only rows with two or more
    finite points (an all-gap row draws nothing), at most ``max_lines`` of them
    (0 = all), evenly stepped with the first and last kept."""
    rows = np.flatnonzero(np.isfinite(z).sum(axis=1) >= 2)
    if 0 < max_lines < rows.size:
        rows = rows[decimate(int(rows.size), max(max_lines, 2))]
    return [int(r) for r in rows]


def check_grid_3d(
    kind: str, x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64],
    elev: float, azim: float,
) -> None:
    """Fail closed on a gridded 3-D request that cannot make a meaningful
    figure: a bad view angle, an unreadable extent, too few finite cells for the
    mark, or a waterfall of fewer than two curves."""
    check_angles(elev, azim)
    check_extent(x, y, z)
    n_finite = int(np.isfinite(z).sum())
    if kind == "waterfall":
        curves = int((np.isfinite(z).sum(axis=1) >= 2).sum())
        if curves < 2:
            raise ValueError(
                f"a 3-D waterfall needs at least 2 curves with 2 or more points; found {curves}"
            )
    elif kind == "surface" and n_finite < 4:
        raise ValueError(f"a 3-D surface needs at least 4 finite grid cells; found {n_finite}")
    elif n_finite < 3:
        raise ValueError(f"a 3-D scatter needs at least 3 finite points; found {n_finite}")


def check_curve_inputs(kind: str, elev: float, azim: float) -> None:
    if kind != "waterfall":
        raise ValueError("contour_source='curves' only supports kind 'waterfall'")
    check_angles(elev, azim)


def parse_curves(curves: Sequence[Mapping[str, Any]] | None) -> list[Curve]:
    """Validate separate curves: each ``{x, z, depth}`` keeps its points in the
    ORIGINAL order (a hysteresis loop stays a loop -- no sort, no union, no
    resampling); a point with a non-finite x or z is dropped. Needs at least two
    curves of two or more points each."""
    out: list[Curve] = []
    total = 0
    for i, c in enumerate(curves or []):
        xs = np.asarray(c["x"], dtype=float).ravel()
        zs = np.asarray(c["z"], dtype=float).ravel()
        if xs.size != zs.size:
            raise ValueError(
                f"curve {i + 1}: x and z must have the same length ({xs.size}/{zs.size})"
            )
        depth = float(c["depth"])
        if not math.isfinite(depth):
            raise ValueError(f"curve {i + 1}: depth must be a finite number")
        keep = np.isfinite(xs) & np.isfinite(zs)
        xs, zs = xs[keep], zs[keep]
        check_extent(xs, zs)
        if xs.size >= 2:
            out.append((xs, zs, depth))
            total += int(xs.size)
    if len(out) < 2:
        raise ValueError(
            f"a 3-D waterfall needs at least 2 curves with 2 or more points; found {len(out)}"
        )
    if total > MAX_CURVE_POINTS:
        raise ValueError(
            f"a 3-D waterfall draws at most {MAX_CURVE_POINTS:,} points; got {total:,}"
        )
    return out


def draw_curves(ax: Any, curves: list[Curve], cmap: str) -> None:
    """One polyline per curve at its own depth, coloured along the colormap by
    position in the given order."""
    line_cmap = matplotlib.colormaps[cmap]
    for j, (xs, zs, depth) in enumerate(curves):
        ax.plot(xs, np.full(xs.size, depth), zs, color=line_cmap(j / max(1, len(curves) - 1)))


def set_log_zticks(ax: Any, log_decade_ticks: Any) -> None:
    """Under a log colour scale z holds log10 values: label the z axis by value
    (1e-4, 0.01) as the colour bar is, not by bare exponents."""
    ticks = log_decade_ticks(*ax.get_zlim())
    if ticks:
        ax.set_zticks([k for k, _ in ticks], labels=[label for _, label in ticks])
