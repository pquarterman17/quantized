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
from mpl_toolkits.mplot3d.art3d import Line3DCollection, Poly3DCollection
from numpy.typing import NDArray

__all__ = [
    "MAX_CURVE_POINTS",
    "MAX_SCATTER_POINTS",
    "check_angles",
    "check_curve_inputs",
    "check_extent",
    "check_zoom",
    "check_grid_3d",
    "decimate",
    "draw_curves",
    "draw_drop_lines",
    "parse_curves",
    "set_log_zticks",
    "set_view",
    "tight_limits",
    "axes_3d",
    "DROP_LINES_MAX",
    "SURFACE_MAX_CELLS",
    "draw_surface",
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


# The interactive 3-D view's zoom range (frontend lib/project3d.ts ZOOM_RANGE):
# the export draws the same magnification, so screen and figure crop alike.
ZOOM_MIN, ZOOM_MAX = 0.5, 3.0


def check_zoom(zoom: float) -> None:
    if not (math.isfinite(zoom) and ZOOM_MIN <= zoom <= ZOOM_MAX):
        raise ValueError(f"view_zoom must be a finite number from {ZOOM_MIN} to {ZOOM_MAX}")


# The screen draws a surface at full grid resolution (matplotlib's plot_surface
# would sample 50 x 50). Beyond this many cells a side both step the grid alike.
SURFACE_MAX_CELLS = 500
# Drop lines on more points than this are thinned evenly (every k-th point),
# here and on screen (`render3dMarks.ts` DROP_LINES_MAX): 50k grey lines are a
# solid wall, not a reading aid.
DROP_LINES_MAX = 5_000

# The 3-D figure's layout, in figure fractions: the axes rectangle (matplotlib
# squares the 3-D projection inside it) and, with a colour bar, the bar's own
# axes to its right. FIXED, not tight_layout: tight_layout measures a zoomed
# box's overflow as "content" and shrinks the axes to fit it, so a zoom-2 export
# came out barely larger than zoom 1 -- the screen magnifies, and so must this.
_CB_FRAC = 0.20


def _stepped(n: int, step: int) -> NDArray[np.intp]:
    """0, step, 2*step, ... and always the last index (`render3dMarks.stepped`)."""
    return np.unique(np.append(np.arange(0, n - 1, step), n - 1))


def draw_surface(
    ax: Any, x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64], cmap: str
) -> Any:
    """The surface as the screen draws it (`render3dMarks.surfaceQuads`): one quad
    per grid cell, coloured by its corners' mean z, and NO quad touching a gap
    (plot_surface instead keeps the cell's finite corners as a triangle).
    Painted far to near by mean depth (matplotlib's ``zsort="average"`` is the
    screen's painter's algorithm). Rasterized like the heatmap's mesh: one
    vector polygon per cell seams in every viewer."""
    step = max(1, math.ceil(max(x.size, y.size) / SURFACE_MAX_CELLS))
    xi, yi = _stepped(x.size, step), _stepped(y.size, step)
    xg, yg = np.meshgrid(x[xi], y[yi])
    zg = z[np.ix_(yi, xi)]
    grid = np.stack([xg, yg, zg], axis=-1)  # (my, mx, 3)
    quads = np.stack([grid[:-1, :-1], grid[:-1, 1:], grid[1:, 1:], grid[1:, :-1]], axis=2)
    quads = quads[np.isfinite(quads[..., 2]).all(axis=2)]  # (n, 4, 3)
    pc = Poly3DCollection(
        quads, cmap=cmap, linewidth=0, antialiased=True, rasterized=True, zsort="average"
    )
    pc.set_array(quads[..., 2].mean(axis=1))
    ax.add_collection3d(pc, autolim=False)
    fin = zg[np.isfinite(zg)]
    ax.auto_scale_xyz(
        [float(x.min()), float(x.max())], [float(y.min()), float(y.max())],
        [float(fin.min()), float(fin.max())], had_data=False,
    )
    return pc


def axes_3d(fig: Any, colorbar: bool, title: bool) -> tuple[Any, Any]:
    """The 3-D axes and (with ``colorbar``) the colour bar's axes, laid out
    fixed; the bar is drawn OVER a zoomed box, as the screen's is."""
    right = 1.0 - (_CB_FRAC if colorbar else 0.0)
    top = 0.90 if title else 0.96
    ax = fig.add_axes((0.03, 0.04, right - 0.05, top - 0.04), projection="3d")
    cax = None
    if colorbar:
        cax = fig.add_axes((right + 0.01, 0.15, 0.025, 0.70))
        cax.set_zorder(ax.get_zorder() + 1)
    return ax, cax


def tight_limits(ax: Any) -> None:
    """Axis limits at exactly the drawn data's extent -- the screen's box --
    instead of matplotlib's padded autoscale (5% margins), so a surface meets
    the walls and drop lines reach the floor in both. A flat range is padded as
    the screen pads it (5% of the value, or 0.5 at zero)."""
    def span(lo: float, hi: float) -> tuple[float, float]:
        if not (math.isfinite(lo) and math.isfinite(hi)):
            return 0.0, 1.0
        if hi > lo:
            return lo, hi
        pad = abs(lo) * 0.05 or 0.5
        return lo - pad, hi + pad

    ax.set_xlim(*span(*ax.xy_dataLim.intervalx))
    ax.set_ylim(*span(*ax.xy_dataLim.intervaly))
    ax.set_zlim(*span(*ax.zz_dataLim.intervalx))


def set_view(ax: Any, elev: float, azim: float, zoom: float) -> None:
    """The interactive view's camera on a 3-D axes: the same elevation and
    azimuth, an ORTHOGRAPHIC projection (the screen view has no perspective;
    matplotlib's default 90-degree perspective would bend the box differently)
    and the same zoom of matplotlib's default 4:4:3 box."""
    # Exactly +/-90 is matplotlib's degenerate pole (its up vector is undefined
    # there and it falls back to a fudge that turns the plot ~3 degrees off the
    # azimuth); the screen camera is the limit approaching the pole, which a
    # 1e-6 degree step reproduces exactly.
    pole = 90.0 - 1e-6
    ax.view_init(elev=max(-pole, min(pole, elev)), azim=azim)
    ax.set_proj_type("ortho")
    ax.set_box_aspect((4, 4, 3), zoom=zoom)
    tight_limits(ax)
    # The screen crops a zoomed plot at the canvas edge, not at an axes square
    # (the panes and grid already overflow it): let the marks overflow too.
    for artist in [*ax.collections, *ax.lines]:
        artist.set_clip_on(False)


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


def draw_drop_lines(
    ax: Any, x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64]
) -> None:
    """A 3-D scatter's drop lines: each point joined straight down to the lowest
    z drawn (one collection, so 50k points stay one path)."""
    if z.size == 0:
        return
    floor = float(np.min(z))
    if z.size > DROP_LINES_MAX:
        keep = np.arange(0, z.size, math.ceil(z.size / DROP_LINES_MAX))
        x, y, z = x[keep], y[keep], z[keep]
    base = np.column_stack([x, y, np.full(z.size, floor)])
    segs = np.stack([base, np.column_stack([x, y, z])], axis=1)
    ax.add_collection3d(Line3DCollection(segs, colors="0.45", linewidths=0.4, alpha=0.5))


def set_log_zticks(ax: Any, log_decade_ticks: Any) -> None:
    """Under a log colour scale z holds log10 values: label the z axis by value
    (1e-4, 0.01) as the colour bar is, not by bare exponents."""
    ticks = log_decade_ticks(*ax.get_zlim())
    if ticks:
        ax.set_zticks([k for k, _ in ticks], labels=[label for _, label in ticks])
