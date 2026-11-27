"""The static figure for the 3-D bar and vector kinds (``figure_map3d_ext``).

Same frame as ``figure_map.render_map_figure``'s 3-D kinds -- the fixed measured
layout (``figure_map3d_layout``), the interactive view's camera (``set_view``),
the colour bar column -- around a different mark. Pure (arrays in, bytes out).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import matplotlib
import numpy as np
from matplotlib.cm import ScalarMappable
from matplotlib.colors import Normalize
from numpy.typing import ArrayLike, NDArray

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_map3d import (
    check_angles,
    check_extent,
    check_zoom,
    set_log_zticks,
    set_view,
)
from quantized.calc.figure_map3d_ext import (
    draw_bars,
    draw_vectors,
    padded_span,
    prepare_bars,
    prepare_vectors,
)
from quantized.calc.figure_map3d_layout import axes_3d, colorbar_axes, finish_3d
from quantized.calc.figure_map3d_scatter import ScatterPlan, draw_scatter, plan_scatter
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style

__all__ = ["figure_rc", "render_ext_figure"]


def figure_rc(st: Any) -> dict[str, Any]:
    """The rc settings every map figure renders under (box ticks mirrored when the
    preset draws a closed box, as ``calc.figure`` does)."""
    return {
        **font_family_rc(st),
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
        "xtick.top": st.box_on,
        "ytick.right": st.box_on,
    }


def _flat(
    kind: str, source: str, x_axis: ArrayLike, y_axis: ArrayLike,
    z_grid: ArrayLike | None, z_values: ArrayLike | None,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """The marks' anchors as flat arrays: finite grid cells (bars only), or the rows."""
    x = np.asarray(x_axis, dtype=float).ravel()
    y = np.asarray(y_axis, dtype=float).ravel()
    if source == "grid":
        if kind == "vectors3d":
            raise ValueError("3-D vectors need contour_source='points' (x, y, z columns)")
        if z_grid is None:
            raise ValueError("z_grid is required when contour_source='grid'")
        zg = np.asarray(z_grid, dtype=float)
        if zg.ndim != 2 or zg.shape != (y.size, x.size):
            raise ValueError(f"z_grid must be (ny, nx) = ({y.size}, {x.size}), got {zg.shape}")
        xg, yg = np.meshgrid(x, y)
        fin = np.isfinite(zg)
        return xg[fin], yg[fin], zg[fin]
    if source != "points":
        raise ValueError("3-D bars and vectors take contour_source 'grid' (bars) or 'points'")
    if z_values is None:
        raise ValueError("z_values is required when contour_source='points'")
    z = np.asarray(z_values, dtype=float).ravel()
    if not (x.size == y.size == z.size):
        raise ValueError(
            f"x_axis/y_axis/z_values must have the same length, got {x.size}/{y.size}/{z.size}"
        )
    if kind == "bars3d":
        ok = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
        return x[ok], y[ok], z[ok]
    return x, y, z


def _scatter(
    ax: Any, plan: ScatterPlan, ext: Mapping[str, Any], lim: tuple[float, float] | None,
    cmap: str, elev: float, azim: float, note: str, st: Any,
) -> tuple[Any, str]:
    """Draw a scatter with extras: the colour range is the picked column's own
    extent, else the map's colour limits, else the z extent. Returns (mappable, note)."""
    if plan.color is not None:
        lo, hi = padded_span(float(plan.color.min()), float(plan.color.max()))
    else:
        lo, hi = lim if lim else padded_span(float(plan.z.min()), float(plan.z.max()))
    walls = [bool(ext.get(k)) for k in ("wall_xy", "wall_xz", "wall_yz")]
    m = draw_scatter(
        ax, plan, matplotlib.colormaps[cmap], Normalize(lo, hi), walls, elev, azim,
        str(ext.get("sc_group_label") or ""), st.font_size * 0.8,
    )
    return m, f"{note} {plan.note}".strip()


def render_ext_figure(
    kind: str, x_axis: ArrayLike, y_axis: ArrayLike, z_grid: ArrayLike | None, *,
    ext: Mapping[str, Any], contour_source: str, z_values: ArrayLike | None,
    log_decade_ticks: Callable[[float, float], list[tuple[int, str]]],
    title: str, x_label: str, y_label: str, z_label: str, fmt: str, style: str,
    cmap: str, colorbar: bool, width_in: float | None, height_in: float | None,
    dpi: int | None, view_elev: float, view_azim: float, view_zoom: float,
    z_limits: Sequence[float] | None, colorbar_log10: bool, note: str,
) -> bytes:
    """Render ``bars3d`` or ``vectors3d`` to image bytes (see the module header)."""
    check_zoom(view_zoom)
    check_angles(view_elev, view_azim)
    lim: tuple[float, float] | None = None
    if z_limits is not None:
        if len(z_limits) != 2 or not all(math.isfinite(float(v)) for v in z_limits):
            raise ValueError("z_limits must be two finite numbers [lo, hi] with lo < hi")
        lim = (float(z_limits[0]), float(z_limits[1]))
        if not lim[0] < lim[1]:
            raise ValueError("z_limits must be two finite numbers [lo, hi] with lo < hi")
    x, y, z = _flat(kind, contour_source, x_axis, y_axis, z_grid, z_values)
    check_extent(x, y, z)
    st = figure_style(style)
    with render_scope(figure_rc(st)):
        mappable: Any = None
        fig = new_figure(figsize=(width_in or st.fig_width_in, height_in or st.fig_height_in))
        ax = axes_3d(fig)
        if kind == "bars3d":
            x, y, z, dx, dy, base = prepare_bars(x, y, z, ext)
            color = ext.get("bar_color")
            lo, hi = lim if lim else padded_span(float(z.min()), float(z.max()))
            mappable = ScalarMappable(norm=Normalize(lo, hi), cmap=matplotlib.colormaps[cmap])
            draw_bars(ax, x, y, z, dx, dy, base, mappable.cmap, mappable.norm, color)
            if color is not None:
                mappable = None  # one fixed colour: nothing for a colour bar to say
        elif kind == "scatter3d":
            plan = plan_scatter(x, y, z, ext, source=contour_source)
            check_extent(plan.x, plan.y, plan.z)
            mappable, note = _scatter(ax, plan, ext, lim, cmap, view_elev, view_azim, note, st)
        else:
            tails, tips = prepare_vectors(x, y, z, ext)
            draw_vectors(ax, tails, tips, float(ext.get("vec_head", 0.2)), ext.get("vec_color"))
        set_view(ax, view_elev, view_azim, view_zoom)
        cax = colorbar_axes(fig) if colorbar and mappable is not None else None
        title = safe_mathtext_label(title)
        z_label = safe_mathtext_label(z_label)
        axis_labels = ((x_label, ax.set_xlabel), (y_label, ax.set_ylabel), (z_label, ax.set_zlabel))
        for label, setter in axis_labels:
            if label:
                setter(safe_mathtext_label(label))
        if colorbar_log10 and kind in ("bars3d", "scatter3d"):
            set_log_zticks(ax, log_decade_ticks)
        by_column = kind == "scatter3d" and ext.get("sc_color") is not None
        if cax is not None:
            label = z_label
            if by_column:
                label = safe_mathtext_label(str(ext.get("sc_color_label") or ""))
            cb = fig.colorbar(mappable, cax=cax, label=label or None)
            if colorbar_log10 and not by_column:
                ticks = log_decade_ticks(*mappable.get_clim())
                cb.set_ticks([k for k, _ in ticks], labels=[t for _, t in ticks])
        note_3d = safe_mathtext_label(note) if note else ""
        finish_3d(fig, ax, cax, title, st.title_font_size, note_3d, st.font_size * 0.7)
        return savefig_bytes(fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi))
