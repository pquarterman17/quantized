"""Publication rendering for statistical plots: box / violin / Q-Q / histogram.

ORIGIN_GAP_PLAN #16 (export half). Pure layer: grouped/1-D data in -> image
bytes out. matplotlib's ``boxplot`` / ``violinplot`` compute the same stats as
``calc.statplots`` (linear-interp quartiles + Tukey whiskers; gaussian_kde
violins), and the Q-Q reference line + histogram binning come straight from
``calc.statplots``, so the exported figure and the interactive stage show
identical statistics. Shares ``render_figure``'s style presets and formats.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from numpy.typing import ArrayLike  # noqa: E402

from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402
from quantized.calc.statplots import box_stats as _box_stats  # noqa: E402
from quantized.calc.statplots import deterministic_jitter as _jitter  # noqa: E402
from quantized.calc.statplots import histogram as _histogram  # noqa: E402
from quantized.calc.statplots import qq_plot as _qq_plot  # noqa: E402

__all__ = ["STATPLOT_KINDS", "render_statplot_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")
# "strip" (JMP_GAP J5 #3): a points-only categorical plot, same category
# slots as box/violin but no quartile/whisker glyph -- always scatters jittered
# points, optionally overlaid with a mean+-95% CI marker (#2).
STATPLOT_KINDS = ("box", "violin", "qq", "probability", "histogram", "strip")
_GROUPED = ("box", "violin", "strip")
_BOX_WIDTH = 0.5  # matplotlib boxplot's own default box width, data units


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

    ``dpi`` defaults to the style preset's calibrated resolution when not
    given (``None``), same as ``calc.figure``'s ``resolved_dpi`` convention;
    the preset's box-tick convention (``xtick.top``/``ytick.right`` mirrored
    when the preset draws a closed box) is honored too.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if kind not in STATPLOT_KINDS:
        raise ValueError(f"kind must be one of {STATPLOT_KINDS}")
    # Rich-text labels (GOTO #5): de-math INVALID $...$ so savefig never raises.
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)
    labels = [safe_mathtext_label(str(g)) for g in labels] if labels else labels
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

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=figsize)
        try:
            _draw_statplot(
                ax, kind, data, labels, dist, bins, fit, st,
                show_points=show_points, point_row_indices=point_row_indices,
                show_mean_ci=show_mean_ci, show_connect_means=show_connect_means,
            )
            if title:
                ax.set_title(title)
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
            if not st.box_on:
                ax.spines["top"].set_visible(False)
                ax.spines["right"].set_visible(False)
            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)


def _clean_groups_with_indices(
    data: list[ArrayLike], row_indices: list[list[int]] | None,
) -> tuple[list[np.ndarray], list[list[int]]]:
    """Like ``_clean_groups`` but keeps each surviving value's row index
    aligned (masks both by the SAME finite mask) -- ``show_points``'s jitter
    needs the ORIGINAL dataset row index, not a point's position after
    dropping non-finite values. A missing/length-mismatched ``row_indices``
    entry degrades to a plain ``0..n-1`` sequence for that group (never
    raises -- jitter identity with the screen is best-effort, not load-
    bearing for the plot to render)."""
    groups: list[np.ndarray] = []
    idxs: list[list[int]] = []
    for i, g in enumerate(data):
        v = np.asarray(g, dtype=float).ravel()
        mask = np.isfinite(v)
        if not mask.any():
            raise ValueError("every group must have at least one finite value")
        groups.append(v[mask])
        raw_idx = row_indices[i] if row_indices is not None and i < len(row_indices) else None
        if raw_idx is not None and len(raw_idx) == v.size:
            idx_arr = np.asarray(raw_idx, dtype=int)[mask]
            idxs.append([int(x) for x in idx_arr])
        else:
            idxs.append(list(range(int(mask.sum()))))
    return groups, idxs


def _scatter_jittered_points(
    ax: Any,
    groups: list[np.ndarray],
    labels: list[str],
    ticks: list[int],
    row_indices: list[list[int]],
    *,
    width: float = _BOX_WIDTH,
) -> None:
    """Raw-point overlay (JMP_GAP J5 #1): each group's finite values,
    jittered horizontally by ``deterministic_jitter(row_index, label)`` --
    the SAME hash `statRenderBox.ts` uses on screen, so a point sits in the
    same relative spot in both places."""
    for g, lab, tick, idx in zip(groups, labels, ticks, row_indices, strict=True):
        offsets = [_jitter(i, lab) * (width / 2) * 0.7 for i in idx]
        xs = [tick + off for off in offsets]
        ax.scatter(xs, g, s=10, color="0.25", alpha=0.6, zorder=4, linewidths=0)


def _overlay_mean_ci(ax: Any, groups: list[np.ndarray], ticks: list[int]) -> None:
    """Mean +/- 95% CI marker (JMP_GAP J5 #2): a diamond at the group mean
    with a t-based CI whisker, computed by the SAME ``box_stats`` the
    interactive stage's ``/api/statplots/box`` reads (its ``sem``/``ci_lo``/
    ``ci_hi`` fields) -- never a fresh/independent stats computation."""
    for g, tick in zip(groups, ticks, strict=True):
        b = _box_stats(g)
        mean, lo, hi = b["mean"], b["ci_lo"], b["ci_hi"]
        yerr = [[mean - lo], [hi - mean]] if np.isfinite(lo) and np.isfinite(hi) else None
        ax.errorbar(
            [tick], [mean], yerr=yerr, fmt="D", color="black",
            markersize=6, capsize=4, linewidth=1.5, zorder=5,
        )


def _draw_connect_means_line(ax: Any, groups: list[np.ndarray], ticks: list[int]) -> None:
    """Connect-group-means line (JMP_GAP J5 residual): a dashed line through
    each group's mean, in on-screen category order -- the "interaction plot"
    read for a box/strip plot grouped by a categorical column. Reads the
    SAME ``box_stats`` mean ``_overlay_mean_ci`` uses, never a second/
    independent computation."""
    means = [_box_stats(g)["mean"] for g in groups]
    ax.plot(ticks, means, color="black", linewidth=1.25, linestyle="--", zorder=5)


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
) -> None:
    if kind in _GROUPED:
        if not isinstance(data, list) or not data:
            raise ValueError(f"{kind} needs a non-empty list of groups")
        groups, row_indices = _clean_groups_with_indices(data, point_row_indices)
        ticks = list(range(1, len(groups) + 1))
        cat_labels = labels or [f"group {i + 1}" for i in range(len(groups))]
        if kind == "box":
            # A caller-provided mean+-CI marker replaces boxplot's own tiny
            # mean-triangle (showmeans) -- one mean glyph on screen, not two.
            ax.boxplot(groups, tick_labels=labels, showmeans=not show_mean_ci)
        elif kind == "violin":
            parts = ax.violinplot(groups, positions=ticks, showmeans=True, showextrema=True)
            if labels:
                ax.set_xticks(ticks)
                ax.set_xticklabels(labels)
            del parts
        else:  # strip (JMP_GAP J5 #3): points-only, no box/violin glyph
            ax.set_xticks(ticks)
            ax.set_xticklabels(cat_labels)
            ax.set_xlim(0.5, len(groups) + 0.5)
        if kind in ("box", "strip") and show_points:
            _scatter_jittered_points(ax, groups, cat_labels, ticks, row_indices)
        if kind in ("box", "strip") and show_mean_ci:
            _overlay_mean_ci(ax, groups, ticks)
        if kind in ("box", "strip") and show_connect_means and len(groups) > 1:
            _draw_connect_means_line(ax, groups, ticks)
        return

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
        return

    # histogram
    h = _histogram(sample, bins=bins, density=fit is not None, fit=fit)
    edges = np.asarray(h["edges"])
    ax.hist(sample, bins=edges, density=fit is not None,
            color="0.6", edgecolor="white", linewidth=0.5)
    if fit is not None and "fit" in h:
        ax.plot(h["fit"]["x"], h["fit"]["pdf"], color="0.1", linewidth=st.line_width)
