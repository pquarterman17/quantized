"""Hexbin and 2-D kernel-density publication figures (GAP_AUDIT_9 G15).

Pure layer. ``method="hexbin"`` draws matplotlib's own ``hexbin`` (counts per
hexagon, optional log colour scale); ``method="kde"`` draws filled contours of
``calc.plots2_stats.kde2d_grid`` (``scipy.stats.gaussian_kde``, Scott's rule by
default -- provisional, owner to confirm) with optional scatter points.
Tests check the hexagon counts against an independent nearest-centre
assignment (``tests/test_plots2_density.py``).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.figure import style_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style
from quantized.calc.plots2_stats import MIN_KDE_POINTS, kde2d_grid

__all__ = ["CMAPS", "METHODS", "render_density2d_figure"]

_FORMATS = ("pdf", "svg", "eps", "png", "tiff")
METHODS = ("hexbin", "kde")
CMAPS = {"viridis": "viridis", "magma": "magma", "gray": "gray", "rdbu": "RdBu_r"}


def render_density2d_figure(
    x: ArrayLike,
    y: ArrayLike,
    *,
    method: str = "hexbin",
    gridsize: int = 30,
    log_counts: bool = False,
    bandwidth: str | float = "scott",
    levels: int = 10,
    show_points: bool = False,
    cmap: str = "viridis",
    x_label: str = "",
    y_label: str = "",
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    transparent: bool = False,
    svg_text_as_paths: bool = False,
) -> bytes:
    """Render the density figure. ``ValueError`` on bad options / data."""
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if method not in METHODS:
        raise ValueError(f"method must be one of {METHODS}")
    if cmap not in CMAPS:
        raise ValueError(f"cmap must be one of {tuple(CMAPS)}")
    if not 5 <= gridsize <= 200:
        raise ValueError("gridsize must be between 5 and 200")
    if not 2 <= levels <= 100:
        raise ValueError("levels must be between 2 and 100")
    xv = np.asarray(x, dtype=float)
    yv = np.asarray(y, dtype=float)
    if xv.shape != yv.shape or xv.ndim != 1:
        raise ValueError("x and y must be equal-length columns")
    keep = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[keep], yv[keep]
    if xv.size < MIN_KDE_POINTS:
        raise ValueError(f"a 2-D density needs at least {MIN_KDE_POINTS} points; got {xv.size}")
    grid = kde2d_grid(xv, yv, bandwidth=bandwidth) if method == "kde" else None
    st = figure_style(style)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    with render_scope(style_rc(st, {})):
        fig = new_figure(figsize=figsize)
        ax = fig.subplots()
        mappable: Any
        if grid is None:
            mappable = ax.hexbin(
                xv, yv, gridsize=gridsize, cmap=CMAPS[cmap], mincnt=1,
                bins="log" if log_counts else None, linewidths=0.2, edgecolors="face",
            )
            cb_label = "count (log scale)" if log_counts else "count"
        else:
            gx, gy, z = grid
            mappable = ax.contourf(gx, gy, z, levels=levels, cmap=CMAPS[cmap])
            ax.contour(gx, gy, z, levels=levels, colors="k", linewidths=0.4)
            bw_name = bandwidth if isinstance(bandwidth, str) else "factor"
            cb_label = f"density ({bw_name} bandwidth)"
        if show_points:
            ax.scatter(xv, yv, s=3, c="k", alpha=0.35, linewidths=0, zorder=3)
        if grid is None:
            ax.set_xlim(xv.min(), xv.max())
            ax.set_ylim(yv.min(), yv.max())
        ax.set_xlabel(safe_mathtext_label(x_label))
        ax.set_ylabel(safe_mathtext_label(y_label))
        if title:
            ax.set_title(safe_mathtext_label(title))
        fig.colorbar(mappable, ax=ax, pad=0.02).set_label(cb_label)
        fig.tight_layout()
        return savefig_bytes(
            fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi),
            transparent=transparent, svg_text_as_paths=svg_text_as_paths,
        )
