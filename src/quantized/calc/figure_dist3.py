"""Export side of the half / split violin, paired and lollipop plots
(``Stage/statRenderDist3.ts``).

Each draws exactly the vertices of ``calc.statplots_sideviolin.sideviolin_geometry``,
``statplots_paired.paired_geometry`` and ``statplots_lollipop.lollipop_geometry``;
the canvas maps the same vertices to pixels and ``tests/fixtures/wire/stat_*.json``
pin the two together. Artists carry gids (``sv-fill-<k>``, ``sv-line-<k>``,
``paired-line-<k>``, ``paired-before``, ``paired-mean-<side>``, ``lolli-stems``,
``lolli-dots`` ...) so tests and audits can find them.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style
from quantized.calc.statplots_lollipop import lollipop_geometry, lollipop_series
from quantized.calc.statplots_paired import DIRECTIONS, paired_geometry, paired_series
from quantized.calc.statplots_ridgeline import RIDGE_POINTS, ridgeline_series
from quantized.calc.statplots_sideviolin import sideviolin_geometry
from quantized.heavy_import import heavy_imports

__all__ = [
    "DIST3_KINDS", "draw_dist3_panel", "draw_lollipop", "draw_paired", "draw_sideviolin",
    "render_dist3_figure",
]

DIST3_KINDS = ("sideviolin", "paired", "lollipop")
SIDE_ALPHA = 0.7
LINE_ALPHA = 0.5
LINE_GREY = "0.45"
DIRECTION_ALPHA = 0.8
# Fallback colours of a request that carries none (the client sends its theme tokens).
DIRECTION_FALLBACK = ("C2", "C3", LINE_GREY)
MARK_DASH = {"median": "-", "q1": "--", "q3": "--"}


def _color(colors: Sequence[str | None] | None, k: int) -> str:
    c = colors[k] if colors and k < len(colors) else None
    return c or f"C{k}"


def _labels(ax: Any, labels: Sequence[str]) -> None:
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels([safe_mathtext_label(str(s)) for s in labels])


def draw_sideviolin(
    ax: Any,
    data: Sequence[Any],
    opts: dict[str, Any],
    *,
    colors: Sequence[str | None] | None = None,
    n_points: int = RIDGE_POINTS,
    line_width: float = 1.0,
) -> None:
    """Draw one violin side per group; ``opts`` = ``style``, ``slots``, ``sides``,
    ``slot_labels``, ``marks`` (inner median / quartile lines) and (split) ``levels``
    naming the left and right level."""
    style = str(opts.get("style", "half"))
    groups = [list(g) for g in data]
    series = ridgeline_series(groups, bw=opts.get("bw", "scott"), n_points=n_points)
    n = len(groups)  # no layout given: one half violin per group, on the right
    marks = str(opts.get("marks", "none"))
    geo = sideviolin_geometry(
        series, opts.get("slots", list(range(n))), opts.get("sides", ["right"] * n), style,
        data=groups, marks=marks,
    )
    for k, v in enumerate(geo["violins"]):
        c = _color(colors, v["color"])
        ax.fill(*zip(*v["fill"], strict=True), facecolor=c, alpha=SIDE_ALPHA, linewidth=0,
                gid=f"sv-fill-{k}")
        ax.plot(*zip(*v["line"], strict=True), color=c, linewidth=line_width, gid=f"sv-line-{k}")
        for m in v.get("marks", []):
            ax.plot(m["x"], [m["y"], m["y"]], color="black", linestyle=MARK_DASH[m["name"]],
                    linewidth=line_width * (1.5 if m["name"] == "median" else 1.0),
                    gid=f"sv-mark-{k}-{m['name']}")
    ax.set_xlim(*geo["x_domain"])
    ax.set_ylim(*geo["y_domain"])
    labels = list(opts.get("slot_labels") or [])
    m = geo["slots"]
    _labels(ax, labels if len(labels) == m else [str(i + 1) for i in range(m)])
    levels = opts.get("levels")
    if style == "split" and levels:
        with heavy_imports("matplotlib.patches"):
            from matplotlib.patches import Patch
        ax.legend(handles=[
            Patch(facecolor=_color(colors, i), alpha=SIDE_ALPHA, label=safe_mathtext_label(str(s)))
            for i, s in enumerate(levels)
        ])


def draw_paired(
    ax: Any,
    data: Sequence[Any],
    labels: Sequence[str] | None,
    *,
    ci: bool = False,
    colors: Sequence[str | None] | None = None,
    direction: bool = False,
    direction_colors: Sequence[str] | None = None,
) -> None:
    """Draw a line per subject from the first column to the second; ``ci`` adds the
    mean and its 95 % CI on each side; ``direction`` colours each line by up / down /
    same (``direction_colors``, one per direction) with a legend row for each."""
    if len(data) != 2:
        raise ValueError("a paired plot needs two columns: before and after")
    geo = paired_geometry(paired_series(data[0], data[1]), ci, direction)
    with heavy_imports("matplotlib.collections"):
        from matplotlib.collections import LineCollection
    if direction:
        given = list(direction_colors or [])
        dc = given + list(DIRECTION_FALLBACK[len(given):])
        for key, color, row in zip(DIRECTIONS, dc, geo["legend"], strict=True):
            segs = [ln for ln, d in zip(geo["lines"], geo["directions"], strict=True) if d == key]
            ax.add_collection(LineCollection(segs, colors=[color], alpha=DIRECTION_ALPHA,
                                             linewidths=1.2, label=row["label"],
                                             gid=f"paired-lines-{key}"), autolim=False)
    else:
        ax.add_collection(LineCollection(geo["lines"], colors=[LINE_GREY], alpha=LINE_ALPHA,
                                         linewidths=1.0, gid="paired-lines"), autolim=False)
    for name, k in (("before", 0), ("after", 1)):
        pts = geo[name]
        ax.scatter([p[0] for p in pts], [p[1] for p in pts], s=18, color=_color(colors, k),
                   linewidths=0, zorder=3, gid=f"paired-{name}")
    for k, m in enumerate(geo["means"]):
        ax.errorbar([m["x"]], [m["mean"]], yerr=[[m["mean"] - m["lo"]], [m["hi"] - m["mean"]]],
                    fmt="D", color="black", markersize=6, capsize=4, zorder=4,
                    gid=f"paired-mean-{k}")
    ax.set_xlim(*geo["x_domain"])
    ax.set_ylim(*geo["y_domain"])
    _labels(ax, list(labels or ["before", "after"]))
    if direction:
        keys = [f"paired-lines-{k}" for k in DIRECTIONS]
        ax.legend(handles=[h for h in ax.collections if h.get_gid() in keys])


def draw_lollipop(
    ax: Any,
    data: Sequence[Any],
    labels: Sequence[str] | None,
    *,
    stat: str = "mean",
    sort: str = "none",
    colors: Sequence[str | None] | None = None,
    horizontal: bool = False,
) -> None:
    """Draw one stem and dot per group (its mean or median), in the sorted order;
    ``horizontal`` puts the categories on Y (the first at the top)."""
    res = lollipop_series([list(g) for g in data], stat=stat, sort=sort)
    geo = lollipop_geometry(res, horizontal)
    c = _color(colors, 0)
    with heavy_imports("matplotlib.collections"):
        from matplotlib.collections import LineCollection
    ax.add_collection(LineCollection(geo["stems"], colors=[c], linewidths=1.5, gid="lolli-stems"),
                      autolim=False)
    ax.scatter([p[0] for p in geo["dots"]], [p[1] for p in geo["dots"]], s=36, color=c,
               zorder=3, gid="lolli-dots")
    (ax.axvline if horizontal else ax.axhline)(0.0, color="0.5", linewidth=0.8, zorder=1)
    ax.set_xlim(*geo["x_domain"])
    ax.set_ylim(*geo["y_domain"])
    names = [
        str(labels[i]) if labels and i < len(labels) else f"group {i + 1}" for i in res["order"]
    ]
    if horizontal:
        ax.set_yticks(geo["positions"])
        ax.set_yticklabels([safe_mathtext_label(s) for s in names])
    else:
        _labels(ax, names)


def draw_dist3_panel(
    ax: Any,
    kind: str,
    data: Sequence[Any],
    labels: Sequence[str] | None,
    opts: dict[str, Any],
    colors: Sequence[str | None] | None,
    line_width: float,
) -> None:
    """Draw one half / split violin, paired or lollipop panel on ``ax`` (a flat figure's only
    panel, or one panel of a facet grid: ``calc.figure_facets_dist3``)."""
    if kind == "sideviolin":
        draw_sideviolin(ax, data, opts, colors=colors, line_width=line_width)
    elif kind == "paired":
        draw_paired(ax, data, labels, ci=bool(opts.get("ci", False)), colors=colors,
                    direction=bool(opts.get("direction", False)),
                    direction_colors=opts.get("direction_colors"))
    else:
        draw_lollipop(ax, data, labels, stat=str(opts.get("stat", "mean")),
                      sort=str(opts.get("sort", "none")), colors=colors,
                      horizontal=bool(opts.get("horizontal", False)))


def render_dist3_figure(
    kind: str,
    data: Any,
    labels: Sequence[str] | None,
    options: dict[str, Any] | None,
    *,
    fmt: str,
    style: str,
    title: str,
    x_label: str,
    y_label: str,
    dpi: int | None,
    width_in: float | None,
    height_in: float | None,
    colors: Sequence[str | None] | None,
    svg_text_as_paths: bool,
) -> bytes:
    """Render a half / split violin, paired or lollipop figure to image bytes."""
    opts = options or {}
    st = figure_style(style)
    rc: dict[str, Any] = {
        **font_family_rc(st), "font.size": st.font_size, "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
    }
    with render_scope(rc):
        fig = new_figure(figsize=(width_in or st.fig_width_in, height_in or st.fig_height_in))
        ax = fig.subplots()
        draw_dist3_panel(ax, kind, data, labels, opts, colors, st.line_width)
        if title:
            ax.set_title(safe_mathtext_label(title))
        if x_label:
            ax.set_xlabel(safe_mathtext_label(x_label))
        if y_label:
            ax.set_ylabel(safe_mathtext_label(y_label))
        if not st.box_on:
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
        fig.tight_layout()
        return savefig_bytes(
            fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi),
            svg_text_as_paths=svg_text_as_paths,
        )
