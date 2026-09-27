"""Publication rendering for statistical plots: box / violin / Q-Q / histogram.

ORIGIN_GAP_PLAN #16 (export half). Pure layer: grouped/1-D data in -> image
bytes out. matplotlib's ``boxplot`` / ``violinplot`` compute the same stats as
``calc.statplots`` (linear-interp quartiles + Tukey whiskers; gaussian_kde
violins), and the Q-Q reference line + histogram binning come straight from
``calc.statplots``, so the exported figure and the interactive stage show
identical statistics. Shares ``render_figure``'s style presets and formats.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.figure_category_axis import style_category_axis
from quantized.calc.figure_group_notes import (
    add_caveat,
    annotate_top_counts,
    connect_segments,
    mark_empty_slots,
)
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_stat_marks import overlay_summary, resolve_marks, scatter_points
from quantized.calc.figure_styles import figure_style
from quantized.calc.statplots import box_stats as _box_stats
from quantized.calc.statplots import histogram as _histogram
from quantized.calc.statplots import qq_plot as _qq_plot

__all__ = ["STATPLOT_KINDS", "render_statplot_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")
# "strip" (JMP_GAP J5 #3): a points-only categorical plot, same category
# slots as box/violin but no quartile/whisker glyph -- always scatters jittered
# points, optionally overlaid with a mean+-95% CI marker (#2).
STATPLOT_KINDS = ("box", "violin", "qq", "probability", "histogram", "strip")
_GROUPED = ("box", "violin", "strip")


def _clean_groups(groups: list[ArrayLike]) -> list[np.ndarray]:
    out = []
    for g in groups:
        v = np.asarray(g, dtype=float).ravel()
        v = v[np.isfinite(v)]
        if v.size == 0:
            raise ValueError("every group must have at least one finite value")
        out.append(v)
    return out


def render_statplot_figure(
    kind: str,
    data: list[ArrayLike] | ArrayLike,
    *,
    labels: list[str] | None = None,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    dist: str = "norm",
    bins: str | int = "fd",
    fit: str | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    show_points: bool = False,
    point_row_indices: list[list[int]] | None = None,
    show_mean_ci: bool = False,
    show_connect_means: bool = False,
    show_n: bool = False,
    caveat: str | None = None,
    connect_breaks: list[bool] | None = None,
    marks: dict[str, Any] | None = None,
    axis_style: dict[str, Any] | None = None,
) -> bytes:
    """Render a statistical plot to image bytes.

    - ``box`` / ``violin`` / ``strip`` — ``data`` is a list of groups;
      ``labels`` names them. ``strip`` (JMP_GAP J5 #3) is points-only, no
      box/violin glyph.
    - ``qq`` / ``probability`` — ``data`` is one sample vs ``dist`` quantiles
      with a least-squares reference line.
    - ``histogram`` — one sample with a numpy bin rule (``bins``) and an
      optional distribution-fit overlay (``fit``, e.g. ``"norm"``).

    ``show_points`` (``box``/``strip``, JMP_GAP J5 #1) scatters each group's
    raw finite values, jittered horizontally with the SAME deterministic
    ``(row_index, category)`` hash the interactive canvas uses
    (``calc.statplots.deterministic_jitter``) — ``point_row_indices``
    supplies each group's ORIGINAL dataset row indices, parallel to ``data``;
    a missing or length-mismatched entry falls back to a plain 0..n-1
    sequence for that group (never crashes, just loses jitter identity with
    the screen for that group). ``show_mean_ci`` (``box``/``strip``,
    JMP_GAP J5 #2) overlays a diamond marker at the group mean with a 95%
    t-based CI whisker (``calc.statplots.box_stats``'s ``sem``/``ci_lo``/
    ``ci_hi`` — the SAME numbers the interactive stage reads), replacing
    ``boxplot``'s own tiny mean-triangle marker for ``box`` so there's only
    one mean glyph on screen. ``show_connect_means`` (``box``/``strip``,
    JMP_GAP J5 residual) draws a dashed line through each group's mean, in
    on-screen category order — the "interaction plot" read for a grouped
    box/strip plot (reads the SAME ``box_stats`` mean as ``show_mean_ci``,
    never a second computation).

    EMPTY groups (P2.6 box 2) are allowed for the grouped kinds, as long as
    at least one group has a finite value: an empty group keeps its category
    tick and gets an ``n=0`` marker instead of a glyph -- a declared level with
    no usable data is shown as missing, never closed up. ``show_n`` adds the
    per-group ``n=K`` annotation on a secondary top axis; ``caveat`` (the
    frontend's small-n / unbalanced-groups caveat, verbatim) becomes a
    one-line footnote. All three are ``calc.figure_group_notes``.
    ``connect_breaks`` (parallel to ``data``) lifts the connect-means line
    before a group whose HIDDEN empty level preceded it.

    ``marks`` (P2.6 box 1, ``box``/``strip``/``violin``): the raw-point,
    jitter, summary-marker and error-bar options -- keyword arguments of
    ``calc.figure_stat_marks.resolve_marks`` (``points``, ``jitter_width``,
    ``summary``, ``error_bars``). ``axis_style``: the category-axis options,
    keyword arguments of ``calc.figure_category_axis.style_category_axis``
    (``rotation``, ``wrap``, ``tiered``); a two-tier nested axis carries the
    x title under its outer tier. Both ``None`` = the output before them.

    ``dpi`` defaults to the style preset's calibrated resolution when not
    given (``None``), same as ``calc.figure``'s ``resolved_dpi`` convention;
    the preset's box-tick convention (``xtick.top``/``ytick.right`` mirrored
    when the preset draws a closed box) is honored too.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if kind not in STATPLOT_KINDS:
        raise ValueError(f"kind must be one of {STATPLOT_KINDS}")
    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
        # Mirror ticks onto the top/right spines whenever the preset draws a
        # closed box (matches calc.figure's convention; matplotlib's default
        # leaves top/right bare even with the full rectangular border).
        "xtick.top": st.box_on,
        "ytick.right": st.box_on,
    }

    with render_scope(rc):
        # Rich-text labels (GOTO #5): de-math INVALID $...$ so savefig never
        # raises. Inside render_scope (review fix): every trial-parse below
        # reacquires the SAME re-entrant lock this scope already holds --
        # one real acquire per render, not one per label.
        title = safe_mathtext_label(title)
        x_label = safe_mathtext_label(x_label)
        y_label = safe_mathtext_label(y_label)
        labels = [safe_mathtext_label(str(g)) for g in labels] if labels else labels
        fig = new_figure(figsize=figsize)
        ax = fig.subplots()
        outer = _draw_statplot(
            ax, kind, data, labels, dist, bins, fit, st,
            show_points=show_points, point_row_indices=point_row_indices,
            show_mean_ci=show_mean_ci, show_connect_means=show_connect_means,
            show_n=show_n, connect_breaks=connect_breaks, marks=marks, axis_style=axis_style,
        )
        layout_rect = add_caveat(fig, caveat)
        if title:
            ax.set_title(title)
        if x_label:
            (outer or ax).set_xlabel(x_label)
        if y_label:
            ax.set_ylabel(y_label)
        if not st.box_on:
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
        fig.tight_layout(rect=layout_rect)  # None = the default layout
        return savefig_bytes(fig, fmt, dpi=resolved_dpi)


def _clean_groups_with_indices(
    data: list[ArrayLike], row_indices: list[list[int]] | None,
) -> tuple[list[np.ndarray], list[list[int]]]:
    """Like ``_clean_groups`` but keeps each surviving value's row index
    aligned (masks both by the SAME finite mask) -- ``show_points``'s jitter
    needs the ORIGINAL dataset row index, not a point's position after
    dropping non-finite values. A missing/length-mismatched ``row_indices``
    entry degrades to a plain ``0..n-1`` sequence for that group (never
    raises -- jitter identity with the screen is best-effort, not load-
    bearing for the plot to render).

    A group with no finite value is kept, EMPTY, at its position (P2.6 box
    2: its slot stays on the axis with an ``n=0`` marker); only a request in
    which EVERY group is empty is refused."""
    groups: list[np.ndarray] = []
    idxs: list[list[int]] = []
    for i, g in enumerate(data):
        v = np.asarray(g, dtype=float).ravel()
        mask = np.isfinite(v)
        groups.append(v[mask])
        raw_idx = row_indices[i] if row_indices is not None and i < len(row_indices) else None
        if raw_idx is not None and len(raw_idx) == v.size:
            idx_arr = np.asarray(raw_idx, dtype=int)[mask]
            idxs.append([int(x) for x in idx_arr])
        else:
            idxs.append(list(range(int(mask.sum()))))
    if not any(g.size for g in groups):
        raise ValueError("at least one group must have a finite value")
    return groups, idxs


def _draw_connect_means_line(
    ax: Any, groups: list[np.ndarray], ticks: list[int], labels: list[str],
    breaks: list[bool] | None = None,
) -> None:
    """Connect-group-means line (JMP_GAP J5 residual): a dashed line through
    each group's mean, in on-screen category order -- the "interaction plot"
    read for a box/strip plot grouped by a categorical column. Reads the
    SAME ``box_stats`` mean the summary marker uses, never a second/
    independent computation. Broken into segments exactly where the screen
    breaks it (``figure_group_notes.connect_segments``): at an empty slot and
    at a nested outer-factor boundary."""
    empty = [g.size == 0 for g in groups]
    for seg in connect_segments(labels, empty, breaks):
        if len(seg) < 2:
            continue
        means = [_box_stats(groups[i])["mean"] for i in seg]
        ax.plot(
            [ticks[i] for i in seg], means, color="black", linewidth=1.25, linestyle="--",
            zorder=5,
        )


def _draw_statplot(
    ax: Any,
    kind: str,
    data: list[ArrayLike] | ArrayLike,
    labels: list[str] | None,
    dist: str,
    bins: str | int,
    fit: str | None,
    st: Any,
    *,
    show_points: bool = False,
    point_row_indices: list[list[int]] | None = None,
    show_mean_ci: bool = False,
    show_connect_means: bool = False,
    show_n: bool = False,
    connect_breaks: list[bool] | None = None,
    marks: dict[str, Any] | None = None,
    axis_style: dict[str, Any] | None = None,
) -> Any | None:
    """Draw one panel. Returns the outer-tier axis of a two-tier nested
    category axis (the x title goes on it), else ``None``."""
    if kind in _GROUPED:
        if not isinstance(data, list) or not data:
            raise ValueError(f"{kind} needs a non-empty list of groups")
        all_groups, all_idx = _clean_groups_with_indices(data, point_row_indices)
        all_ticks = list(range(1, len(all_groups) + 1))
        cat_labels = labels or [f"group {i + 1}" for i in range(len(all_groups))]
        empty = [g.size == 0 for g in all_groups]
        # Only FILLED slots get a glyph; an empty one keeps its tick (below).
        # With no empty slot these are the full lists and every call is the
        # one this function always made.
        filled = [i for i, e in enumerate(empty) if not e]
        groups = [all_groups[i] for i in filled]
        ticks = [all_ticks[i] for i in filled]
        row_indices = [all_idx[i] for i in filled]
        filled_labels = [cat_labels[i] for i in filled]
        mk = resolve_marks(
            kind, show_points=show_points, show_mean_ci=show_mean_ci, **(marks or {}),
        )
        if kind == "box":
            # A caller-provided summary marker replaces boxplot's own tiny
            # mean-triangle (showmeans) -- one mean glyph, not two.
            box_kw: dict[str, Any] = {"showmeans": mk.box_showmeans, "showfliers": mk.fliers}
            if mk.box_width is not None:
                box_kw["widths"] = mk.box_width
            if any(empty):
                # boxplot sizes boxes from the spread of the positions it is
                # GIVEN (clip(0.15*ptp, 0.15, 0.5)); pass the width the full
                # axis would get, so where the empty slots fall cannot change
                # every box's width.
                box_kw.setdefault("widths", float(np.clip(0.15 * (len(all_ticks) - 1), 0.15, 0.5)))
                ax.boxplot(groups, positions=ticks, **box_kw)
                ax.set_xticks(all_ticks)
                ax.set_xticklabels(labels or [str(t) for t in all_ticks])
            else:
                ax.boxplot(groups, tick_labels=labels, **box_kw)
        elif kind == "violin":
            # A new-style request draws the screen's glyph width (the points'
            # jitter is scaled to it); matplotlib's own default is 0.5.
            ax.violinplot(
                groups, positions=ticks, widths=mk.box_width or 0.5, showmeans=True,
                showextrema=True,
            )
            if labels or any(empty):
                ax.set_xticks(all_ticks)
                ax.set_xticklabels(labels or [str(t) for t in all_ticks])
        else:  # strip (JMP_GAP J5 #3): points-only, no box/violin glyph
            ax.set_xticks(all_ticks)
            ax.set_xticklabels(cat_labels)
        if kind == "strip" or any(empty):
            ax.set_xlim(0.5, len(all_groups) + 0.5)
        scatter_points(ax, groups, filled_labels, ticks, row_indices, mk)
        if kind in ("box", "strip"):
            overlay_summary(ax, groups, ticks, mk)
        if kind in ("box", "strip") and show_connect_means and len(groups) > 1:
            _draw_connect_means_line(ax, all_groups, all_ticks, cat_labels, connect_breaks)
        mark_empty_slots(ax, all_ticks, empty)
        if show_n:
            annotate_top_counts(ax, all_ticks, [g.size for g in all_groups])
        return style_category_axis(ax, all_ticks, cat_labels, **(axis_style or {}))

    sample = np.asarray(data, dtype=float).ravel()
    if kind in ("qq", "probability"):
        q = _qq_plot(sample, dist=dist)
        theo = np.asarray(q["theoretical_quantiles"])
        obs = np.asarray(q["sample_quantiles"])
        ax.scatter(theo, obs, s=12, color=st.accent if hasattr(st, "accent") else None)
        line = q["slope"] * theo + q["intercept"]
        ax.plot(theo, line, color="0.4", linewidth=st.line_width)
        ax.set_xlabel(ax.get_xlabel() or f"Theoretical quantiles ({dist})")
        ax.set_ylabel(ax.get_ylabel() or "Sample quantiles")
        return None

    # histogram
    h = _histogram(sample, bins=bins, density=fit is not None, fit=fit)
    edges = np.asarray(h["edges"])
    ax.hist(sample, bins=edges, density=fit is not None,
            color="0.6", edgecolor="white", linewidth=0.5)
    if fit is not None and "fit" in h:
        ax.plot(h["fit"]["x"], h["fit"]["pdf"], color="0.1", linewidth=st.line_width)
    return None
