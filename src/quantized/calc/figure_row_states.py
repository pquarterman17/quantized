"""Row states for the publication renderer (G24, "Use row states").

A series style may carry ``row_colors`` and ``row_markers``: one entry per row
of the series (``#rrggbb`` / a ``MarkerShape`` name, ``None`` = no state), built
by the frontend from ``Dataset.rowStyle`` (``lib/rowStyleExport.ts``) and
aligned to the rows the request carries (a flat export prunes the dataset's
dropped rows, the arrays are pruned the same way). The canvas paints the same
hexes (``ColorScatterSpec.fills``, ``lib/rowStyleSpecs.ts``): colours are
resolved ONCE on the client, never re-derived here, so the two cannot disagree.

The series' own line (if any) is drawn as usual with its markers off, then
every finite row is drawn on top as a point: its row colour or, with none, the
series colour; its row marker or, with none, the series' glyph (a circle by
default). Fails closed like every style hint: an array whose length is not the
row count, or an entry that is not a known colour / shape, is ignored (the
series then draws as if it had no row states) and never raises.

Greyscale export drops ``row_colors`` (``calc.figure_greyscale``): print-safe
mode greys the series, and the markers still tell rows apart.
Pure layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_colorscatter import MARKER_CODES

__all__ = ["draw_row_points", "row_states"]

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_DEFAULT_SIZE_PT = 4.0


def _cells(raw: Any, n: int, ok: Any) -> list[str | None] | None:
    """``raw`` as ``n`` validated cells (an unknown entry -> ``None``), or ``None``
    when it is not a list of exactly ``n`` entries or holds no usable cell."""
    if not isinstance(raw, Sequence) or isinstance(raw, str) or len(raw) != n:
        return None
    out = [c if isinstance(c, str) and ok(c) else None for c in raw]
    return out if any(c is not None for c in out) else None


def row_states(
    spec: Mapping[str, Any] | None, n: int
) -> tuple[list[str | None] | None, list[str | None] | None] | None:
    """``(colors, markers)`` for a series of ``n`` rows, or ``None`` when it has
    no usable row state."""
    if not spec:
        return None
    colors = _cells(spec.get("row_colors"), n, lambda c: bool(_HEX.match(c)))
    markers = _cells(spec.get("row_markers"), n, lambda c: c in MARKER_CODES)
    return (colors, markers) if colors or markers else None


def draw_row_points(
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    spec: Mapping[str, Any],
    color: Any,
    states: tuple[list[str | None] | None, list[str | None] | None],
    size_pt: float | None = None,
) -> None:
    """Draw each finite row as a point in its row state, one scatter per glyph
    (matplotlib takes one marker per call)."""
    colors, markers = states
    default = spec.get("marker_shape")
    default_code = MARKER_CODES.get(default, "o") if isinstance(default, str) else "o"
    pt = float(size_pt or spec.get("marker_size") or _DEFAULT_SIZE_PT)
    hollow = spec.get("marker_fill") == "hollow"
    keep = np.isfinite(xv) & np.isfinite(yv)
    groups: dict[str, list[int]] = {}
    for i in np.flatnonzero(keep):
        m = markers[i] if markers else None
        groups.setdefault(MARKER_CODES[m] if m else default_code, []).append(int(i))
    for code, idx in groups.items():
        fills = [(colors[i] if colors else None) or color for i in idx]
        face = {"facecolors": "none", "edgecolors": fills} if hollow else {"c": fills}
        ax.scatter(xv[idx], yv[idx], s=pt**2, marker=code, zorder=3, **face)
