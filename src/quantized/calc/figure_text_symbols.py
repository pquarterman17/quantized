"""Text symbols for the publication renderer (plan item 24, Origin's Plot
Details > Symbol > Unicode).

The export half of ``frontend/src/lib/uplotTextSymbols.ts``. A series with
``marker_text`` (1-3 characters) draws that string, centred, at each point in
the series colour instead of a glyph; ``marker_text_size`` is its font size in
points (4-72, default :data:`TEXT_SYMBOL_PT`). Rules shared with the canvas:

* the rows are the series' DRAWN points (finite x and y) in row order, every
  ``marker_every``-th one, at most :data:`TEXT_SYMBOL_MAX` of them -- a longer
  series keeps its first rows and the figure says so;
* the string replaces the glyph whether or not ``marker`` is on, and bars
  draw none;
* ``marker_texts`` (one string or null per row, resolved by the client from a column, the
  letters A, B, C... or the SOURCE row numbers) replaces ``marker_text``: each kept row draws
  its own text and a blank one draws none (thinning and the cap count the drawn rows, blank
  or not). A list whose length is not the series' row count is ignored (the literal text,
  else nothing);
* a bad value draws nothing (an export never fails on a style hint).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np

from quantized.calc.figure_warnings import note_figure_warning
from quantized.heavy_import import heavy_imports

__all__ = [
    "TEXT_SWATCH_ATTR",
    "TEXT_SYMBOL_MAX",
    "TEXT_SYMBOL_PT",
    "apply_text_symbols",
    "row_texts",
    "text_swatch",
    "text_symbol",
]

TEXT_SYMBOL_PT = 10.0
TEXT_SYMBOL_MAX = 5000
#: A line drawn with text symbols carries its legend swatch (first character, size).
TEXT_SWATCH_ATTR = "_qz_text_swatch"


TEXT_ROW_MAX_CHARS = 32


def row_texts(spec: Mapping[str, Any] | None, n: int) -> list[str | None] | None:
    """The per-row texts of ``spec`` for ``n`` rows, or None (absent, or the wrong length)."""
    raw = spec.get("marker_texts") if isinstance(spec, Mapping) else None
    if not isinstance(raw, list) or len(raw) != n:
        return None
    return [t[:TEXT_ROW_MAX_CHARS] if isinstance(t, str) and t.strip() else None for t in raw]


def text_symbol(spec: Mapping[str, Any] | None) -> tuple[str, float, int] | None:
    """``(text, size_pt, every)`` for a valid text symbol, else None. A per-row series
    (``marker_texts``) has text ``""``; :func:`row_texts` holds the rows' own."""
    if not isinstance(spec, Mapping) or spec.get("bars"):
        return None
    text = spec.get("marker_text")
    if isinstance(spec.get("marker_texts"), list):
        text = text if isinstance(text, str) else ""
    elif not isinstance(text, str) or not text.strip() or len(text) > 3:
        return None
    size = spec.get("marker_text_size")
    ok = isinstance(size, int | float) and not isinstance(size, bool) and 4 <= size <= 72
    every = spec.get("marker_every")
    good = isinstance(every, int) and not isinstance(every, bool) and 1 < every <= 100000
    return text, float(size) if ok else TEXT_SYMBOL_PT, int(every) if good else 1  # type: ignore[arg-type]


def apply_text_symbols(line: Any, spec: Mapping[str, Any] | None) -> None:
    """Replace ``line``'s glyphs with ``spec``'s text (module doc). The line keeps its data, so the
    limits do not change; its marker is cleared and one ``Text`` per kept point is added."""
    sym = text_symbol(spec)
    ax = getattr(line, "axes", None)
    if sym is None or ax is None:
        return
    text, size, every = sym
    xs = np.asarray(line.get_xdata(), dtype=float)
    ys = np.asarray(line.get_ydata(), dtype=float)
    base = line.get_markevery()
    idx = [int(i) for i in base] if isinstance(base, list | tuple | np.ndarray) else range(len(ys))
    drawn = [i for i in idx if i < len(ys) and np.isfinite(xs[i]) and np.isfinite(ys[i])]
    rows = drawn[::every]
    if len(rows) > TEXT_SYMBOL_MAX:
        note_figure_warning(
            f"Text symbols are drawn on the first {TEXT_SYMBOL_MAX} points of a series; "
            f"{len(rows) - TEXT_SYMBOL_MAX} more were left plain."
        )
        rows = rows[:TEXT_SYMBOL_MAX]
    per_row = row_texts(spec, len(ys))
    if per_row is None and isinstance(spec, Mapping) and isinstance(spec.get("marker_texts"), list):
        note_figure_warning(
            "Per-point text symbols do not fit this series' rows, so it keeps "
            f"{'its text' if text.strip() else 'plain glyphs'}."
        )
    if per_row is None and not text.strip():
        return  # per-row texts that do not fit the rows, and no literal text: the glyphs stay
    line.set_marker("")
    pool = (text if per_row is None else "", *(per_row or []))
    first = next((t for t in pool if t and t.strip()), "")
    if first:
        setattr(line, TEXT_SWATCH_ATTR, (first.strip()[0], size))
    colour = line.get_color()
    for i in rows:
        own = text if per_row is None else per_row[i]
        if not own:
            continue
        ax.text(
            xs[i], ys[i], own, ha="center", va="center", fontsize=size, color=colour,
            clip_on=True, zorder=line.get_zorder() + 0.1, gid="text-symbol",
        )


def text_swatch(handle: Any) -> Any:
    """The legend handle for ``handle``: a text-symbol line gets a proxy line (same colour, dash and
    width) whose marker is its first character, as the canvas swatch shows; any other handle, or a
    character matplotlib cannot set as a marker, comes back unchanged."""
    mark = getattr(handle, TEXT_SWATCH_ATTR, None)
    if not mark:
        return handle
    ch, size = mark
    with heavy_imports("matplotlib.lines", "matplotlib.markers"):
        from matplotlib.lines import Line2D
        from matplotlib.markers import MarkerStyle
    try:
        glyph = MarkerStyle(r"$\$$" if ch == "$" else f"${ch}$")
    except ValueError:
        return handle
    proxy = Line2D(
        [], [], color=handle.get_color(), linestyle=handle.get_linestyle(),
        linewidth=handle.get_linewidth(), marker=glyph, markersize=size, label=handle.get_label(),
    )
    for name, value in vars(handle).items():
        if name.startswith("_qz"):
            setattr(proxy, name, value)
    return proxy
