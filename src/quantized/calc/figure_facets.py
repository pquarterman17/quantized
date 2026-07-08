"""Publication rendering for faceted (small-multiples) plots.

ORIGIN_GAP_PLAN #21 (export half, faceting). Pure layer: N independently
pre-split panels sharing scales/labels -> image bytes out. Mirrors the
interactive facet splitter (frontend ``lib/facet.facetPayloads``): each panel
is already the (label, x, series) data for one categorical level — this
module only lays them out and draws them, matching ``calc.figure``'s style
presets (``figure_styles.figure_style``) and per-series line kwargs
(``calc.figure._plot_kwargs``).
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from quantized.calc.figure import _plot_kwargs  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = ["render_facets_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")


def render_facets_figure(
    panels: list[dict[str, Any]],
    *,
    x_log: bool = False,
    y_log: bool = False,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int = 200,
) -> bytes:
    """Render one small-multiples panel per facet level.

    Each ``panels[i]`` is ``{"label": str, "x": [...], "series": [{"label":
    str, "y": [...]}]}`` — a pre-split slice of data for one categorical
    level (see the frontend's ``lib/facet.facetPayloads``). Panels tile into
    as-square-as-possible rows/columns and share x/y scales (``sharex`` /
    ``sharey``) so magnitudes stay comparable across levels; each panel
    carries its own facet-level title, and unused trailing grid cells (when
    the panel count isn't a perfect rows*cols rectangle) are hidden.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if not panels:
        raise ValueError("panels must be non-empty")

    st = figure_style(style)
    n = len(panels)
    cols = int(np.ceil(np.sqrt(n)))
    rows = int(np.ceil(n / cols))
    figsize = (
        width_in or st.fig_width_in * cols * 0.8,
        height_in or st.fig_height_in * rows * 0.8,
    )
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.font_size,
    }

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, axes_grid = plt.subplots(
            rows, cols, figsize=figsize, sharex=True, sharey=True, squeeze=False,
        )
        try:
            flat = [ax for row in axes_grid for ax in row]
            for i, panel in enumerate(panels):
                ax = flat[i]
                x = np.asarray(panel.get("x", []), dtype=float)
                series = panel.get("series", [])
                for si, s in enumerate(series):
                    kw = _plot_kwargs(st.line_width, st.marker_size, None)
                    ax.plot(
                        x, np.asarray(s.get("y", []), dtype=float),
                        label=str(s.get("label", f"s{si}")), **kw,
                    )
                ax.set_title(str(panel.get("label", "")), fontsize=st.font_size)
                if x_log:
                    ax.set_xscale("log")
                if y_log:
                    ax.set_yscale("log")
                if not st.box_on:
                    ax.spines["top"].set_visible(False)
                    ax.spines["right"].set_visible(False)
                if st.grid_alpha > 0:
                    ax.grid(True, alpha=st.grid_alpha)
                if len(series) > 1:
                    ax.legend(fontsize=max(6.0, st.legend_font_size - 2), frameon=st.legend_box)
            for j in range(n, len(flat)):
                flat[j].set_visible(False)

            if title:
                fig.suptitle(title)
            if x_label:
                fig.supxlabel(x_label)
            if y_label:
                fig.supylabel(y_label)
            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)
