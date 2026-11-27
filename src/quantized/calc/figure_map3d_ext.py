"""3-D bars and 3-D vectors for ``calc.figure_map``'s static 3-D export.

Two marks beside the map's surface / scatter / waterfall, drawn from the SAME
orthographic camera (``figure_map3d.set_view``) as the interactive view
(``frontend/src/components/Stage/Map3D``), whose scene builder mirrors every
rule here -- the footprint, the extents, the arrowhead and every refusal -- and
which reads the same shared wire fixture
(``tests/fixtures/wire/plot3d_kinds.json``).

* ``bars3d``: one box per finite cell of a gridded map, or per row of an XYZ
  column set. Width and depth are FRACTIONS (0..1] of the median step between
  the sorted distinct x (resp. y) positions, so a fraction of 1 makes bars of
  a regular grid touch. Coloured by height (a colour bar) or one fixed colour.
  Drawn with ``Axes3D.bar3d`` (matplotlib's own face sort and shading; the
  screen shades its faces alike but not to the digit).
* ``vectors3d``: one arrow per XYZ row, from the tail (x, y, z) by a delta
  (dX, dY, dZ) or to an end point, scaled by ``vec_scale``. The shaft and four
  head barbs are segments of one ``Line3DCollection``; the head is built in BOX
  coordinates (so it looks the same on a z axis of any magnitude).

Pure (arrays in, matplotlib calls out). Every refusal is a ``ValueError`` with a
reason a user can act on (the route turns it into a 422).
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any

import numpy as np
from matplotlib.colors import Normalize
from mpl_toolkits.mplot3d.art3d import Line3DCollection
from numpy.typing import NDArray

from quantized.calc.figure_map3d import check_extent

__all__ = [
    "BOX",
    "DEFAULT_VECTOR_COLOR",
    "EXT_3D_KINDS",
    "HEAD_SPREAD",
    "MAX_BARS",
    "MAX_VECTORS",
    "bar_footprint",
    "check_color",
    "draw_bars",
    "draw_vectors",
    "padded_span",
    "prepare_bars",
    "prepare_vectors",
    "vector_extent",
    "vector_segments",
]

EXT_3D_KINDS = ("bars3d", "vectors3d")
# Drawing cost, not a data limit: 10k bars are 60k matplotlib faces (~2 s), and the
# canvas paints them with a painter's sort. Refused, never silently sampled -- a
# sampled bar chart of a grid is a different chart.
MAX_BARS = 10_000
MAX_VECTORS = 20_000
DEFAULT_VECTOR_COLOR = "#2a6fdb"
# matplotlib's default 4:4:3 box, as box-coordinate side lengths (``lib/project3d.ts`` BOX).
BOX = (1.0, 1.0, 0.75)
# Half-width of the arrowhead, as a fraction of the head's length.
HEAD_SPREAD = 0.35
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def check_color(color: str | None, what: str) -> None:
    if color is not None and not _HEX.match(color):
        raise ValueError(f"{what} must be a #rrggbb colour, got {color!r}")


def _median_step(v: NDArray[np.float64]) -> float:
    u = np.unique(v)
    return float(np.median(np.diff(u))) if u.size > 1 else 0.0


def bar_footprint(
    x: NDArray[np.float64], y: NDArray[np.float64], width: float, depth: float
) -> tuple[float, float]:
    """The bars' footprint (dx, dy) in data units: ``width`` / ``depth`` times the
    median step between distinct x / y positions."""
    for name, frac in (("bar_width", width), ("bar_depth", depth)):
        if not (math.isfinite(frac) and 0.0 < frac <= 1.0):
            raise ValueError(
                f"{name} must be a number above 0 and at most 1 (a fraction of the spacing)"
            )
    sx, sy = _median_step(x), _median_step(y)
    if not (sx > 0.0 and sy > 0.0):
        raise ValueError(
            "3-D bars need at least 2 distinct x positions and 2 distinct y positions to size them"
        )
    return width * sx, depth * sy


def padded_span(lo: float, hi: float) -> tuple[float, float]:
    """An axis range as the screen and ``tight_limits`` draw it: a flat range is
    padded by 5% of its value (0.5 at zero)."""
    if hi > lo:
        return lo, hi
    pad = abs(lo) * 0.05 or 0.5
    return lo - pad, hi + pad


def prepare_bars(
    x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64],
    opts: Mapping[str, Any],
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], float, float, float]:
    """Validate a bar request: ``x`` / ``y`` / ``z`` are the bars' FLAT, finite
    anchors (cell centres) and tops. Returns them with (dx, dy, base)."""
    check_color(opts.get("bar_color"), "bar_color")
    if x.size < 1:
        raise ValueError("a 3-D bar plot needs at least 1 finite bar")
    if x.size > MAX_BARS:
        raise ValueError(
            f"a 3-D bar plot draws at most {MAX_BARS:,} bars; this has {x.size:,} "
            "(lower the map resolution or crop it)"
        )
    base = opts.get("bar_base")
    base = 0.0 if base is None else float(base)
    if not math.isfinite(base):
        raise ValueError("bar_base must be a finite number")
    width, depth = float(opts.get("bar_width", 0.8)), float(opts.get("bar_depth", 0.8))
    dx, dy = bar_footprint(x, y, width, depth)
    check_extent(x, y, z, np.array([base]))
    return x, y, z, dx, dy, base


def draw_bars(
    ax: Any, x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64],
    dx: float, dy: float, base: float, cmap: Any, norm: Normalize, color: str | None,
) -> None:
    """The bars as ``bar3d`` boxes anchored at their back-left corners, each from
    ``base`` to its z. Coloured by height through ``cmap`` / ``norm``, or ``color``."""
    face = color if color is not None else cmap(norm(z))
    ax.bar3d(
        x - dx / 2, y - dy / 2, np.full(z.size, base), dx, dy, z - base, color=face, shade=True
    )


def prepare_vectors(
    x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64],
    opts: Mapping[str, Any],
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Validate a vector request and return the (n, 3) tails and tips that are
    drawn. ``x`` / ``y`` / ``z`` are the tails; ``vec_dx`` / ``vec_dy`` /
    ``vec_dz`` are deltas (``vec_form='delta'``) or end points (``'end'``), times
    ``vec_scale``. A row with any non-finite value, or no length, is
    not drawn; at least one must be."""
    check_color(opts.get("vec_color"), "vec_color")
    form = opts.get("vec_form", "delta")
    if form not in ("delta", "end"):
        raise ValueError("vec_form must be 'delta' or 'end'")
    scale = float(opts.get("vec_scale", 1.0))
    head = float(opts.get("vec_head", 0.2))
    if not (math.isfinite(scale) and scale > 0.0):
        raise ValueError("vec_scale must be a positive number")
    if not (math.isfinite(head) and 0.0 < head <= 0.5):
        raise ValueError(
            "vec_head must be a number above 0 and at most 0.5 (a fraction of the length)"
        )
    cols = [opts.get(k) for k in ("vec_dx", "vec_dy", "vec_dz")]
    if any(c is None for c in cols):
        raise ValueError("3-D vectors need the vec_dx, vec_dy and vec_dz columns")
    arrays: list[NDArray[np.float64]] = [
        np.asarray([np.nan if v is None else v for v in (c if c is not None else [])],
                   dtype=np.float64)
        for c in cols
    ]
    d: NDArray[np.float64] = np.column_stack(arrays)
    tails: NDArray[np.float64] = np.column_stack([x, y, z])
    if d.shape[0] != tails.shape[0]:
        raise ValueError(
            f"vec_dx/vec_dy/vec_dz must have one value per row ({tails.shape[0]}), got {d.shape[0]}"
        )
    ok = np.isfinite(d).all(axis=1) & np.isfinite(tails).all(axis=1)
    tails, d = tails[ok], d[ok]
    delta = d - tails if form == "end" else d
    tips = tails + delta * scale
    live = np.linalg.norm(tips - tails, axis=1) > 0.0
    tails, tips = tails[live], tips[live]
    if tails.shape[0] < 1:
        raise ValueError("no 3-D vector has a finite start and a non-zero length")
    if tails.shape[0] > MAX_VECTORS:
        raise ValueError(f"3-D vectors draw at most {MAX_VECTORS:,}; got {tails.shape[0]:,}")
    check_extent(tails, tips)
    return tails, tips


def vector_extent(
    tails: NDArray[np.float64], tips: NDArray[np.float64]
) -> list[tuple[float, float]]:
    """The axes' (lo, hi) per axis: the hull of every tail and tip, a flat axis padded."""
    both = np.vstack([tails, tips])
    return [padded_span(float(both[:, i].min()), float(both[:, i].max())) for i in range(3)]


def vector_segments(
    tails: NDArray[np.float64], tips: NDArray[np.float64],
    limits: list[tuple[float, float]], head: float,
) -> NDArray[np.float64]:
    """Each arrow's five segments, in DATA coordinates: shaft (tail to tip) and
    four barbs from the tip back along the shaft, spread across two directions
    perpendicular to it. Built in box coordinates (``limits`` onto ``BOX``) so the
    head keeps its shape on any axis scale. Shape (n, 5, 2, 3)."""
    lo = np.array([a for a, _ in limits])
    span = np.array([b - a for a, b in limits])
    side = np.array(BOX)

    def to_box(v: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(((v - lo) / span - 0.5) * side, dtype=float)

    def to_data(b: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(lo + (b / side + 0.5) * span, dtype=float)

    t0, t1 = to_box(tails), to_box(tips)
    d = t1 - t0
    length = np.linalg.norm(d, axis=1, keepdims=True)
    u = d / np.where(length > 0.0, length, 1.0)
    # The reference axis is z, unless the arrow runs (nearly) along it.
    ref = np.where((np.abs(u[:, 2:3]) < 0.95), np.array([0.0, 0.0, 1.0]), np.array([1.0, 0.0, 0.0]))
    p1 = np.cross(u, ref)
    p1 /= np.linalg.norm(p1, axis=1, keepdims=True)
    p2 = np.cross(u, p1)
    back = t1 - u * head * length
    w = HEAD_SPREAD * head * length
    out = np.empty((tails.shape[0], 5, 2, 3))
    out[:, 0, 0], out[:, 0, 1] = tails, tips
    for k, (vec, sign) in enumerate([(p1, 1.0), (p1, -1.0), (p2, 1.0), (p2, -1.0)], start=1):
        out[:, k, 0] = tips
        out[:, k, 1] = to_data(back + sign * vec * w)
    return out


def draw_vectors(
    ax: Any, tails: NDArray[np.float64], tips: NDArray[np.float64], head: float, color: str | None,
    colors: NDArray[np.float64] | None = None,
) -> None:
    """The arrows as one ``Line3DCollection``; the axes span the tails and tips
    (``vector_extent``), set explicitly so a barb never moves the frame."""
    lim = vector_extent(tails, tips)
    segs = vector_segments(tails, tips, lim, head).reshape(-1, 2, 3)
    # ``colors``: one RGBA row per arrow (colour by length); its 5 segments share it.
    line_colors: Any = color or DEFAULT_VECTOR_COLOR
    if colors is not None:
        line_colors = np.repeat(colors, 5, axis=0)
    ax.add_collection3d(Line3DCollection(segs, colors=line_colors, linewidths=1.0), autolim=False)
    ax.auto_scale_xyz(*[[a, b] for a, b in lim], had_data=False)
