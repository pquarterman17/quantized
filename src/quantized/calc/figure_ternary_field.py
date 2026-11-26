"""Publication rendering of composition maps on the ternary triangle.

Plan item 21. Pure layer (matplotlib, no web types): three composition columns
plus a value column Z -> a filled contour (optional contour lines and labels)
or a heatmap of triangular cells, with a colour bar. The numerics --
normalisation, the Delaunay surface, the levels and band colours -- live in
``calc.ternary_field``; this module only draws them:

* ``kind="contour"``: ``tricontourf`` on the *same* Delaunay triangles the
  surface interpolates over (so Z is linear on each triangle and nothing is
  drawn outside the data's convex hull). Band ``i`` is painted with the colour
  map at ``band_fractions(levels)[i]``; lines sit on the interior band edges.
* ``kind="heatmap"``: ``heat_cells`` triangles coloured by the colour map over
  the same ``[lo, hi]`` range, clipped to the convex hull.

Rows that cannot be normalised are left out and counted in a figure warning
(``calc.figure_warnings``), never a failure of the whole figure.
"""

from __future__ import annotations

from typing import Any

import matplotlib
import matplotlib.tri as mtri
import numpy as np
from matplotlib.collections import PolyCollection
from matplotlib.colors import Normalize
from matplotlib.patches import Polygon
from numpy.typing import ArrayLike

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style
from quantized.calc.figure_ternary_frame import draw_ternary_frame
from quantized.calc.figure_warnings import note_figure_warning
from quantized.calc.ternary_field import (
    TernarySurface,
    band_fractions,
    contour_bounds,
    heat_cells,
    normalise_rows,
    ternary_xy,
)

__all__ = ["KINDS", "render_ternary_field_figure"]

KINDS = ("contour", "heatmap")
_FORMATS = ("pdf", "svg", "eps", "png", "tiff")
_FIGURE_SIZE_IN = (8, 7)


def render_ternary_field_figure(
    data: ArrayLike,
    z: ArrayLike,
    *,
    kind: str = "contour",
    labels: tuple[str, str, str] = ("A", "B", "C"),
    z_label: str = "Value",
    cmap: str = "viridis",
    levels: int = 8,
    lines: bool = True,
    line_labels: bool = False,
    points: bool = True,
    z_limits: tuple[float, float] | None = None,
    heat_div: int = 24,
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    title: str = "",
) -> bytes:
    """Render Z over the ternary triangle as a filled contour or a heatmap.

    ``data`` is (n, 3) compositions (fractions or percentages; each row is
    divided by its sum), ``z`` the n values. Z is interpolated linearly on the
    Delaunay triangles of the points and never extrapolated beyond their
    convex hull. ``levels`` equal bands span ``z_limits`` (default the data's
    range); ``lines``/``line_labels`` add contour lines and their values;
    ``points`` marks the data compositions. ``heat_div`` is the number of
    cells along each triangle edge for ``kind="heatmap"``.

    Raises ``ValueError`` on bad input: unknown ``kind``/``fmt``/``cmap``,
    fewer than three drawable distinct compositions, collinear points, or a
    Z with no range.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    if cmap not in matplotlib.colormaps:
        raise ValueError(f"unknown colormap {cmap!r}")
    arr = np.asarray(data, dtype=float)
    rows = normalise_rows(arr, z)
    note = rows.warning(arr.shape[0])
    if note:
        note_figure_warning(note)
    x, y = ternary_xy(rows.abc)
    surface = TernarySurface(x, y, rows.z)
    bounds = contour_bounds(surface.z, levels if kind == "contour" else 1, z_limits)
    lo, hi = float(bounds[0]), float(bounds[-1])

    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    rc: dict[str, Any] = {
        **font_family_rc(st),
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
    }
    with render_scope(rc):
        title = safe_mathtext_label(title)
        corner = (
            safe_mathtext_label(str(labels[0])),
            safe_mathtext_label(str(labels[1])),
            safe_mathtext_label(str(labels[2])),
        )
        bar_label = safe_mathtext_label(z_label)
        fig = new_figure(figsize=_FIGURE_SIZE_IN)
        ax = fig.subplots()
        draw_ternary_frame(ax, corner, st.font_size)
        if kind == "contour":
            mappable = _draw_contour(
                ax, surface, bounds, cmap, lines, line_labels, st.font_size - 2
            )
        else:
            mappable = _draw_heatmap(ax, surface, lo, hi, cmap, heat_div)
        if points:
            ax.scatter(x, y, s=8, c="black", alpha=0.6, linewidths=0, zorder=5)
        fig.colorbar(mappable, ax=ax, label=bar_label, fraction=0.046, pad=0.04)
        if title:
            fig.suptitle(title, fontsize=st.title_font_size)
        fig.tight_layout()
        return savefig_bytes(fig, fmt, dpi=resolved_dpi)


def _draw_contour(
    ax: Any, surface: TernarySurface, bounds: Any, cmap: str, lines: bool,
    line_labels: bool, label_size: float,
) -> Any:
    tri = mtri.Triangulation(surface.x, surface.y, surface.triangles)
    cm = matplotlib.colormaps[cmap]
    colours = [cm(float(f)) for f in band_fractions(len(bounds) - 1)]
    filled = ax.tricontourf(tri, surface.z, levels=bounds, colors=colours, extend="neither")
    interior = bounds[1:-1]
    if (lines or line_labels) and len(interior):
        cs = ax.tricontour(tri, surface.z, levels=interior, colors="black", linewidths=0.6)
        if line_labels:
            ax.clabel(cs, fmt="%g", fontsize=label_size)
    return filled


def _draw_heatmap(
    ax: Any, surface: TernarySurface, lo: float, hi: float, cmap: str, div: int
) -> Any:
    cells, zc = heat_cells(surface, div)
    coll = PolyCollection(
        list(cells), array=zc, cmap=cmap, norm=Normalize(vmin=lo, vmax=hi),
        edgecolors="face", linewidths=0.3,
    )
    ax.add_collection(coll)
    coll.set_clip_path(Polygon(surface.hull_xy, closed=True, transform=ax.transData))
    return coll
