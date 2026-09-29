"""Publication rendering for grouped/stacked bar (categorical) plots.

ORIGIN_GAP_PLAN #20 (export half). Pure layer: a category x series matrix in
-> image bytes out — the SAME matrix shape the interactive stat stage's "bar"
mode computes locally (frontend `lib/barlayout.buildBarMatrix`: mean per
category/series, SEM for the error bar), so the exported figure matches the
on-screen bars. Shares ``render_figure``'s style presets and formats
(``figure_styles.figure_style``), matching ``figure_statplots.py``'s template.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from quantized.calc.figure_category_axis import style_category_axis
from quantized.calc.figure_group_notes import add_caveat, mark_empty_slots
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_stat_marks import overlay_bar_marks
from quantized.calc.figure_styles import figure_style

__all__ = ["render_categorical_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")


def _draw_categorical_bars(
    ax: Any,
    groups: list[str],
    series: list[str],
    vals: Any,
    errs: Any | None,
    stacked: bool,
    counts: Any | None = None,
    axis_style: dict[str, Any] | None = None,
    raw_groups: list[str] | None = None,
    bar_marks: dict[str, Any] | None = None,
) -> Any | None:
    """Draw one grouped/stacked bar panel into `ax` — shared by the flat
    single-panel path below and `figure_facets.render_categorical_facets_figure`
    (GUI_INTERACTION #12 slice 4b), so a faceted panel matches the flat
    export exactly. Caller applies title/axis-labels/spines/legend/grid —
    this function only draws the bars + category ticks + zero baseline.

    P2.6 box 2: a NaN height (a series with no finite value in that
    category) draws no bar -- never a zero-height stand-in -- and a category
    whose every series is NaN keeps its tick with an ``n=0`` marker.
    ``counts`` (``[group][series]`` sample sizes, optional) adds an ``n=K``
    label over each GROUPED bar, where the screen draws its own; stacked
    bars carry none, on screen or here.

    ``axis_style`` (P2.6 box 1): label rotation / wrapping, as
    ``calc.figure_category_axis.style_category_axis`` takes them; returns
    that function's outer-tier axis (always ``None`` for bars, which are
    never nested). ``raw_groups`` (P2.6 review finding 8): ``groups`` before
    the caller's own ``safe_mathtext_label`` escaping, for that function's
    wrap (its own doc); ``groups`` itself still ticks `ax` directly, above,
    exactly as before.

    ``bar_marks`` (P2.6 box 1, GROUPED bars only): raw points / jitter / the
    summary marker, keyword arguments of ``calc.figure_stat_marks.
    overlay_bar_marks`` (``points``, ``jitter_width``, ``summary``, ``raw``,
    ``raw_rows``). Stacked bars draw none of them, as on screen; a facet
    panel is given its own cells' (``figure_facets``, JMP_GAP J5 residual)."""
    n_groups, n_series = len(groups), len(series)
    x = np.arange(n_groups, dtype=float)
    if stacked:
        bottom = np.zeros(n_groups)
        for si in range(n_series):
            yerr = errs[:, si] if errs is not None and si == n_series - 1 else None
            ax.bar(
                x, vals[:, si], 0.68, bottom=bottom, yerr=yerr, capsize=3,
                label=series[si],
            )
            bottom = bottom + np.nan_to_num(vals[:, si])
    else:
        width = 0.8 / n_series
        centers = np.zeros((n_groups, n_series))
        for si in range(n_series):
            offset = (si - (n_series - 1) / 2) * width
            centers[:, si] = x + offset
            yerr = errs[:, si] if errs is not None else None
            ax.bar(
                x + offset, vals[:, si], width * 0.85, yerr=yerr, capsize=3,
                label=series[si],
            )
        if bar_marks:
            overlay_bar_marks(
                ax, centers, width * 0.85 / 2, raw_groups or groups, vals, **bar_marks,
            )
        if counts is not None:
            _label_bar_counts(ax, x, width, vals, errs, counts, n_series)
    ax.set_xticks(x)
    ax.set_xticklabels(groups)
    ax.axhline(0, color="0.3", linewidth=0.8)  # baseline, visible for mixed-sign data
    if not np.all(np.isfinite(vals)):
        # A NaN bar adds nothing to autoscale, so an edge category with no
        # data would fall outside the axes; pin every category slot in view.
        ax.set_xlim(-0.5, n_groups - 0.5)
    mark_empty_slots(ax, list(x), [bool(np.all(~np.isfinite(vals[g]))) for g in range(n_groups)])
    return style_category_axis(
        ax, list(x), groups, raw_labels=raw_groups or groups, **(axis_style or {}),
    )


def _label_bar_counts(
    ax: Any, x: Any, width: float, vals: Any, errs: Any | None, counts: Any, n_series: int,
) -> None:
    """``n=K`` over each grouped bar, where the screen draws its caption
    (``statRenderBar.ts`` / ``lib/groupAxis.barCountAnchor``): above the
    bar's upper error whisker, never below the zero baseline, and AT the
    baseline for a missing (NaN) bar. The offset is in points, so it is
    size-independent."""
    for si in range(n_series):
        offset = (si - (n_series - 1) / 2) * width
        for gi in range(len(x)):
            mean = float(vals[gi, si])
            sem = float(errs[gi, si]) if errs is not None else float("nan")
            reach = mean + sem if np.isfinite(sem) else mean
            top = max(reach, 0.0) if np.isfinite(mean) else 0.0
            ax.annotate(
                f"n={int(counts[gi][si])}", (x[gi] + offset, top), xytext=(0, 2),
                textcoords="offset points", ha="center", va="bottom", fontsize="x-small",
                color="0.45", annotation_clip=False,
            )


def _to_matrix(
    values: list[list[float | None]], n_groups: int, n_series: int, name: str
) -> np.ndarray:
    """``None`` entries (a series with no finite value in that category, P2.6
    box 2 -- JSON has no NaN) become NaN: no bar is drawn for them."""
    arr = np.asarray(
        [[np.nan if v is None else v for v in row] for row in values], dtype=float,
    ) if values else np.asarray(values, dtype=float)
    if arr.shape != (n_groups, n_series):
        raise ValueError(f"{name} must have shape ({n_groups}, {n_series}), got {arr.shape}")
    return arr


def _to_counts(
    counts: list[list[int]] | None, n_groups: int, n_series: int
) -> list[list[int]] | None:
    if counts is None:
        return None
    if len(counts) != n_groups or any(len(row) != n_series for row in counts):
        raise ValueError(f"counts must have shape ({n_groups}, {n_series})")
    return [[int(c) for c in row] for row in counts]


def _to_error_matrix(
    errors: list[list[float | None]] | None, n_groups: int, n_series: int
) -> np.ndarray | None:
    if errors is None:
        return None
    if len(errors) != n_groups:
        raise ValueError(f"errors must have {n_groups} rows, got {len(errors)}")
    out = np.full((n_groups, n_series), np.nan)
    for gi, row in enumerate(errors):
        if len(row) != n_series:
            raise ValueError(f"errors row {gi} must have {n_series} entries, got {len(row)}")
        for si, e in enumerate(row):
            if e is not None:
                out[gi, si] = float(e)
    return out


def render_categorical_figure(
    groups: list[str],
    series: list[str],
    values: list[list[float | None]],
    errors: list[list[float | None]] | None = None,
    *,
    stacked: bool = False,
    counts: list[list[int]] | None = None,
    caveat: str | None = None,
    axis_style: dict[str, Any] | None = None,
    bar_marks: dict[str, Any] | None = None,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int = 200,
) -> bytes:
    """Render a grouped or stacked bar chart to image bytes.

    ``values[g][s]`` is the bar height (mean) for category ``groups[g]``,
    series ``series[s]``; ``errors[g][s]`` (optional, ``None`` entries allowed
    = no whisker for that bar) is its SEM. ``stacked=False`` clusters series
    side by side within each category; ``stacked=True`` draws one bar per
    category with series stacked bottom-to-top (only the topmost segment's
    error bar is drawn, matching the interactive stat stage's convention —
    a stacked bar's lower segments' own spread isn't visually meaningful once
    summed).

    ``counts`` / ``caveat`` (P2.6 box 2): see ``_draw_categorical_bars`` and
    ``calc.figure_group_notes.add_caveat``. Both default off --
    byte-identical to before. ``bar_marks`` (P2.6 box 1): raw points and the
    summary marker over grouped bars, see ``_draw_categorical_bars``.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if not groups:
        raise ValueError("groups must be non-empty")
    if not series:
        raise ValueError("series must be non-empty")
    n_groups, n_series = len(groups), len(series)
    vals = _to_matrix(values, n_groups, n_series, "values")
    errs = _to_error_matrix(errors, n_groups, n_series)
    cnts = _to_counts(counts, n_groups, n_series) if not stacked else None

    st = figure_style(style)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
    }

    with render_scope(rc):
        # Rich-text labels (GOTO #5): de-math INVALID $...$ so savefig never
        # raises. Inside render_scope (review fix): each trial-parse below
        # reacquires the SAME re-entrant lock this scope already holds --
        # one real acquire per render, not one per label.
        title = safe_mathtext_label(title)
        x_label = safe_mathtext_label(x_label)
        y_label = safe_mathtext_label(y_label)
        # Review finding 8: the raw category labels ride alongside the
        # sanitized ones, threaded to `style_category_axis`'s wrap (its own
        # doc) via `_draw_categorical_bars`.
        raw_groups = [str(g) for g in groups]
        groups = [safe_mathtext_label(str(g)) for g in groups]
        series = [safe_mathtext_label(str(s)) for s in series]
        fig = new_figure(figsize=figsize)
        ax = fig.subplots()
        outer = _draw_categorical_bars(
            ax, groups, series, vals, errs, stacked, cnts, axis_style, raw_groups, bar_marks,
        )
        layout_rect = add_caveat(fig, caveat)
        if title:
            ax.set_title(title)
        if x_label:
            # Review finding 5: `_draw_categorical_bars` returns the outer-tier
            # axis whenever `axis_style` draws one (bars are never nested
            # TODAY, but the helper is shared with a faceted panel and takes
            # the same `axis_style` a nested box/violin plot would) -- the x
            # title belongs on IT, or it collides with the second tier
            # (`figure_statplots.render_statplot_figure` does the same
            # `(outer or ax).set_xlabel` already).
            (outer or ax).set_xlabel(x_label)
        if y_label:
            ax.set_ylabel(y_label)
        if not st.box_on:
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
        if n_series > 1:
            ax.legend(  # type: ignore[call-overload]
                frameon=st.legend_box, fontsize=st.legend_font_size, loc=st.legend_location,
            )
        if st.grid_alpha > 0:
            ax.grid(True, alpha=st.grid_alpha, axis="y")
        fig.tight_layout(rect=layout_rect)  # None = the default layout
        return savefig_bytes(fig, fmt, dpi=dpi)
