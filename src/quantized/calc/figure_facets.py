"""Publication rendering for faceted (small-multiples) plots.

ORIGIN_GAP_PLAN #21 (export half, faceting) + GUI_INTERACTION #12 slice 4b
(stat-stage faceted export). Pure layer: N independently pre-split panels
sharing scales/labels -> image bytes out. ``render_facets_figure`` mirrors
the interactive xy facet splitter (frontend ``lib/facet.facetPayloads``):
each panel is already the (label, x, series) data for one categorical level.
``render_stat_facets_figure``/``render_categorical_facets_figure`` mirror
the interactive StatStage's OWN facet grid (``useStatStage``'s
``drawFacets``) for box/violin and bar mode respectively — reusing
``figure_statplots``/``figure_categorical``'s per-panel draw functions so a
single facet renders byte-identically to that module's flat single-panel
export. All three share this module's grid-layout helpers
(``_grid_shape``/``_new_grid_figure``): the SAME ``ceil(sqrt(n))``-column,
auto-wrapping-row layout the screen's CSS grid uses
(``Math.ceil(Math.sqrt(n)))`` columns — see ``StatStage.tsx``/
``GraphPreview.tsx``), so an exported faceted figure tiles identically to
what's on screen.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from quantized.calc.figure import _plot_kwargs  # noqa: E402
from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = [
    "render_facets_figure",
    "render_stat_facets_figure",
    "render_categorical_facets_figure",
]

_FORMATS = ("pdf", "svg", "png", "tiff")


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
    fig, axes_grid = plt.subplots(rows, cols, figsize=figsize, squeeze=False)
    flat = [ax for row in axes_grid for ax in row]
    for j in range(n, len(flat)):
        flat[j].set_visible(False)
    return fig, flat[:n]


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
    # Rich-text labels (GOTO #5): de-math INVALID $...$ so savefig never raises.
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)

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
                        label=safe_mathtext_label(str(s.get("label", f"s{si}"))), **kw,
                    )
                ax.set_title(
                    safe_mathtext_label(str(panel.get("label", ""))), fontsize=st.font_size
                )
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


def render_stat_facets_figure(
    panels: list[dict[str, Any]],
    *,
    default_kind: str,
    dist: str = "norm",
    bins: str | int = "fd",
    fit: str | None = None,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
) -> bytes:
    """Faceted box/violin export (GUI_INTERACTION #12 slice 4b, StatStage's
    "facet by" grid). Each ``panels[i]`` is ``{"label": str, "kind": "box" |
    "violin" (optional), "data": [[...], ...], "labels": [...] | None}``.

    ``kind`` is per-facet MODE FIDELITY: the interactive StatStage computes
    each facet slice independently (``useStatStage.computeFacetGroupDraws``)
    and a violin slice whose own ``/api/statplots/violin`` call failed
    degrades to a box plot for JUST that slice (never fabricating a KDE) —
    omitting ``kind`` falls back to ``default_kind`` (today's degrade-free
    case, every panel the same requested kind), while an explicit per-panel
    ``kind`` reproduces a mixed grid exactly as the screen showed it.

    Reuses ``figure_statplots._draw_statplot`` for each panel so a single
    facet renders byte-identically to that module's flat single-panel path.
    """
    from quantized.calc.figure_statplots import _GROUPED, _draw_statplot

    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if not panels:
        raise ValueError("panels must be non-empty")
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)

    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    n = len(panels)
    rows, cols = _grid_shape(n)
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
        "xtick.top": st.box_on,
        "ytick.right": st.box_on,
    }

    prepared: list[tuple[str, str, Any, list[str] | None]] = []
    for p in panels:
        label = safe_mathtext_label(str(p.get("label", "")))
        kind = p.get("kind") or default_kind
        if kind not in _GROUPED:
            raise ValueError(f"facet kind must be one of {_GROUPED}")
        data = p.get("data")
        if not isinstance(data, list) or not data:
            raise ValueError(f"facet {label!r} needs a non-empty list of groups")
        flabels = p.get("labels")
        flabels = [safe_mathtext_label(str(g)) for g in flabels] if flabels else flabels
        prepared.append((label, kind, data, flabels))

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, axes = _new_grid_figure(n, figsize)
        try:
            for ax, (label, kind, data, flabels) in zip(axes, prepared, strict=True):
                _draw_statplot(ax, kind, data, flabels, dist, bins, fit, st)
                ax.set_title(label, fontsize=st.font_size)
                if not st.box_on:
                    ax.spines["top"].set_visible(False)
                    ax.spines["right"].set_visible(False)
            if title:
                fig.suptitle(title)
            if x_label:
                fig.supxlabel(x_label)
            if y_label:
                fig.supylabel(y_label)
            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)


def render_categorical_facets_figure(
    panels: list[dict[str, Any]],
    *,
    stacked: bool = False,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int = 200,
) -> bytes:
    """Faceted grouped/stacked bar export (GUI_INTERACTION #12 slice 4b,
    StatStage's bar-mode "facet by" grid). Each ``panels[i]`` is
    ``{"label": str, "groups": [...], "series": [...], "values": [[...]],
    "errors": [[...]] | None}`` — a SELF-CONTAINED category x series matrix
    (a facet's category set can differ slice to slice when a grouped-by
    column level is absent from that slice, so panels never share one
    ``groups`` list). Reuses ``figure_categorical._draw_categorical_bars``
    so a single panel matches that module's flat single-panel export.

    ``series`` is assumed consistent across panels (the same plotted
    channels every slice draws), so ONE legend on the first panel documents
    the whole figure rather than repeating it in every small cell.
    """
    from quantized.calc.figure_categorical import (
        _draw_categorical_bars,
        _to_error_matrix,
        _to_matrix,
    )

    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if not panels:
        raise ValueError("panels must be non-empty")
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)

    st = figure_style(style)
    n = len(panels)
    rows, cols = _grid_shape(n)
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

    prepared = []
    for p in panels:
        label = safe_mathtext_label(str(p.get("label", "")))
        groups = [safe_mathtext_label(str(g)) for g in p.get("groups", [])]
        series = [safe_mathtext_label(str(s)) for s in p.get("series", [])]
        if not groups:
            raise ValueError(f"facet {label!r} needs a non-empty groups list")
        if not series:
            raise ValueError(f"facet {label!r} needs a non-empty series list")
        vals = _to_matrix(p.get("values", []), len(groups), len(series), f"facet {label!r} values")
        errs = _to_error_matrix(p.get("errors"), len(groups), len(series))
        prepared.append((label, groups, series, vals, errs))

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, axes = _new_grid_figure(n, figsize)
        try:
            for ax, (label, groups, series, vals, errs) in zip(axes, prepared, strict=True):
                _draw_categorical_bars(ax, groups, series, vals, errs, stacked)
                ax.set_title(label, fontsize=st.font_size)
                if not st.box_on:
                    ax.spines["top"].set_visible(False)
                    ax.spines["right"].set_visible(False)
                if st.grid_alpha > 0:
                    ax.grid(True, alpha=st.grid_alpha, axis="y")
            first_series = prepared[0][2]
            if len(first_series) > 1:
                axes[0].legend(
                    frameon=st.legend_box, fontsize=max(6.0, st.legend_font_size - 2),
                    loc=st.legend_location,
                )
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
