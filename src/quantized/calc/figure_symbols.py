"""Symbol details for the publication renderer (origin gap audit 4 G10).

The export half of the canvas' ``markers.seriesPoints``: a series' marker
EDGE colour, FILL colour, fill opacity and "symbol every N points", from the
wire keys ``marker_edge`` / ``marker_face`` (hex) / ``marker_alpha`` (0..1) /
``marker_every`` (an int > 1). Applied to the drawn ``Line2D`` after it is
plotted, so every path that draws a marked line (the plain plot, Y2, x
breaks, facets) gets the same rule without each restating it.

Rules shared with the canvas:

* an edge or fill colour, or an opacity, fills the glyph with the fill colour
  (default: the line colour), the opacity applying to the fill only;
* an open symbol (``marker_fill: "hollow"``) keeps no fill;
* the symbol skip counts the series' DRAWN points (finite x and y) in row
  order over all its rows and keeps every Nth, starting with the first. A
  spline's dense line keeps its knots' order (``markevery`` already lists
  them), so the skip runs over those.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np

from quantized.heavy_import import heavy_imports

__all__ = ["apply_symbol_details"]

# matplotlib codes of the glyphs the canvas draws open (`markers.FILLED_SHAPES`
# excludes plus, cross and star).
_OPEN = ("+", "x", "*")


def _alpha(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if np.isfinite(f) and 0.0 <= f <= 1.0 else None


def _every(v: Any) -> int | None:
    if isinstance(v, bool) or not isinstance(v, int) or not 1 < v <= 100000:  # as the canvas
        return None
    return v


def _colour(v: Any) -> str | None:
    return v if isinstance(v, str) and v else None


def _skip_indices(line: Any, every: int) -> list[int]:
    """Every ``every``-th drawn point's index into the line's own data."""
    xs = np.asarray(line.get_xdata(), dtype=float)
    ys = np.asarray(line.get_ydata(), dtype=float)
    current = line.get_markevery()
    base = (
        [int(i) for i in current]
        if isinstance(current, (list, tuple, np.ndarray))
        else list(range(len(ys)))
    )
    drawn = [i for i in base if i < len(ys) and np.isfinite(xs[i]) and np.isfinite(ys[i])]
    return drawn[::every]


def apply_symbol_details(line: Any, spec: Mapping[str, Any] | None) -> None:
    """Restyle the markers of an already-drawn ``Line2D`` from ``spec``. A line
    without markers, a bad value, or no detail key at all leaves it as it is
    (an export never fails on a style hint)."""
    if not isinstance(spec, Mapping) or not hasattr(line, "get_marker"):
        return
    if line.get_marker() in (None, "", " ", "None", "none"):
        return
    edge = _colour(spec.get("marker_edge"))
    face = _colour(spec.get("marker_face"))
    alpha = _alpha(spec.get("marker_alpha"))
    every = _every(spec.get("marker_every"))
    if edge or face or alpha is not None:
        with heavy_imports("matplotlib.colors"):
            from matplotlib.colors import to_rgba
        colour = line.get_color()

        def rgba(c: str | None, a: float = 1.0) -> Any:
            try:
                return to_rgba(c or colour, a)
            except ValueError:  # a stored colour matplotlib cannot read: the line's own
                return to_rgba(colour, a)

        line.set_markeredgecolor(rgba(edge))
        # An open glyph has no fill on the canvas (plus, cross, and the star, an
        # asterisk there): leave matplotlib's face alone (gap audit 4 review L3).
        if spec.get("marker_fill") != "hollow" and line.get_marker() not in _OPEN:
            line.set_markerfacecolor(rgba(face, 1.0 if alpha is None else alpha))
    if every is not None:
        line.set_markevery(_skip_indices(line, every))
