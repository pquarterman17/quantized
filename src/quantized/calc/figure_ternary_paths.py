"""Publication rendering of paths and vectors on the ternary triangle.

Plan item 25. Pure layer (matplotlib, no web types). The numerics -- row
normalisation, gaps, arrow endpoints -- live in ``calc.ternary_paths``; the
triangle itself is ``calc.figure_ternary_frame``. This module only draws them:

* **Line plot** (:func:`render_ternary_line_figure`): one ``Line2D`` per series,
  joining its compositions in row order. A gap row (missing cell) breaks the
  line; a point left alone between gaps is drawn as a dot so it never vanishes.
  Each series line carries the gid ``ternary-line-<i>``.
* **Vector plot** (:func:`render_ternary_vector_figure`): one ``FancyArrowPatch``
  per arrow from the start composition to the end composition, in the
  triangle's own coordinates with no shrink, so the tip sits exactly on the end
  composition and the length is the length in composition space. An arrow whose
  ends coincide is drawn as a dot. Optionally coloured by a value column (with a
  colour bar).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib
import numpy as np
from matplotlib.cm import ScalarMappable
from matplotlib.colors import Normalize, is_color_like
from matplotlib.patches import FancyArrowPatch
from numpy.typing import ArrayLike

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style
from quantized.calc.figure_ternary_frame import draw_ternary_frame
from quantized.calc.figure_warnings import note_figure_warning
from quantized.calc.ternary_field import ternary_xy
from quantized.calc.ternary_paths import (
    MAX_SERIES,
    arrows_between,
    normalise_path_rows,
    unit_sum_note,
    valid_runs,
)

__all__ = [
    "DASHES",
    "HEAD_STYLES",
    "render_ternary_line_figure",
    "render_ternary_vector_figure",
]

DASHES = {"solid": "-", "dashed": "--", "dotted": ":", "dashdot": "-."}
HEAD_STYLES = {"filled": "-|>", "open": "->"}
_FORMATS = ("pdf", "svg", "eps", "png", "tiff")
_FIGURE_SIZE_IN = (8, 7)
_HEAD_BASE_PT = 12.0  # mutation_scale at head_size 1


def _check(fmt: str, color: str | None) -> None:
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if color is not None and not is_color_like(color):
        raise ValueError(f"unknown colour {color!r}")


def _rc(st: Any) -> dict[str, Any]:
    return {
        **font_family_rc(st),
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
    }


def _corners(labels: Sequence[str]) -> tuple[str, str, str]:
    a, b, c = (safe_mathtext_label(str(s)) for s in labels)
    return a, b, c


def render_ternary_line_figure(
    series: Sequence[tuple[str, ArrayLike]],
    *,
    labels: tuple[str, str, str] = ("A", "B", "C"),
    color: str | None = None,
    width: float = 1.5,
    dash: str = "solid",
    markers: bool = False,
    marker_size: float = 6.0,
    legend: bool = True,
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    title: str = "",
) -> bytes:
    """Render one or more series as lines on the ternary triangle.

    ``series`` is a list of ``(name, rows)``; ``rows`` is ``(n, 3)``
    compositions (fractions or percentages, each divided by its own sum), with
    a NaN cell marking a gap the line does not cross. Series are coloured from
    the matplotlib cycle unless ``color`` is given, which is refused for more
    than one series (they could not be told apart). ``width`` is in points;
    ``dash`` one of :data:`DASHES`; ``markers`` puts a marker on every point.
    A legend lists the named series when ``legend`` is true.

    Raises ``ValueError`` on bad input: no series, too many series, an unknown
    ``dash``/``fmt``/colour, or compositions the scatter would refuse.
    """
    _check(fmt, color)
    if dash not in DASHES:
        raise ValueError(f"dash must be one of {sorted(DASHES)}")
    if not series:
        raise ValueError("need at least one series")
    if len(series) > MAX_SERIES:
        raise ValueError(f"at most {MAX_SERIES} series, got {len(series)}")
    if color is not None and len(series) > 1:
        raise ValueError("one colour for several series cannot be told apart; leave it automatic")
    prepared = []
    rescaled = False
    for i, (name, rows) in enumerate(series):
        abc, resc = normalise_path_rows(rows, what=f"series {i + 1}")
        if not (~np.isnan(abc).any(axis=1)).any():
            raise ValueError(f"series {i + 1} has no drawable composition")
        rescaled = rescaled or resc
        prepared.append((name, abc))
    if rescaled:
        note_figure_warning(unit_sum_note())

    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    with render_scope(_rc(st)):
        fig = new_figure(figsize=_FIGURE_SIZE_IN)
        ax = fig.subplots()
        draw_ternary_frame(ax, _corners(labels), st.font_size)
        for i, (name, abc) in enumerate(prepared):
            col = color if color is not None else f"C{i % 10}"
            x, y = ternary_xy(abc)
            line = ax.plot(
                x, y, linestyle=DASHES[dash], linewidth=width, color=col,
                marker="o" if markers else None, markersize=marker_size,
                label=safe_mathtext_label(name) if name else f"_series{i}",
                zorder=3,
            )[0]
            line.set_gid(f"ternary-line-{i}")
            lone = [a for a, b in valid_runs(abc) if b - a == 1]
            if lone and not markers:
                ax.plot(x[lone], y[lone], linestyle="none", marker="o",
                        markersize=max(3.0, width * 2), color=col, zorder=3,
                        label=f"_lone{i}")
        if legend and any(name for name, _ in prepared):
            ax.legend(loc="upper right", fontsize=st.font_size - 1, frameon=True)
        t = safe_mathtext_label(title)
        if t:
            fig.suptitle(t, fontsize=st.title_font_size)
        fig.tight_layout()
        return savefig_bytes(fig, fmt, dpi=resolved_dpi)


def render_ternary_vector_figure(
    start: ArrayLike,
    end: ArrayLike,
    *,
    labels: tuple[str, str, str] = ("A", "B", "C"),
    values: ArrayLike | None = None,
    z_label: str = "Value",
    cmap: str = "viridis",
    color: str | None = None,
    width: float = 1.5,
    head_size: float = 1.0,
    head_style: str = "filled",
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    title: str = "",
) -> bytes:
    """Render arrows from ``start`` to ``end`` compositions on the triangle.

    ``start`` and ``end`` are ``(n, 3)`` compositions (each row divided by its
    own sum); the arrow of row ``i`` runs from ``start[i]`` to ``end[i]``. A
    row with a gap (missing cell) at either end is skipped and counted in a
    figure warning. ``values`` (length n) colours the arrows by ``cmap`` with a
    colour bar; otherwise they use ``color`` (default ``C0``). ``width`` is the
    shaft width in points, ``head_size`` scales the head (1 = default),
    ``head_style`` is ``filled`` or ``open``.

    Raises ``ValueError`` on bad input: mismatched shapes, an unknown
    ``head_style``/``fmt``/``cmap``/colour, compositions the scatter would
    refuse, or no drawable arrow.
    """
    _check(fmt, color)
    if head_style not in HEAD_STYLES:
        raise ValueError(f"head_style must be one of {sorted(HEAD_STYLES)}")
    if values is not None and color is not None:
        raise ValueError("colour by values and a fixed colour are exclusive")
    if cmap not in matplotlib.colormaps:
        raise ValueError(f"unknown colormap {cmap!r}")
    s_abc, r1 = normalise_path_rows(start, what="start")
    e_abc, r2 = normalise_path_rows(end, what="end")
    arrows = arrows_between(s_abc, e_abc)
    zz = None
    if values is not None:
        zz = np.asarray(values, dtype=float).reshape(-1)
        if zz.shape[0] != s_abc.shape[0]:
            raise ValueError(f"values has {zz.shape[0]} entries, start has {s_abc.shape[0]} rows")
        if not np.isfinite(zz[arrows.kept]).all():
            raise ValueError("values must be finite for every drawable arrow")
        zz = zz[arrows.kept]
    if arrows.kept.size == 0:
        raise ValueError("no row has a drawable start and end composition")
    if r1 or r2:
        note_figure_warning(unit_sum_note())
    if arrows.skipped:
        one = arrows.skipped == 1
        note_figure_warning(
            f"{arrows.skipped} of {s_abc.shape[0]} rows {'has' if one else 'have'} a missing "
            f"start or end and {'was' if one else 'were'} left out."
        )

    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    with render_scope(_rc(st)):
        fig = new_figure(figsize=_FIGURE_SIZE_IN)
        ax = fig.subplots()
        draw_ternary_frame(ax, _corners(labels), st.font_size)
        mapper = None
        if zz is not None:
            lo, hi = float(zz.min()), float(zz.max())
            if hi <= lo:  # one value: a centred, non-degenerate range
                lo, hi = lo - 0.5, hi + 0.5
            mapper = ScalarMappable(norm=Normalize(lo, hi), cmap=cmap)
        shades = (
            np.asarray(mapper.cmap(mapper.norm(zz)))
            if mapper is not None and zz is not None else None
        )
        lengths = arrows.length
        for k in range(arrows.kept.size):
            col = tuple(shades[k]) if shades is not None else (color or "C0")
            p0 = (float(arrows.x0[k]), float(arrows.y0[k]))
            p1 = (float(arrows.x1[k]), float(arrows.y1[k]))
            if lengths[k] == 0.0:
                ax.plot([p0[0]], [p0[1]], marker="o", markersize=max(3.0, width * 2), color=col,
                        linestyle="none", zorder=4)
                continue
            patch = FancyArrowPatch(
                p0, p1, arrowstyle=HEAD_STYLES[head_style],
                mutation_scale=_HEAD_BASE_PT * head_size,
                linewidth=width, color=col, shrinkA=0, shrinkB=0, zorder=4,
                # FancyArrowPatch defaults to a round join, which leaves the visible tip a
                # little short of the end (0.9 pt at width 1.5). matplotlib pulls the head
                # outline back by the miter extension, so only a miter join puts the drawn
                # tip on the end composition.
                joinstyle="miter",
            )
            patch.set_gid(f"ternary-arrow-{int(arrows.kept[k])}")
            ax.add_patch(patch)
        if mapper is not None:
            fig.colorbar(mapper, ax=ax, label=safe_mathtext_label(z_label),
                         fraction=0.046, pad=0.04)
        t = safe_mathtext_label(title)
        if t:
            fig.suptitle(t, fontsize=st.title_font_size)
        fig.tight_layout()
        return savefig_bytes(fig, fmt, dpi=resolved_dpi)
