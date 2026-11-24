"""Bland-Altman and Pareto publication figures (GAP_AUDIT_9 G15).

Pure layer; the numbers come from ``calc.plots2_stats`` (see there for the
Bland & Altman 1986 / 1999 citations). Bland-Altman: difference against pair
mean, bias line, limits of agreement (bias +/- k SD, k = 1.96) and each line's
confidence interval as a shaded band. Pareto: descending bars, cumulative-%
line on a right-hand 0-100 axis.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.figure import style_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style
from quantized.calc.plots2_stats import LOA_SD, bland_altman, pareto_table

__all__ = ["render_bland_altman_figure", "render_pareto_figure"]

_FORMATS = ("pdf", "svg", "eps", "png", "tiff")


def _check_fmt(fmt: str) -> None:
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")


def render_bland_altman_figure(
    a: ArrayLike,
    b: ArrayLike,
    *,
    level: float = 0.95,
    k: float = LOA_SD,
    percent: bool = False,
    show_ci: bool = True,
    x_label: str = "",
    y_label: str = "",
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    transparent: bool = False,
    svg_text_as_paths: bool = False,
) -> bytes:
    """Bland-Altman plot of ``a`` vs ``b``. ``ValueError`` on bad input."""
    _check_fmt(fmt)
    r = bland_altman(a, b, level=level, k=k, percent=percent)
    st = figure_style(style)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    unit = "%" if percent else ""
    with render_scope(style_rc(st, {})):
        fig = new_figure(figsize=figsize)
        ax = fig.subplots()
        ax.scatter(r.mean_of_pairs, r.difference, s=18, c="C0", edgecolors="k",
                   linewidths=0.4, zorder=3)
        lines = (
            (r.bias, r.bias_ci, f"bias {r.bias:.4g}{unit}", "k", "-"),
            (r.upper, r.upper_ci, f"+{k:g} SD {r.upper:.4g}{unit}", "C3", "--"),
            (r.lower, r.lower_ci, f"\N{MINUS SIGN}{k:g} SD {r.lower:.4g}{unit}", "C3", "--"),
        )
        for est, ci, lab, col, ls in lines:
            ax.axhline(est, color=col, linestyle=ls, linewidth=1.2, label=lab, zorder=2)
            if show_ci:
                ax.axhspan(ci[0], ci[1], color=col, alpha=0.12, linewidth=0, zorder=1)
        ax.axhline(0.0, color="0.6", linewidth=0.6, zorder=0)
        ax.set_xlabel(safe_mathtext_label(x_label or "mean of the two methods"))
        default_y = "difference (%)" if percent else "difference (A \N{MINUS SIGN} B)"
        ax.set_ylabel(safe_mathtext_label(y_label or default_y))
        ci_note = f"; shaded: {level * 100:g}% CI of each line" if show_ci else ""
        ax.set_title(safe_mathtext_label(title) if title else f"Bland-Altman (n = {r.n}{ci_note})",
                     fontsize=st.title_font_size)
        ax.legend(loc="best", frameon=False)
        fig.tight_layout()
        return savefig_bytes(
            fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi),
            transparent=transparent, svg_text_as_paths=svg_text_as_paths,
        )


def render_pareto_figure(
    labels: list[str],
    values: ArrayLike,
    *,
    max_categories: int = 30,
    value_label: str = "",
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    transparent: bool = False,
    svg_text_as_paths: bool = False,
) -> bytes:
    """Pareto chart: ``labels`` summed per category, sorted descending, with a
    cumulative-% line. ``ValueError`` on bad input or more than
    ``max_categories`` categories (a Pareto of hundreds is unreadable)."""
    _check_fmt(fmt)
    t = pareto_table(labels, values)
    if len(t.labels) > max_categories:
        raise ValueError(
            f"{len(t.labels)} categories exceed the Pareto limit of {max_categories}; "
            "pick a column with fewer distinct categories"
        )
    st = figure_style(style)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    pos = np.arange(len(t.labels))
    with render_scope(style_rc(st, {})):
        fig = new_figure(figsize=figsize)
        ax = fig.subplots()
        ax.bar(pos, t.values, color="C0", width=0.8, zorder=2)
        ax.set_xticks(pos)
        ax.set_xticklabels([safe_mathtext_label(s) for s in t.labels], rotation=45, ha="right")
        ax.set_ylabel(safe_mathtext_label(value_label or "value"))
        ax.set_ylim(0, t.total)  # bar heights and the 100 % line share one scale
        ax2 = ax.twinx()
        ax2.plot(pos, t.cumulative_pct, color="C3", marker="o", markersize=4, zorder=3)
        ax2.set_ylim(0, 100)
        ax2.set_ylabel("cumulative %")
        ax2.axhline(80.0, color="0.6", linestyle=":", linewidth=0.8)
        if title:
            ax.set_title(safe_mathtext_label(title))
        fig.tight_layout()
        return savefig_bytes(
            fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi),
            transparent=transparent, svg_text_as_paths=svg_text_as_paths,
        )
