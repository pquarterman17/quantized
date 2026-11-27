"""3-D scatter extras for ``calc.figure_map``'s static 3-D export.

What Origin's 3-D scatter has and the plain ``scatter3d`` lacks, every one an
opt-in request field (off = the plain scatter, untouched):

* ``sc_color``  -- colour the points by a column (a colour bar over the column's
  own range, titled ``sc_color_label``; never the map's z colour limits).
* ``sc_size``   -- size the markers by a column, diameter 3..10 pt linear in the
  value (a flat column draws the middle size).
* ``sc_group`` / ``sc_group_names`` -- a group per row (an index into the names),
  each group its own colour from ``GROUP_COLORS`` and a legend. Colour by a
  column and groups are two ways to colour: asking for both is refused.
* ``sc_err_x`` / ``sc_err_y`` / ``sc_err_z`` -- a symmetric error (half length,
  data units) per row on each axis; a non-finite or negative one is not drawn.
* ``wall_xy`` / ``wall_xz`` / ``wall_yz`` -- the points' shadows on the back
  panes: the face of each axis FARTHER from the viewer, the pane the screen
  draws behind the data (``lib/project3d.ts`` ``backFaces``).

Every rule here -- which rows are drawn, the sizes, the colour range, the group
order, the hull the axes span, the wall coordinates -- is mirrored by the
interactive view (``frontend/src/components/Stage/Map3D/scatterExtras3d.ts``) and
pinned together by ``tests/fixtures/wire/plot3d_scatter.json``.

Pure (arrays in, matplotlib calls out). Every refusal is a ``ValueError`` with a
reason a user can act on (the route turns it into a 422).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from matplotlib.colors import Normalize
from matplotlib.lines import Line2D
from mpl_toolkits.mplot3d.art3d import Line3DCollection
from numpy.typing import NDArray

from quantized.calc.figure_map3d import MAX_SCATTER_POINTS, check_extent, decimate
from quantized.calc.figure_map3d_ext import padded_span

__all__ = [
    "COLUMN_FIELDS",
    "DEFAULT_AREA",
    "ERROR_COLOR",
    "GROUP_COLORS",
    "MAX_GROUPS",
    "SIZE_DIAMETER",
    "WALL_COLOR",
    "WALL_FIELDS",
    "ScatterPlan",
    "draw_scatter",
    "hull",
    "plan_scatter",
    "scatter_active",
    "wall_values",
]

COLUMN_FIELDS = ("sc_color", "sc_size", "sc_group", "sc_err_x", "sc_err_y", "sc_err_z")
WALL_FIELDS = ("wall_xy", "wall_xz", "wall_yz")
# matplotlib's tab10, spelled out so the screen and the export cannot drift.
GROUP_COLORS = (
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
)
MAX_GROUPS = len(GROUP_COLORS)
# Marker diameter in points, linear in the size column; the plain scatter's own area.
SIZE_DIAMETER = (3.0, 10.0)
DEFAULT_AREA = 6.0
WALL_COLOR = "#808080"
WALL_ALPHA = 0.35
ERROR_COLOR = "#555555"


def scatter_active(ext: Mapping[str, Any] | None) -> bool:
    """Whether a ``scatter3d`` request asks for any extra (else the plain scatter draws)."""
    e = ext or {}
    cols = any(e.get(k) is not None for k in COLUMN_FIELDS)
    return cols or any(bool(e.get(k)) for k in WALL_FIELDS)


@dataclass
class ScatterPlan:
    """The rows a scatter draws, after the row rules, with every per-row extra aligned."""

    x: NDArray[np.float64]
    y: NDArray[np.float64]
    z: NDArray[np.float64]
    color: NDArray[np.float64] | None
    diameter: NDArray[np.float64] | None
    codes: NDArray[np.intp] | None
    names: list[str]
    err: list[NDArray[np.float64] | None]  # per axis; NaN = no bar for that row
    rows: int  # rows given
    dropped: int  # rows not drawn (a gap in x, y, z or a picked column)
    err_skipped: int  # error values not drawn (non-finite or negative)
    note: str  # the sampling note, when the cloud was thinned


def _col(opts: Mapping[str, Any], key: str, n: int) -> NDArray[np.float64] | None:
    v = opts.get(key)
    if v is None:
        return None
    a = np.asarray([np.nan if t is None else t for t in v], dtype=np.float64)
    if a.size != n:
        raise ValueError(f"{key} must have one value per row ({n}), got {a.size}")
    return a


def plan_scatter(
    x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64],
    opts: Mapping[str, Any], *, source: str = "points",
) -> ScatterPlan:
    """Apply the row rules to a scatter request. ``x`` / ``y`` / ``z`` are the
    rows (or, from a grid, its finite cells: columns need ``source='points'``).

    A row is drawn when x, y, z and every picked colour / size column are finite
    and its group is one of the names; at least 3 must be. More than
    ``MAX_SCATTER_POINTS`` are thinned evenly (first and last kept), the extras
    with them. An error value draws only when finite and not negative.
    """
    n = int(x.size)
    given = [k for k in COLUMN_FIELDS if opts.get(k) is not None]
    if given and source != "points":
        raise ValueError(
            "per-point columns (colour, size, group, error bars) need contour_source='points'"
        )
    if opts.get("sc_color") is not None and opts.get("sc_group") is not None:
        raise ValueError("colour by a column or by groups, not both: send sc_color or sc_group")
    color = _col(opts, "sc_color", n)
    size = _col(opts, "sc_size", n)
    err = [_col(opts, k, n) for k in ("sc_err_x", "sc_err_y", "sc_err_z")]
    names = [str(s) for s in (opts.get("sc_group_names") or [])]
    codes: NDArray[np.intp] | None = None
    ok = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
    if opts.get("sc_group") is not None:
        g = opts["sc_group"]
        if len(g) != n:
            raise ValueError(f"sc_group must have one value per row ({n}), got {len(g)}")
        if not 1 <= len(names) <= MAX_GROUPS:
            raise ValueError(
                f"a 3-D scatter takes 1 to {MAX_GROUPS} groups; this column has {len(names)} "
                "(pick a column with fewer distinct values)"
            )
        raw = np.asarray([-1 if c is None else int(c) for c in g], dtype=np.intp)
        ok &= (raw >= 0) & (raw < len(names))
        codes = raw
    for arr in (color, size):
        if arr is not None:
            ok &= np.isfinite(arr)
    keep = np.flatnonzero(ok)
    if keep.size < 3:
        raise ValueError(f"a 3-D scatter needs at least 3 finite points; found {keep.size}")
    note = ""
    total = int(keep.size)
    if total > MAX_SCATTER_POINTS:
        keep = keep[decimate(total)]
        note = f"Plotting {keep.size:,} of {total:,} points, evenly sampled."

    def take(a: NDArray[Any] | None) -> NDArray[Any] | None:
        return None if a is None else a[keep]

    skipped = 0
    errs: list[NDArray[np.float64] | None] = []
    for e in err:
        t = take(e)
        if t is not None:
            bad = ~(np.isfinite(t) & (t >= 0.0))
            skipped += int(bad.sum())
            t = np.where(bad, np.nan, t)
        errs.append(t)
    diam: NDArray[np.float64] | None = None
    s = take(size)
    if s is not None:
        lo, hi = float(s.min()), float(s.max())
        t = (s - lo) / (hi - lo) if hi > lo else np.full(s.size, 0.5)
        diam = SIZE_DIAMETER[0] + (SIZE_DIAMETER[1] - SIZE_DIAMETER[0]) * t
    px, py, pz = x[keep], y[keep], z[keep]
    check_extent(px, py, pz, *[e for e in errs if e is not None])
    return ScatterPlan(
        px, py, pz, take(color), diam, take(codes), names, errs, n, n - total, skipped, note,
    )


def hull(plan: ScatterPlan) -> list[tuple[float, float]]:
    """The axes' (lo, hi) per axis: the points and the ends of every drawn error
    bar, a flat axis padded as the screen pads it."""
    out = []
    for k, a in enumerate((plan.x, plan.y, plan.z)):
        lo, hi = float(a.min()), float(a.max())
        e = plan.err[k]
        if e is not None and np.isfinite(e).any():
            lo = min(lo, float(np.nanmin(a - np.where(np.isfinite(e), e, 0.0))))
            hi = max(hi, float(np.nanmax(a + np.where(np.isfinite(e), e, 0.0))))
        out.append(padded_span(lo, hi))
    return out


def wall_values(
    limits: Sequence[tuple[float, float]], elev: float, azim: float
) -> tuple[float, float, float]:
    """Where the shadows land: for each axis the limit on the side FARTHER from
    the viewer (the low limit when the eye is on the positive side), as
    ``backFaces`` picks the panes. The eye is (cos e cos a, cos e sin a, sin e)."""
    e, a = elev * (math.pi / 180.0), azim * (math.pi / 180.0)
    eye = (math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))
    lo_hi = [lim[0] if eye[k] > 0 else lim[1] for k, lim in enumerate(limits)]
    return lo_hi[0], lo_hi[1], lo_hi[2]


def draw_scatter(
    ax: Any, plan: ScatterPlan, cmap: Any, norm: Normalize, walls: Sequence[bool],
    elev: float, azim: float, group_label: str, font_size: float,
) -> Any:
    """The points (and their extras) on ``ax``; returns the colour bar's mappable,
    or None when the points carry no colour scale (groups). The axes span the
    ``hull`` (set explicitly, so error bars and shadows never move the frame)."""
    area = plan.diameter**2 if plan.diameter is not None else DEFAULT_AREA
    lim = hull(plan)
    mappable: Any = None
    if plan.codes is not None:
        cols = [GROUP_COLORS[int(c)] for c in plan.codes]
        ax.scatter(plan.x, plan.y, plan.z, c=cols, s=area, depthshade=False)
        used = sorted({int(c) for c in plan.codes})
        handles = [
            Line2D([0], [0], marker="o", ls="", color=GROUP_COLORS[c], label=plan.names[c])
            for c in used
        ]
        ax.legend(
            handles=handles, loc="upper left", frameon=False, fontsize=font_size,
            title=group_label or None,
        )
    else:
        c_vals = plan.color if plan.color is not None else plan.z
        mappable = ax.scatter(
            plan.x, plan.y, plan.z, c=c_vals, cmap=cmap, norm=norm, s=area, depthshade=False,
        )
    segs: list[NDArray[np.float64]] = []
    pts = np.column_stack([plan.x, plan.y, plan.z])
    for k, e in enumerate(plan.err):
        if e is None:
            continue
        on = np.isfinite(e)
        lo, hi = pts[on].copy(), pts[on].copy()
        lo[:, k] -= e[on]
        hi[:, k] += e[on]
        segs.append(np.stack([lo, hi], axis=1))
    if segs:
        ax.add_collection3d(
            Line3DCollection(np.concatenate(segs), colors=ERROR_COLOR, linewidths=0.8),
            autolim=False,
        )
    wx, wy, wz = wall_values(lim, elev, azim)
    n = plan.x.size
    shadows = (
        (walls[0], (plan.x, plan.y, np.full(n, wz))),
        (walls[1], (plan.x, np.full(n, wy), plan.z)),
        (walls[2], (np.full(n, wx), plan.y, plan.z)),
    )
    for wanted, (sx, sy, sz) in shadows:
        if wanted:
            ax.scatter(
                sx, sy, sz, c=WALL_COLOR, s=area, alpha=WALL_ALPHA, linewidths=0, depthshade=False
            )
    ax.auto_scale_xyz(*[[a, b] for a, b in lim], had_data=False)
    return mappable
