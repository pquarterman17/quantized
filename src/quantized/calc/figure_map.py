"""Publication rendering for 2-D maps: contour, filled contour, 3-D surface.

ORIGIN_GAP_PLAN #17 (filled/labeled contour, incl. the scattered tri-contour
remainder) + #19 (3-D static export). Pure layer: either a gridded map
(``x_axis``/``y_axis``/``z_grid``, the ``calc.map.MapData`` shape,
``contour_source="grid"``) or a raw scattered cloud (``x_axis``/``y_axis``/
``z_values`` all the same length -- the RSM point-cloud shape produced by
``io/_xrdml_scan.py``'s snapshot/coupled layouts, ``contour_source="points"``)
in -> image bytes out, via matplotlib (vector by default), matching
``calc.figure.render_figure``'s style/format/dpi/tick conventions so 1-D and
2-D exports share presets. 3-D (surface / scatter / waterfall) is the static
publication path; interactive 3-D is deferred (#22).
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.tri as mtri  # noqa: E402
import numpy as np  # noqa: E402
from mpl_toolkits.mplot3d import Axes3D  # noqa: E402,F401  (registers the 3d projection)
from numpy.typing import ArrayLike, NDArray  # noqa: E402

from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = ["MAP_KINDS", "render_map_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")
MAP_KINDS = ("contourf", "contour", "heatmap", "surface", "scatter3d", "waterfall")
_3D_KINDS = ("surface", "scatter3d", "waterfall")
_CONTOUR_SOURCES = ("grid", "points")
_POINTS_KINDS = ("contour", "contourf")  # tricontour has no heatmap/3-D analogue here


def _contour_levels(
    z_min: float, z_max: float, levels: int | list[float], scale: str
) -> NDArray[np.float64]:
    """Explicit contour levels: ``levels`` count (or a list), lin or log spaced."""
    if isinstance(levels, (list, tuple)):
        arr = np.asarray(sorted(float(x) for x in levels), dtype=float)
        if arr.size < 2:  # matplotlib's contourf needs >= 2 levels
            raise ValueError("levels list needs at least 2 entries")
        return arr
    n = int(levels)
    if n < 2:
        raise ValueError("levels count must be >= 2")
    if not (np.isfinite(z_min) and np.isfinite(z_max) and z_max > z_min):
        raise ValueError("map has no finite z-range to contour")
    if scale == "log":
        if z_max <= 0:
            raise ValueError("log level_scale needs a positive z-range")
        lo = z_min if z_min > 0 else z_max * 1e-3
        return np.asarray(np.logspace(np.log10(lo), np.log10(z_max), n), dtype=float)
    if scale != "linear":
        raise ValueError("level_scale must be 'linear' or 'log'")
    return np.asarray(np.linspace(z_min, z_max, n), dtype=float)


def render_map_figure(
    x_axis: ArrayLike,
    y_axis: ArrayLike,
    z_grid: ArrayLike | None = None,
    *,
    contour_source: str = "grid",
    z_values: ArrayLike | None = None,
    kind: str = "contourf",
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    z_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    cmap: str = "viridis",
    levels: int | list[float] = 12,
    level_scale: str = "linear",
    label_contours: bool = True,
    colorbar: bool = True,
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    view_elev: float = 30.0,
    view_azim: float = -60.0,
) -> bytes:
    """Render a 2-D map to image bytes in the chosen ``kind``.

    Two input shapes, selected by ``contour_source``:

    - ``"grid"`` (default) — ``z_grid`` is ``(ny, nx)`` over ``x_axis``
      ``(nx,)`` / ``y_axis`` ``(ny,)`` (NaN outside the data hull is left
      blank), the regridded ``calc.map.MapData`` shape. All of ``MAP_KINDS``
      are available.
    - ``"points"`` — ``x_axis`` / ``y_axis`` / ``z_values`` are raw scattered
      arrays of equal length (e.g. an RSM point cloud straight off
      ``io/_xrdml_scan.py``'s snapshot/coupled layouts, never regridded).
      Only ``kind`` ``"contour"`` / ``"contourf"`` apply; the cloud is
      Delaunay-triangulated (``matplotlib.tri.Triangulation``) and drawn with
      ``tricontour`` / ``tricontourf``. Degenerate input (e.g. collinear
      points, or fewer than 3 finite points) raises ``ValueError``.

    ``kind``:

    - ``contourf`` / ``contour`` — filled / line contours; ``levels`` is a
      count or explicit list, ``level_scale`` lin or log, ``label_contours``
      draws inline labels on the line variant. Same level semantics
      (:func:`_contour_levels`) for both ``contour_source`` values.
    - ``heatmap`` — ``pcolormesh`` of the grid (``"grid"`` source only).
    - ``surface`` / ``scatter3d`` / ``waterfall`` — static 3-D (mplot3d),
      viewed from (``view_elev``, ``view_azim``) (``"grid"`` source only).

    ``fmt`` / ``style`` / size overrides match ``render_figure``. ``dpi``
    defaults to the style preset's calibrated resolution when not given
    (``None``), same as ``calc.figure``'s ``resolved_dpi`` convention; the
    preset's box-tick convention (``xtick.top``/``ytick.right`` mirrored
    when the preset draws a closed box) is honored too.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if kind not in MAP_KINDS:
        raise ValueError(f"kind must be one of {MAP_KINDS}")
    if contour_source not in _CONTOUR_SOURCES:
        raise ValueError(f"contour_source must be one of {_CONTOUR_SOURCES}")
    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)

    if contour_source == "points":
        if kind not in _POINTS_KINDS:
            raise ValueError(
                f"contour_source='points' only supports kind {_POINTS_KINDS}, got {kind!r}"
            )
        if z_values is None:
            raise ValueError("z_values is required when contour_source='points'")
        xr = np.asarray(x_axis, dtype=float).ravel()
        yr = np.asarray(y_axis, dtype=float).ravel()
        zr = np.asarray(z_values, dtype=float).ravel()
        if not (xr.size == yr.size == zr.size):
            raise ValueError(
                "x_axis/y_axis/z_values must have the same length for "
                f"contour_source='points', got {xr.size}/{yr.size}/{zr.size}"
            )
        finite = np.isfinite(xr) & np.isfinite(yr) & np.isfinite(zr)
        x, y, z = xr[finite], yr[finite], zr[finite]
        if x.size < 3:
            raise ValueError("need at least 3 finite points to triangulate a scattered contour")
        z_min, z_max = float(np.min(z)), float(np.max(z))
    else:
        if z_grid is None:
            raise ValueError("z_grid is required when contour_source='grid'")
        x = np.asarray(x_axis, dtype=float).ravel()
        y = np.asarray(y_axis, dtype=float).ravel()
        z = np.asarray(z_grid, dtype=float)
        if z.ndim != 2 or z.shape != (y.size, x.size):
            raise ValueError(f"z_grid must be (ny, nx) = ({y.size}, {x.size}), got {z.shape}")
        if x.size < 2 or y.size < 2:
            raise ValueError(f"a map needs at least a 2x2 grid, got ({y.size}, {x.size})")

        if np.any(np.isfinite(z)):
            z_min, z_max = float(np.nanmin(z)), float(np.nanmax(z))
        else:
            z_min = z_max = float("nan")  # all-gaps map; contour kinds raise below

    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
        # Mirror ticks onto the top/right spines whenever the preset draws a
        # closed box (matches calc.figure's convention; matplotlib's default
        # leaves top/right bare even with the full rectangular border).
        "xtick.top": st.box_on,
        "ytick.right": st.box_on,
    }

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        if kind in _3D_KINDS:
            fig = plt.figure(figsize=figsize)
            ax = fig.add_subplot(projection="3d")
        else:
            fig, ax = plt.subplots(figsize=figsize)
        try:
            mappable = _draw(
                ax, kind, x, y, z, z_min, z_max, cmap, levels, level_scale,
                label_contours, view_elev, view_azim, contour_source=contour_source,
            )
            if title:
                ax.set_title(title)
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
            if kind in _3D_KINDS and z_label:
                ax.set_zlabel(z_label)
            if colorbar and mappable is not None:
                fig.colorbar(mappable, ax=ax, label=z_label or None, shrink=0.8)
            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)


def _draw(
    ax: Any,
    kind: str,
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    z: NDArray[np.float64],
    z_min: float,
    z_max: float,
    cmap: str,
    levels: int | list[float],
    level_scale: str,
    label_contours: bool,
    view_elev: float,
    view_azim: float,
    *,
    contour_source: str = "grid",
) -> Any:
    """Draw the requested mark; return the colorbar mappable (or None)."""
    if contour_source == "points":
        # x/y/z are flat, equal-length scattered arrays here (not a grid) --
        # Delaunay-triangulate the cloud and contour straight off the
        # triangulation, no regridding. Same level semantics as the grid path.
        lv = _contour_levels(z_min, z_max, levels, level_scale)
        try:
            tri = mtri.Triangulation(x, y)
        except RuntimeError as exc:
            # qhull raises RuntimeError on degenerate input (e.g. all points
            # collinear) -- surface it as a clean ValueError (-> 422), not a
            # matplotlib internals leak.
            raise ValueError(
                "points are degenerate (e.g. collinear) and cannot be triangulated"
            ) from exc
        if kind == "contourf":
            return ax.tricontourf(tri, z, levels=lv, cmap=cmap)
        cs = ax.tricontour(tri, z, levels=lv, cmap=cmap)
        if label_contours:
            ax.clabel(cs, inline=True, fontsize=7, fmt="%.3g")
        return cs

    if kind == "heatmap":
        return ax.pcolormesh(x, y, z, cmap=cmap, shading="auto")
    if kind in ("contourf", "contour"):
        lv = _contour_levels(z_min, z_max, levels, level_scale)
        if kind == "contourf":
            return ax.contourf(x, y, z, levels=lv, cmap=cmap)
        cs = ax.contour(x, y, z, levels=lv, cmap=cmap)
        if label_contours:
            ax.clabel(cs, inline=True, fontsize=7, fmt="%.3g")
        return cs

    # 3-D kinds
    ax.view_init(elev=view_elev, azim=view_azim)
    xg, yg = np.meshgrid(x, y)  # (ny, nx)
    if kind == "surface":
        return ax.plot_surface(xg, yg, z, cmap=cmap, linewidth=0, antialiased=True)
    if kind == "scatter3d":
        finite = np.isfinite(z)
        sc = ax.scatter(
            xg[finite], yg[finite], z[finite], c=z[finite], cmap=cmap, s=6, depthshade=True
        )
        return sc
    # waterfall: one profile line per y-row, stacked in depth
    line_cmap = matplotlib.colormaps[cmap]
    for j in range(y.size):
        row = z[j]
        finite = np.isfinite(row)
        if not finite.any():
            continue
        frac = j / max(1, y.size - 1)
        ax.plot(x[finite], np.full(int(finite.sum()), y[j]), row[finite], color=line_cmap(frac))
    return None
