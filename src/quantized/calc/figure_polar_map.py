"""Polar map publication figure: heatmap and/or contour of I(chi, phi).

GAP_AUDIT_9 G2. Export twin of ``frontend/src/components/Stage/
PolarMapStage.tsx``. The maths (projection, gridding) lives in
``calc.polar_map``; this module only draws it on matplotlib polar axes.

Radial axis = projected tilt chi (equal-area by default -- OWNER DECISION
2026-11-24, GAP_AUDIT_9 D4; stereographic offered), labelled in chi degrees at
15-degree rings; angular axis = azimuth phi. A colour bar carries the
intensity scale (linear or log). Pure layer: arrays in, bytes out.
"""

from __future__ import annotations

from typing import Any, cast

import matplotlib.colors as mcolors
import numpy as np
from matplotlib.projections.polar import PolarAxes
from numpy.typing import ArrayLike

from quantized.calc.figure import style_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_polar import _ZERO_SCREEN_DEG, DIRECTIONS
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style
from quantized.calc.polar_map import DEFAULT_PROJECTION, grid_polar_map, project_radius

__all__ = ["CMAPS", "MAP_MODES", "Z_SCALES", "render_polar_map_figure"]

_FORMATS = ("pdf", "svg", "eps", "png", "tiff")
MAP_MODES = ("heatmap", "contour", "both")
Z_SCALES = ("linear", "log")
CMAPS = {"viridis": "viridis", "magma": "magma", "gray": "gray", "rdbu": "RdBu_r"}
RING_STEP_DEG = 15


def render_polar_map_figure(
    chi: ArrayLike,
    phi: ArrayLike,
    intensity: ArrayLike,
    *,
    projection: str = DEFAULT_PROJECTION,
    mode: str = "heatmap",
    cmap: str = "viridis",
    z_scale: str = "linear",
    z_lim: tuple[float, float] | None = None,
    levels: int = 10,
    n_r: int = 100,
    n_phi: int = 360,
    direction: str = "ccw",
    zero: str = "E",
    grid: bool = True,
    title: str = "",
    z_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    transparent: bool = False,
    svg_text_as_paths: bool = False,
) -> bytes:
    """Render the polar map and return the image bytes. ``ValueError`` on bad
    options or unusable data (see ``calc.polar_map.grid_polar_map``; a log
    scale refuses non-positive intensity)."""
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if mode not in MAP_MODES:
        raise ValueError(f"mode must be one of {MAP_MODES}")
    if cmap not in CMAPS:
        raise ValueError(f"cmap must be one of {tuple(CMAPS)}")
    if z_scale not in Z_SCALES:
        raise ValueError(f"z_scale must be one of {Z_SCALES}")
    if direction not in DIRECTIONS:
        raise ValueError(f"direction must be one of {DIRECTIONS}")
    if zero not in _ZERO_SCREEN_DEG:
        raise ValueError(f"zero must be one of {tuple(_ZERO_SCREEN_DEG)}")
    if not 2 <= levels <= 200:
        raise ValueError("levels must be between 2 and 200")
    intensity_arr = np.asarray(intensity, dtype=float)
    if z_scale == "log" and np.any(intensity_arr[np.isfinite(intensity_arr)] <= 0):
        raise ValueError("a log intensity scale needs every intensity > 0")
    pg = grid_polar_map(chi, phi, intensity_arr, projection=projection, n_r=n_r, n_phi=n_phi)
    finite = pg.z[np.isfinite(pg.z)]
    if finite.size == 0:
        raise ValueError("the gridded map is empty (no cell lies inside the data)")
    lo, hi = z_lim if z_lim is not None else (float(finite.min()), float(finite.max()))
    if not (np.isfinite(lo) and np.isfinite(hi) and hi > lo):
        raise ValueError("z range must be two finite numbers, minimum below maximum")
    if z_scale == "log" and lo <= 0:
        raise ValueError("a log intensity scale needs a positive lower limit")
    norm: mcolors.Normalize = (
        mcolors.LogNorm(vmin=lo, vmax=hi) if z_scale == "log" else mcolors.Normalize(lo, hi)
    )
    st = figure_style(style)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    zm = np.ma.masked_invalid(pg.z)
    with render_scope(style_rc(st, {})):
        fig = new_figure(figsize=figsize)
        ax = cast(PolarAxes, fig.subplots(subplot_kw={"projection": "polar"}))
        ax.set_theta_zero_location(cast(Any, zero))
        ax.set_theta_direction(1 if direction == "ccw" else -1)
        mappable: Any = None
        if mode in ("heatmap", "both"):
            th_edge = np.deg2rad(np.linspace(0.0, 360.0, n_phi + 1))
            r_edge = np.linspace(0.0, 1.0, n_r + 1)
            mappable = ax.pcolormesh(th_edge, r_edge, zm, cmap=CMAPS[cmap], norm=norm,
                                     shading="flat")
        if mode in ("contour", "both"):
            th_c = np.deg2rad(np.append(pg.phi_deg, pg.phi_deg[0] + 360.0))
            z_wrap = np.ma.masked_invalid(np.concatenate([pg.z, pg.z[:, :1]], axis=1))
            lv = np.geomspace(lo, hi, levels) if z_scale == "log" else np.linspace(lo, hi, levels)
            both = mode == "both"  # contour lines in black over the heatmap
            cs = ax.contour(
                th_c, pg.r, z_wrap, levels=lv, norm=norm,
                cmap=None if both else CMAPS[cmap], colors="k" if both else None,
                linewidths=0.6 if both else None,
            )
            if mappable is None:
                mappable = cs
        ax.set_ylim(0.0, 1.0)
        rings = list(range(RING_STEP_DEG, 91, RING_STEP_DEG))
        ax.set_rgrids(project_radius(rings, projection), [f"{c}\N{DEGREE SIGN}" for c in rings])
        ax.set_rlabel_position(22.5)
        spokes = np.arange(0.0, 360.0, 45.0)
        ax.set_thetagrids(spokes, [f"{d:g}\N{DEGREE SIGN}" for d in spokes])
        ax.grid(grid)
        if title:
            ax.set_title(safe_mathtext_label(title))
        proj_name = (
            "equal-area (Schmidt)" if projection == "equal_area" else "stereographic (Wulff)"
        )
        ax.set_xlabel(safe_mathtext_label(f"azimuth \N{GREEK SMALL LETTER PHI}; radius = tilt "
                                          f"\N{GREEK SMALL LETTER CHI}, {proj_name}"))
        cb = fig.colorbar(mappable, ax=ax, pad=0.1, shrink=0.8)
        if z_label:
            cb.set_label(safe_mathtext_label(z_label))
        fig.tight_layout()
        return savefig_bytes(
            fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi),
            transparent=transparent, svg_text_as_paths=svg_text_as_paths,
        )
