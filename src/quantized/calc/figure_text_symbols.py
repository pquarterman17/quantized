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
* a bad value draws nothing (an export never fails on a style hint).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np

from quantized.calc.figure_warnings import note_figure_warning

__all__ = ["TEXT_SYMBOL_MAX", "TEXT_SYMBOL_PT", "apply_text_symbols", "text_symbol"]

TEXT_SYMBOL_PT = 10.0
TEXT_SYMBOL_MAX = 5000


def text_symbol(spec: Mapping[str, Any] | None) -> tuple[str, float, int] | None:
    """``(text, size_pt, every)`` for a valid text symbol, else None."""
    if not isinstance(spec, Mapping) or spec.get("bars"):
        return None
    text = spec.get("marker_text")
    if not isinstance(text, str) or not text.strip() or len(text) > 3:
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
    line.set_marker("")
    colour = line.get_color()
    for i in rows:
        ax.text(
            xs[i], ys[i], text, ha="center", va="center", fontsize=size, color=colour,
            clip_on=True, zorder=line.get_zorder() + 0.1, gid="text-symbol",
        )
