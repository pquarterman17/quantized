"""Faceted export of the item 20 variants (half / split violin, paired, lollipop, a histogram
stacked by a group): the Stat Stage's "facet by" grid for these plots.

One panel per facet level on the same ``ceil(sqrt(n))`` grid the box family uses
(``figure_facets_grid``). Each panel is drawn by the very function the flat figure uses
(``figure_dist3.draw_dist3_panel``, ``figure_hist_multi.draw_histogram_multi``) from that panel's
own groups and options, so a panel is the plot drawn alone from those rows: marks, colours and
legend included. The panels do not share axes (the screen's panels do not either); the titles
are the facet labels and the axis titles are shared.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from quantized.calc.figure_dist2 import draw_ridgeline
from quantized.calc.figure_dist3 import DIST3_KINDS, draw_dist3_panel
from quantized.calc.figure_facets_grid import _grid_setup, _new_grid_figure
from quantized.calc.figure_hist_multi import draw_histogram_multi, is_multi
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import render_scope, savefig_bytes

__all__ = ["FACET_DIST3_KINDS", "draw_dist3_panels", "render_dist3_facets_figure"]

FACET_DIST3_KINDS = (*DIST3_KINDS, "histogram", "ridgeline")


def draw_dist3_panels(
    axes: Sequence[Any],
    panels: Sequence[dict[str, Any]],
    kind: str,
    bins: str | int,
    line_width: float,
) -> None:
    """Draw ``panels[i]`` (``data``, ``labels``, ``options``, ``colors``) on ``axes[i]``; each
    panel's title is its ``label``. Raises ``ValueError`` for a panel that cannot draw."""
    if kind not in FACET_DIST3_KINDS:
        raise ValueError(f"a faceted plot of kind {kind!r} is not drawn here")
    for ax, p in zip(axes, panels, strict=True):
        label = str(p.get("label", ""))
        data = p.get("data")
        if not isinstance(data, list) or not data:
            raise ValueError(f"facet {label!r} needs a non-empty list of groups")
        opts = p.get("options") or {}
        if kind == "ridgeline":
            draw_ridgeline(
                ax, data, p.get("labels"), overlap=float(opts.get("overlap", 1.0)),
                bw=opts.get("bw", "scott"), colors=p.get("colors"), line_width=line_width,
                each=bool(opts.get("each", False)),
            )
        elif kind == "histogram":
            if not is_multi(data):
                raise ValueError(f"facet {label!r}: a faceted histogram needs one list per group")
            draw_histogram_multi(ax, data, p.get("labels"), bins, p.get("colors"), opts=opts)
        else:
            draw_dist3_panel(ax, kind, data, p.get("labels"), opts, p.get("colors"), line_width)
        ax.set_title(safe_mathtext_label(label))


def render_dist3_facets_figure(
    panels: list[dict[str, Any]],
    *,
    kind: str,
    bins: str | int = "fd",
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    svg_text_as_paths: bool = False,
) -> bytes:
    """Render the faceted variant to image bytes."""
    if not panels:
        raise ValueError("panels must be non-empty")
    n = len(panels)
    st, figsize, rc = _grid_setup(style, n, width_in, height_in, box_ticks=True)
    with render_scope(rc):
        fig, axes = _new_grid_figure(n, figsize)
        draw_dist3_panels(axes, panels, kind, bins, st.line_width)
        if not st.box_on:
            for ax in axes:
                ax.spines["top"].set_visible(False)
                ax.spines["right"].set_visible(False)
        if title:
            fig.suptitle(safe_mathtext_label(title))
        if x_label:
            fig.supxlabel(safe_mathtext_label(x_label))
        if y_label:
            fig.supylabel(safe_mathtext_label(y_label))
        fig.tight_layout()
        return savefig_bytes(
            fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi),
            svg_text_as_paths=svg_text_as_paths,
        )
