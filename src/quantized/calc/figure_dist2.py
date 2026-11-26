"""Export side of the marginal and ridgeline plots (``Stage/statRenderDist2.ts``).

Both draw exactly the vertices of ``calc.statplots_marginal.marginal_geometry``
and ``calc.statplots_ridgeline.ridgeline_geometry``; the canvas maps the same
vertices to pixels, and ``tests/fixtures/wire/stat_marginal.json`` /
``stat_ridgeline.json`` pin the two together. Artists carry gids
(``marginal-points``, ``marginal-x-bars``, ``marginal-y-box``, ``ridge-fill-<k>``
...) so tests and audits can find them.

The marginal figure is a 3 x 3 grid whose rows are ``[R, G, 1-R-G]`` and columns
``[1-R-G, G, R]`` (``R`` = ``MARGINAL_RATIO``, ``G`` = ``MARGINAL_GAP``), the
centre row and column left empty: the scatter, the top strip and the right
strip take the same fractions of the plot area the canvas gives them.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from numpy.typing import ArrayLike

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style
from quantized.calc.statplots_marginal import (
    BOX_BAND,
    MARGINAL_GAP,
    MARGINAL_RATIO,
    marginal_geometry,
    marginal_series,
)
from quantized.calc.statplots_ridgeline import RIDGE_POINTS, ridgeline_geometry, ridgeline_series
from quantized.heavy_import import heavy_imports

__all__ = ["DIST2_KINDS", "draw_marginal", "draw_ridgeline", "render_dist2_figure"]

DIST2_KINDS = ("marginal", "ridgeline")
POINT_ALPHA = 0.85  # the canvas's twin (statRenderMarginal.ts), pinned by wire/stat_marginal.json
RIDGE_ALPHA = 0.7
STRIP_ALPHA = 0.55


def _color(colors: Sequence[str | None] | None, k: int) -> str:
    c = colors[k] if colors and k < len(colors) else None
    return c or f"C{k}"


def _quad(axis: str, a0: float, a1: float, c0: float, c1: float) -> list[tuple[float, float]]:
    """A rectangle spanning ``a0..a1`` ALONG the strip's axis and ``c0..c1``
    across it; the right strip (``axis == "y"``) is the top strip transposed."""
    pts = [(a0, c0), (a1, c0), (a1, c1), (a0, c1)]
    return pts if axis == "x" else [(c, a) for a, c in pts]


def _pair(axis: str, a: float, c: float) -> tuple[float, float]:
    return (a, c) if axis == "x" else (c, a)


def _draw_strip(ax: Any, axis: str, strip: dict[str, Any], color: str) -> None:
    with heavy_imports("matplotlib.collections"):
        from matplotlib.collections import LineCollection, PolyCollection

    gid = f"marginal-{axis}"
    kind = strip["kind"]
    if kind == "histogram":
        polys = [_quad(axis, x0, x1, 0.0, h) for x0, x1, h in strip["bars"]]
        ax.add_collection(
            PolyCollection(polys, facecolors=[color], alpha=STRIP_ALPHA, linewidths=0,
                           gid=f"{gid}-bars"),
            autolim=False,
        )
    elif kind == "box":
        q1, q3 = strip["box"]
        lo, hi = BOX_BAND
        mid = 0.5 * (lo + hi)
        ax.add_collection(
            PolyCollection([_quad(axis, q1, q3, lo, hi)], facecolors=[color], alpha=STRIP_ALPHA,
                           edgecolors=[color], gid=f"{gid}-box"),
            autolim=False,
        )
        med = strip["median"]
        ax.add_collection(
            LineCollection([[_pair(axis, med, lo), _pair(axis, med, hi)]], colors=[color],
                           linewidths=1.5, gid=f"{gid}-median"),
            autolim=False,
        )
        wlo, whi = strip["whiskers"]
        ax.add_collection(
            LineCollection(
                [[_pair(axis, wlo, mid), _pair(axis, q1, mid)],
                 [_pair(axis, q3, mid), _pair(axis, whi, mid)]],
                colors=[color], linewidths=1.0, gid=f"{gid}-whiskers"),
            autolim=False,
        )
        fl = strip["fliers"]
        if fl:
            pts = [_pair(axis, v, mid) for v in fl]
            ax.scatter([p[0] for p in pts], [p[1] for p in pts], s=8, facecolors="none",
                       edgecolors=color, linewidths=0.8, gid=f"{gid}-fliers")
    else:
        segs = [[_pair(axis, x, y0), _pair(axis, x, y1)] for x, y0, y1 in strip["ticks"]]
        ax.add_collection(
            LineCollection(segs, colors=[color], alpha=STRIP_ALPHA, linewidths=1.0,
                           gid=f"{gid}-rug"),
            autolim=False,
        )


def draw_marginal(
    fig: Any,
    x: ArrayLike,
    y: ArrayLike,
    *,
    kind: str = "histogram",
    bins: str | int = "fd",
    color: str = "C0",
    x_label: str = "",
    y_label: str = "",
    title: str = "",
) -> dict[str, Any]:
    """Draw the scatter and both marginal strips on ``fig``; returns the three
    axes as ``{"main", "x", "y"}`` (``x`` = the top strip, ``y`` = the right)."""
    geo = marginal_geometry(marginal_series(x, y, kind=kind, bins=bins))
    r, g = MARGINAL_RATIO, MARGINAL_GAP
    gs = fig.add_gridspec(
        3, 3, width_ratios=[1 - r - g, g, r], height_ratios=[r, g, 1 - r - g],
        wspace=0.0, hspace=0.0,
    )
    main = fig.add_subplot(gs[2, 0])
    top = fig.add_subplot(gs[0, 0], sharex=main)
    right = fig.add_subplot(gs[2, 2], sharey=main)
    pts = geo["points"]
    main.scatter([p[0] for p in pts], [p[1] for p in pts], s=9, color=color, alpha=POINT_ALPHA,
                 linewidths=0, gid="marginal-points")
    main.set_xlim(*geo["domain"]["x"])
    main.set_ylim(*geo["domain"]["y"])
    _draw_strip(top, "x", geo["strips"]["x"], color)
    _draw_strip(right, "y", geo["strips"]["y"], color)
    top.set_ylim(0.0, 1.0)
    right.set_xlim(0.0, 1.0)
    top.set_yticks([])
    right.set_xticks([])
    top.tick_params(labelbottom=False, bottom=False)
    right.tick_params(labelleft=False, left=False)
    if x_label:
        main.set_xlabel(x_label)
    if y_label:
        main.set_ylabel(y_label)
    if title:
        top.set_title(title)
    return {"main": main, "x": top, "y": right}


def draw_ridgeline(
    ax: Any,
    data: Sequence[Any],
    labels: Sequence[str] | None,
    *,
    overlap: float = 1.0,
    bw: str | float = "scott",
    n_points: int = RIDGE_POINTS,
    colors: Sequence[str | None] | None = None,
    line_width: float = 1.0,
) -> None:
    """Draw one filled density ridge per group, first group on top."""
    series = ridgeline_series([list(c) for c in data], bw=bw, n_points=n_points)
    geo = ridgeline_geometry(series, overlap)
    for k, ridge in enumerate(geo["ridges"]):
        c = _color(colors, k)
        ax.fill(*zip(*ridge["fill"], strict=True), facecolor=c, alpha=RIDGE_ALPHA, linewidth=0,
                zorder=2 + 0.01 * (2 * k), gid=f"ridge-fill-{k}")
        ax.plot(*zip(*ridge["line"], strict=True), color=c, linewidth=line_width,
                zorder=2 + 0.01 * (2 * k + 1), gid=f"ridge-line-{k}")
    ax.set_xlim(*geo["domain"])
    ax.set_ylim(*geo["y_domain"])
    ax.set_yticks(geo["baselines"])
    ax.set_yticklabels(
        [safe_mathtext_label(str(labels[k])) if labels and k < len(labels) else f"group {k + 1}"
         for k in range(len(geo["ridges"]))]
    )


def render_dist2_figure(
    kind: str,
    data: Any,
    labels: Sequence[str] | None,
    options: dict[str, Any] | None,
    *,
    fmt: str,
    style: str,
    bins: str | int,
    title: str,
    x_label: str,
    y_label: str,
    dpi: int | None,
    width_in: float | None,
    height_in: float | None,
    colors: Sequence[str | None] | None,
    svg_text_as_paths: bool,
) -> bytes:
    """Render a marginal (``data`` = ``[xs, ys]``) or ridgeline (``data`` = one
    list per group) figure to image bytes."""
    opts = options or {}
    st = figure_style(style)
    rc: dict[str, Any] = {
        **font_family_rc(st), "font.size": st.font_size, "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
    }
    with render_scope(rc):
        fig = new_figure(figsize=(width_in or st.fig_width_in, height_in or st.fig_height_in))
        title, x_label, y_label = (safe_mathtext_label(t) for t in (title, x_label, y_label))
        if kind == "marginal":
            if len(data) != 2:
                raise ValueError("a marginal plot needs two columns: x and y")
            axes = draw_marginal(
                fig, data[0], data[1], kind=str(opts.get("kind", "histogram")), bins=bins,
                color=_color(colors, 0), x_label=x_label, y_label=y_label, title=title,
            )
            if not st.box_on:
                for a in axes.values():
                    a.spines["top"].set_visible(False)
                    a.spines["right"].set_visible(False)
        else:
            ax = fig.subplots()
            draw_ridgeline(
                ax, data, labels, overlap=float(opts.get("overlap", 1.0)),
                bw=opts.get("bw", "scott"), colors=colors, line_width=st.line_width,
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
        return savefig_bytes(
            fig, fmt, dpi=int(dpi) if dpi is not None else int(st.dpi),
            svg_text_as_paths=svg_text_as_paths,
        )
