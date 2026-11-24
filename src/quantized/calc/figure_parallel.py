"""Parallel-coordinates publication figure (GAP_AUDIT_9 G15).

Pure layer: one vertical axis per column, one polyline per row. Every column
is rescaled for the drawing (min-max to 0-1, or z-score); each axis is
labelled with its own raw minimum and maximum so the physical range stays
readable. Rows can be coloured by a column (viridis-style colour bar).
Inselberg A (1985) Visual Computer 1:69-91 introduced the plot.
"""

from __future__ import annotations

from typing import Any

import matplotlib.cm as mcm
import matplotlib.colors as mcolors
import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.figure import style_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style

__all__ = ["CMAPS", "NORMALIZE", "render_parallel_figure", "scale_columns"]

_FORMATS = ("pdf", "svg", "eps", "png", "tiff")
NORMALIZE = ("minmax", "zscore")
CMAPS = {"viridis": "viridis", "magma": "magma", "gray": "gray", "rdbu": "RdBu_r"}
MIN_ROWS = 2
MIN_COLUMNS = 2


def scale_columns(m: np.ndarray, mode: str) -> np.ndarray:
    """Column-wise rescale: ``minmax`` -> [0, 1]; ``zscore`` -> (x-mean)/SD
    (ddof 1). A constant column maps to 0.5 (minmax) / 0 (zscore)."""
    out = np.empty_like(m, dtype=float)
    for j in range(m.shape[1]):
        c = m[:, j]
        if mode == "minmax":
            span = float(np.ptp(c))
            out[:, j] = (c - c.min()) / span if span > 0 else 0.5
        else:
            sd = float(c.std(ddof=1)) if c.size > 1 else 0.0
            out[:, j] = (c - c.mean()) / sd if sd > 0 else 0.0
    return out


def render_parallel_figure(
    columns: ArrayLike,
    names: list[str],
    *,
    color: ArrayLike | None = None,
    color_label: str = "",
    normalize: str = "minmax",
    cmap: str = "viridis",
    alpha: float = 0.6,
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    transparent: bool = False,
    svg_text_as_paths: bool = False,
) -> bytes:
    """``columns`` is (rows, k); non-finite rows must already be removed.
    ``ValueError`` on bad options or too little data."""
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if normalize not in NORMALIZE:
        raise ValueError(f"normalize must be one of {NORMALIZE}")
    if cmap not in CMAPS:
        raise ValueError(f"cmap must be one of {tuple(CMAPS)}")
    if not 0.05 <= alpha <= 1.0:
        raise ValueError("alpha must be between 0.05 and 1")
    m = np.asarray(columns, dtype=float)
    if m.ndim != 2 or m.shape[1] < MIN_COLUMNS or m.shape[0] < MIN_ROWS:
        raise ValueError(
            f"parallel coordinates need at least {MIN_COLUMNS} columns and {MIN_ROWS} rows"
        )
    if len(names) != m.shape[1]:
        raise ValueError("one name per column")
    if not np.all(np.isfinite(m)):
        raise ValueError("columns must be finite")
    cv = None if color is None else np.asarray(color, dtype=float)
    if cv is not None and (cv.shape != (m.shape[0],) or not np.all(np.isfinite(cv))):
        raise ValueError("the colour column must be finite, one value per row")
    scaled = scale_columns(m, normalize)
    st = figure_style(style)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    xs = np.arange(m.shape[1])
    with render_scope(style_rc(st, {})):
        fig = new_figure(figsize=figsize)
        ax = fig.subplots()
        colors: Any
        mappable = None
        if cv is not None:
            lo, hi = float(cv.min()), float(cv.max())
            norm = mcolors.Normalize(lo, hi if hi > lo else lo + 1.0)
            mappable = mcm.ScalarMappable(norm=norm, cmap=CMAPS[cmap])
            colors = mappable.to_rgba(cv)
        else:
            colors = ["C0"] * m.shape[0]
        # Draw in colour order (low first) so the high end sits on top.
        order = np.argsort(cv) if cv is not None else np.arange(m.shape[0])
        for r in order:
            ax.plot(xs, scaled[r], color=colors[r], alpha=alpha, linewidth=1.0)
        for x in xs:
            ax.axvline(float(x), color="k", linewidth=1.0, zorder=0)
        ax.set_xticks(xs)
        ax.set_xticklabels([safe_mathtext_label(n) for n in names])
        for x, j in zip(xs, range(m.shape[1]), strict=True):
            lo_t, hi_t = f"{m[:, j].min():.4g}", f"{m[:, j].max():.4g}"
            if normalize == "minmax":
                box = {"boxstyle": "square,pad=0.15", "fc": "white", "ec": "none"}
                ax.annotate(hi_t, (x, 1.0), xytext=(0, 6), textcoords="offset points",
                            ha="center", va="bottom", fontsize=st.font_size - 2, bbox=box,
                            zorder=5)
                ax.annotate(lo_t, (x, 0.0), xytext=(0, -6), textcoords="offset points",
                            ha="center", va="top", fontsize=st.font_size - 2, bbox=box,
                            zorder=5)
        ax.set_yticks([])
        ax.set_ylabel("scaled (0 to 1, per axis)" if normalize == "minmax"
                      else "z-score (per axis)")
        for side in ("top", "right", "left", "bottom"):
            ax.spines[side].set_visible(False)
        ax.tick_params(axis="x", length=0)
        if normalize == "minmax":
            ax.set_ylim(-0.08, 1.08)
        if title:
            ax.set_title(safe_mathtext_label(title))
        if mappable is not None:
            cb = fig.colorbar(mappable, ax=ax, pad=0.02)
            if color_label:
                cb.set_label(safe_mathtext_label(color_label))
        fig.tight_layout()
        return savefig_bytes(
            fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi),
            transparent=transparent, svg_text_as_paths=svg_text_as_paths,
        )
