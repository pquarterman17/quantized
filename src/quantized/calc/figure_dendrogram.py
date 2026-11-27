"""Publication dendrogram (ORIGIN_FEATURE_GAP_PLAN item 11, J13).

Draws the geometry ``calc.stats_cluster_dendrogram`` produced, unchanged: one
U-shaped link per merge, coloured by cluster (grey above the cut), the cut as
a dashed horizontal line, and the leaf labels along the bottom when there are
few enough to read. The on-screen view (``cluster/dendrogramModel.ts``) builds
the same draw list from the same geometry; ``tests/fixtures/wire/dendrogram.json``
pins both, including the colour palette below.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from matplotlib.axes import Axes

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style

__all__ = ["ABOVE_CUT", "LEAF_LABEL_MAX", "PALETTE", "draw_dendrogram", "render_dendrogram_figure"]

#: Cluster k (1-based) takes ``PALETTE[(k - 1) % len]``; links above the cut use ``ABOVE_CUT``.
PALETTE: tuple[str, ...] = (
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#17becf",
    "#bcbd22",
    "#7f7f7f",
)
ABOVE_CUT = "#888888"
#: Leaf labels are drawn only up to this many leaves (more would overprint).
LEAF_LABEL_MAX = 60
_FORMATS = ("pdf", "svg", "eps", "png", "tiff")


def link_color(cluster: int) -> str:
    return ABOVE_CUT if cluster <= 0 else PALETTE[(cluster - 1) % len(PALETTE)]


def draw_dendrogram(
    ax: Axes,
    geom: dict[str, Any],
    leaf_names: Sequence[str] | None = None,
    *,
    y_label: str = "distance",
) -> None:
    """Draw ``geom`` on ``ax`` (``ax.lines`` then holds one line per link, then the cut line)."""
    for seg in geom["segments"]:
        ax.plot(
            seg["x"],
            seg["y"],
            color=link_color(int(seg["cluster"])),
            linewidth=1.2,
            solid_capstyle="butt",
        )
    n_leaves = int(geom["n_leaves"])
    ax.scatter(
        range(n_leaves),
        [0.0] * n_leaves,
        c=[link_color(int(c)) for c in geom["leaf_cluster"]],
        s=16,
        zorder=3,
        clip_on=False,
    )  # leaf markers, coloured by cluster (link colour stops at the cut)
    ax.axhline(geom["cut"], color="#444444", linestyle="--", linewidth=0.9)
    n = int(geom["n_leaves"])
    ax.set_xlim(-0.6, n - 0.4)
    top = max(float(geom["max_height"]), float(geom["cut"])) * 1.05 or 1.0
    ax.set_ylim(0.0, top)
    ax.set_ylabel(y_label)
    if leaf_names is not None and n <= LEAF_LABEL_MAX:
        ax.set_xticks(range(n))
        ax.set_xticklabels(
            [safe_mathtext_label(str(leaf_names[i])) for i in geom["leaf_order"]], rotation=90
        )
    else:
        ax.set_xticks([])


def render_dendrogram_figure(
    geom: dict[str, Any],
    leaf_names: Sequence[str] | None = None,
    *,
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
) -> bytes:
    """Render a dendrogram geometry to image bytes."""
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if not geom.get("segments"):
        raise ValueError("the dendrogram has no links to draw")
    if leaf_names is not None and len(leaf_names) != int(geom["n_leaves"]):
        raise ValueError("leaf_names must have one entry per leaf")
    st = figure_style(style)
    rc: dict[str, Any] = {
        **font_family_rc(st),
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
    }
    with render_scope(rc):
        fig = new_figure(figsize=(width_in or st.fig_width_in, height_in or st.fig_height_in))
        ax = fig.subplots()
        draw_dendrogram(ax, geom, leaf_names)
        if title:
            ax.set_title(safe_mathtext_label(title))
        fig.tight_layout()
        return savefig_bytes(fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi))
