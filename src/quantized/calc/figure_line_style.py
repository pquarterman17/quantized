"""Line polish for the publication renderer (plan item 17): a gap between the
line and each symbol, the line drawn in front of (or behind) its symbols, and
the double (compound) line.

The export half of the canvas' ``lib/uplotLineStyle.ts``; the geometry below is
a line-for-line twin of ``lib/lineStyleGeometry.ts`` and both are pinned to the
same cases in ``tests/fixtures/wire/line_style.json``. Wire keys (series style):

* ``symbol_gap`` -- points, 0 < gap <= 50: the line stops ``radius + gap`` short
  of every point that carries a symbol (a symbol skipped by ``marker_every``
  leaves none). A segment too short to keep any line is not drawn.
* ``line_front`` -- ``true`` draws the line over the symbols. Absent = under,
  matplotlib's own order.
* ``double_line`` -- points, 0 < sep <= 50: every piece of the line is two
  parallel strokes ``sep`` apart (mitred at the vertices, limit 4).

They apply to a plain line only: not bars, stacks, steps, a spline or a size /
colour map (``lib/lineStyleSanitize.lineStyleApplies``); a series with no
symbols has nothing to gap around. Display-only: data and analysis never change.

The line is redrawn at DRAW time (the display transform is only final then):
the artist's ``draw`` is wrapped so the symbols and the strokes are drawn
separately, in the requested order. Legend handles are copied from the
artist's properties, so the legend still shows an ordinary line.

Pure layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.heavy_import import heavy_imports

__all__ = [
    "MAX_LINE_STYLE_PT",
    "MITRE_LIMIT",
    "applies",
    "apply_line_style",
    "gapped_pieces",
    "line_strokes",
    "offset_piece",
    "options",
    "stroke_polylines",
]

#: Longest mitre, as a multiple of the half separation (``lib/lineStyleGeometry.MITRE_LIMIT``).
MITRE_LIMIT = 4.0
#: Largest gap / separation (points) -- ``lib/lineStyleSanitize.MAX_LINE_STYLE_PT``.
MAX_LINE_STYLE_PT = 50.0

Pt = tuple[float, float]
Coords = Sequence[float] | NDArray[np.float64]
_NO_MARKER = (None, "", " ", "None", "none")


def _length(v: Any) -> float:
    """A valid gap / separation in points, else 0 (as the canvas' ``validLength``)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0.0
    f = float(v)
    return f if math.isfinite(f) and 0.0 < f <= MAX_LINE_STYLE_PT else 0.0


def applies(spec: Mapping[str, Any]) -> bool:
    """Does the line polish apply to this series (``lineStyleApplies``)?"""
    return not (
        spec.get("bars")
        or spec.get("stack")
        or spec.get("step")
        or spec.get("connect")
        or spec.get("size_by") is not None
        or spec.get("color_by") is not None
    )


def options(spec: Mapping[str, Any] | None) -> tuple[float, float, bool] | None:
    """``(gap, sep, front)`` in points, or None when the style sets none / does not apply."""
    if not isinstance(spec, Mapping) or not applies(spec):
        return None
    gap = _length(spec.get("symbol_gap"))
    sep = _length(spec.get("double_line"))
    front = spec.get("line_front") is True
    return (gap, sep, front) if gap or sep or front else None


def gapped_pieces(
    xs: Coords, ys: Coords, marked: Callable[[int], bool], radius: float, gap: float
) -> list[list[Pt]]:
    """The pieces of the line after the symbol gap (``lineStyleGeometry.gappedPieces``)."""
    n = min(len(xs), len(ys))
    out: list[list[Pt]] = []
    cur: list[Pt] = []

    def flush() -> None:
        nonlocal cur
        if len(cur) >= 2:
            out.append(cur)
        cur = []

    def ok(i: int) -> bool:
        return math.isfinite(xs[i]) and math.isfinite(ys[i])

    trim = radius + gap
    for i in range(n - 1):
        if not (ok(i) and ok(i + 1)):
            flush()
            continue
        dx = float(xs[i + 1]) - float(xs[i])
        dy = float(ys[i + 1]) - float(ys[i])
        length = math.hypot(dx, dy)
        if length == 0:
            continue  # a repeated point: no segment, the line carries on
        ts = trim if gap > 0 and marked(i) else 0.0
        te = trim if gap > 0 and marked(i + 1) else 0.0
        if ts + te >= length:
            flush()
            continue
        ux, uy = dx / length, dy / length
        if ts > 0:
            flush()
            cur = [(float(xs[i]) + ux * ts, float(ys[i]) + uy * ts)]
        elif not cur:
            cur = [(float(xs[i]), float(ys[i]))]
        cur.append((float(xs[i + 1]) - ux * te, float(ys[i + 1]) - uy * te))
        if te > 0:
            flush()
    flush()
    return out


def offset_piece(piece: Sequence[Pt], h: float) -> list[Pt]:
    """A parallel copy of ``piece``, ``h`` to the left of its direction (negative: right)."""
    m = len(piece)
    nx: list[float] = []
    ny: list[float] = []
    for k in range(m - 1):
        dx = piece[k + 1][0] - piece[k][0]
        dy = piece[k + 1][1] - piece[k][1]
        length = math.hypot(dx, dy)
        nx.append(-dy / length)
        ny.append(dx / length)
    out: list[Pt] = []
    for k, (x, y) in enumerate(piece):
        if k == 0:
            out.append((x + nx[0] * h, y + ny[0] * h))
        elif k == m - 1:
            out.append((x + nx[k - 1] * h, y + ny[k - 1] * h))
        else:
            sx, sy = nx[k - 1] + nx[k], ny[k - 1] + ny[k]
            sl = math.hypot(sx, sy)
            if sl < 1e-12:  # a full reversal: no mitre exists
                out.append((x + nx[k] * h, y + ny[k] * h))
                continue
            mx, my = sx / sl, sy / sl
            scale = min(1.0 / (mx * nx[k] + my * ny[k]), MITRE_LIMIT)
            out.append((x + mx * scale * h, y + my * scale * h))
    return out


def line_strokes(
    xs: Coords, ys: Coords, marked: Callable[[int], bool], radius: float, gap: float, sep: float
) -> list[list[Pt]]:
    """The strokes: the gapped pieces, each doubled when ``sep`` > 0 (left, then right copy)."""
    pieces = gapped_pieces(xs, ys, marked, radius, gap)
    if not sep > 0:
        return pieces
    return [c for p in pieces for c in (offset_piece(p, sep / 2), offset_piece(p, -sep / 2))]


def _marked(line: Any) -> Callable[[int], bool]:
    """The rows of ``line`` that carry a symbol: its ``markevery`` rows, else every one."""
    if line.get_marker() in _NO_MARKER:
        return lambda _i: False
    every = line.get_markevery()
    if isinstance(every, (list, np.ndarray)):
        rows = {int(i) for i in every}
        return lambda i: i in rows
    return lambda _i: True


def stroke_polylines(line: Any, px_per_pt: float, gap: float, sep: float) -> list[list[Pt]]:
    """The strokes of a ``Line2D`` in display pixels (its data through its current
    transform); ``gap`` and ``sep`` in points."""
    xy = np.asarray(line.get_xydata(), dtype=float)
    if xy.size == 0:
        return []
    disp = np.asarray(line.get_transform().transform(xy), dtype=float)
    radius = (
        0.0 if line.get_marker() in _NO_MARKER else float(line.get_markersize()) / 2 * px_per_pt
    )
    return line_strokes(
        disp[:, 0], disp[:, 1], _marked(line), radius, gap * px_per_pt, sep * px_per_pt
    )


def _stroke_artist(line: Any, strokes: list[list[Pt]]) -> Any:
    """A ``Line2D`` in display coordinates carrying ``line``'s every property (colour, width,
    dashes, alpha, clip, path effects): one NaN-separated polyline for all the strokes."""
    with heavy_imports("matplotlib.lines", "matplotlib.transforms"):
        from matplotlib.lines import Line2D
        from matplotlib.transforms import IdentityTransform
    xs: list[float] = []
    ys: list[float] = []
    for piece in strokes:
        if xs:
            xs.append(math.nan)
            ys.append(math.nan)
        xs.extend(p[0] for p in piece)
        ys.extend(p[1] for p in piece)
    clone = Line2D(xs, ys)
    clone.update_from(line)
    clone.set_marker("None")
    clone.set_transform(IdentityTransform())
    clone.axes = line.axes
    clone.set_figure(line.figure)
    return clone


def _draw_symbols(line: Any, original: Callable[[Any], None], renderer: Any) -> None:
    """The line's own draw with its connecting stroke switched off (symbols only)."""
    saved = line.get_linestyle()
    line.set_linestyle("None")
    try:
        original(renderer)
    finally:
        line.set_linestyle(saved)


def _draw_strokes(line: Any, gap: float, sep: float, renderer: Any) -> None:
    strokes = stroke_polylines(line, float(renderer.points_to_pixels(1.0)), gap, sep)
    if strokes:
        _stroke_artist(line, strokes).draw(renderer)


def apply_line_style(line: Any, spec: Mapping[str, Any] | None) -> None:
    """Give an already-drawn ``Line2D`` the style's line polish (see the module doc). A style
    with none, a series it does not apply to, or a line that draws no stroke is left alone."""
    opts = options(spec)
    if opts is None or not hasattr(line, "draw") or not hasattr(line, "get_markevery"):
        return
    if line.get_linestyle() in ("None", "none", "", " ") or not line.get_linewidth() > 0:
        return
    gap, sep, front = opts
    original = line.draw

    def draw(renderer: Any) -> None:
        if not line.get_visible():
            return
        if front:
            _draw_symbols(line, original, renderer)
            _draw_strokes(line, gap, sep, renderer)
        else:
            _draw_strokes(line, gap, sep, renderer)
            _draw_symbols(line, original, renderer)

    line.draw = draw
