"""Publication rendering for pie and (multi-ring) doughnut charts.

Pure layer: wedge values (one ring per row of ``rings``), the category
labels and the hole size -> image bytes. The pie workshop previews exactly
this render (PNG at screen dpi) and exports the same request, so the screen
and the file never disagree.

Geometry (Origin's, ``io/origin_project/opju_pie.py``): the first wedge
starts at 12 o'clock and the wedges run clockwise; with ``hole`` > 0 the
rings share the annulus from ``hole`` to the outer radius equally, the first
ring innermost. Each ring is split by its own values' shares. A one-ring
chart prints each wedge's share in percent; the labels go to the legend.
Colours: ``colors`` (the theme's series colours, sent by the client) per
category, cycling; else matplotlib's cycle.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style

__all__ = ["MAX_PIE_WEDGES", "pie_rings", "render_pie_figure"]

_FORMATS = ("pdf", "svg", "eps", "png", "tiff")
_FIGURE_SIZE_IN = (7, 5.5)
_MIN_LABEL_SHARE = 0.03  # a wedge narrower than this prints no percent label
# Render cost is linear in wedges (~5 ms each at screen dpi; 5,000 took 23 s),
# and the workshop previews on every pick change while holding the render
# lock: a 10k-row value column must be refused, not rendered for a minute.
MAX_PIE_WEDGES = 2000


def pie_rings(hole: float, count: int) -> list[tuple[float, float]]:
    """``(inner, outer)`` radius of each ring, first ring innermost, the
    outer radius 1: equal rings from ``hole`` to 1 (one full disc for a pie)."""
    if count < 1:
        raise ValueError("a pie needs at least one ring")
    if not 0.0 <= hole < 1.0:
        raise ValueError("hole must be in [0, 1)")
    width = (1.0 - hole) / count
    return [(hole + k * width, hole + (k + 1) * width) for k in range(count)]


def _percent(p: float) -> str:
    """A wedge's percent label; none on a sliver."""
    return f"{p:.1f}%" if p / 100 >= _MIN_LABEL_SHARE else ""


def render_pie_figure(
    rings: ArrayLike,
    labels: list[str],
    *,
    hole: float = 0.0,
    colors: list[str] | None = None,
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    title: str = "",
) -> bytes:
    """Render a pie (one ring, ``hole`` 0), a doughnut (``hole`` > 0) or a
    multi-ring doughnut (several rows in ``rings``, ``hole`` > 0).

    ``rings`` is an (n_rings, n_categories) array of finite, non-negative
    values; every ring must have a positive total. ``labels`` names the
    categories (legend). Raises ``ValueError`` on malformed input."""
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    vals = np.asarray(rings, dtype=float)
    if vals.ndim != 2 or vals.shape[1] == 0:
        raise ValueError("rings must be a 2-D (rings x categories) array")
    if vals.size > MAX_PIE_WEDGES:
        raise ValueError(
            f"a pie draws at most {MAX_PIE_WEDGES} wedges (rings x categories); got {vals.size}"
        )
    if len(labels) != vals.shape[1]:
        raise ValueError("one label per category is required")
    if not np.all(np.isfinite(vals)) or np.any(vals < 0) or np.any(vals.sum(axis=1) <= 0):
        raise ValueError("every value must be finite and >= 0, every ring's total > 0")
    if vals.shape[0] > 1 and hole <= 0:
        raise ValueError("several rings need a hole (a doughnut)")
    radii = pie_rings(hole, vals.shape[0])
    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    rc: dict[str, Any] = {
        **font_family_rc(st),
        "font.size": st.font_size,
        "axes.titlesize": st.title_font_size,
    }
    palette = list(colors) if colors else None
    cats = vals.shape[1]
    wedge_colors = [palette[i % len(palette)] for i in range(cats)] if palette else None
    with render_scope(rc):
        title = safe_mathtext_label(title)
        names = [safe_mathtext_label(str(s)) for s in labels]
        fig = new_figure(figsize=_FIGURE_SIZE_IN)
        ax = fig.subplots()
        handles: list[Any] = []
        for row, (inner, outer) in zip(vals, radii, strict=True):
            one = vals.shape[0] == 1
            wedges, *_ = ax.pie(
                row,
                radius=outer,
                startangle=90,
                counterclock=False,
                colors=wedge_colors,
                wedgeprops={"width": outer - inner, "edgecolor": "white", "linewidth": 0.8},
                autopct=_percent if one else None,
                pctdistance=(inner + outer) / 2 / outer if inner > 0 else 0.6,
            )
            if not handles:
                handles = list(wedges)
        ax.set_aspect("equal")
        ax.legend(handles, names, loc="center left", bbox_to_anchor=(1.0, 0.5), frameon=False)
        if title:
            ax.set_title(title, fontsize=st.title_font_size)
        fig.tight_layout()
        return savefig_bytes(fig, fmt, dpi=resolved_dpi)
