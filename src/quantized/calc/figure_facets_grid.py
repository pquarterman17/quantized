"""Subplot-grid helpers shared by the faceted figure renderers.

Split out of ``figure_facets.py`` to keep that module under the 500-line
ceiling; the layout formula is the screen's own (``ceil(sqrt(n))`` columns,
auto-wrapping rows), so every faceted export tiles as on screen.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from quantized.calc.figure_render import new_figure
from quantized.calc.figure_styles import figure_style


def _grid_shape(n: int) -> tuple[int, int]:
    """(rows, cols) for `n` panels — the SAME `ceil(sqrt(n))`-column layout
    `render_facets_figure` below already uses, and the screen's own CSS grid
    formula (`Math.ceil(Math.sqrt(n))` columns, auto-wrapping rows —
    `StatStage.tsx`/`GraphPreview.tsx`), so every faceted export tiles
    identically to what's on screen."""
    cols = int(np.ceil(np.sqrt(n)))
    rows = int(np.ceil(n / cols))
    return rows, cols


def _new_grid_figure(n: int, figsize: tuple[float, float]) -> tuple[Any, list[Any]]:
    """A fresh `_grid_shape(n)` subplot grid; returns the figure and its axes
    flattened + trimmed to exactly `n` (unused trailing cells past `n` are
    hidden, matching `render_facets_figure`'s own convention below)."""
    rows, cols = _grid_shape(n)
    fig = new_figure(figsize=figsize)
    axes_grid = fig.subplots(rows, cols, squeeze=False)
    flat = [ax for row in axes_grid for ax in row]
    for j in range(n, len(flat)):
        flat[j].set_visible(False)
    return fig, flat[:n]


def _grid_setup(
    style: str, n: int, width_in: float | None, height_in: float | None, *, box_ticks: bool,
) -> tuple[Any, tuple[float, float], dict[str, Any]]:
    """The style preset, figure size and rc of an ``n``-panel stat / bar facet
    grid (``box_ticks``: mirror ticks on the top/right spines, the box family's)."""
    st = figure_style(style)
    rows, cols = _grid_shape(n)
    figsize = (width_in or st.fig_width_in * cols * 0.8, height_in or st.fig_height_in * rows * 0.8)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.font_size,
    }
    if box_ticks:
        rc.update({"xtick.top": st.box_on, "ytick.right": st.box_on})
    return st, figsize, rc
