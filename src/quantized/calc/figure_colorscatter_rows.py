"""Row states on a colour-by series (G24 "Use row states", the export half).

A colour-mapped scatter (``color_by``, optionally ``size_by``) whose series asks for row
states keeps its colour scale and its colourbar. A row that HAS a state takes that colour
and/or glyph instead; every other row keeps the scale's colour and the series' glyph. The
canvas does the same (``ColorScatterSpec.fills`` / ``shapes`` over ``z``: ``colorScatterFill``
lets a row's own colour win), so screen and export agree row by row
(``tests/fixtures/wire/row_states_colorby.json``). A row with a state is drawn even where its
z is not finite; a row with neither a state nor a finite z is not drawn, as on screen. A
size-by series keeps each point's own diameter and leaves out a row with no finite size.

Called from :func:`quantized.calc.figure_colorscatter.draw_color_scatter` (imported lazily
there: this module needs that one's gradient rule and glyph table).
Pure layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_bubble_pad import tag_bubbles
from quantized.calc.figure_colorscatter import MARKER_CODES, _hollow, gradient_colors
from quantized.heavy_import import heavy_imports

__all__ = ["draw_row_state_scatter"]

RowStates = tuple[list[str | None] | None, list[str | None] | None]


def _scale_fills(
    z: NDArray[np.float64], spec: Mapping[str, Any], gradient: bool
) -> tuple[list[str | None], Any]:
    """The scale's own fill per row (``None`` = no finite z) and the colourbar's mappable."""
    with heavy_imports("matplotlib", "matplotlib.cm", "matplotlib.colors"):
        import matplotlib
        from matplotlib.cm import ScalarMappable
        from matplotlib.colors import LinearSegmentedColormap, Normalize, to_hex
    if gradient:
        stops = [str(s) for s in spec["color_stops"]]
        lo, hi = (float(v) for v in spec["color_lim"])
        mappable = ScalarMappable(
            norm=Normalize(vmin=lo, vmax=hi if hi > lo else lo + 1.0),
            cmap=LinearSegmentedColormap.from_list("qz_gradient", stops),
        )
        return gradient_colors(z, lo, hi, stops), mappable
    finite = z[np.isfinite(z)]
    lo, hi = (float(finite.min()), float(finite.max())) if finite.size else (0.0, 1.0)
    norm = Normalize(vmin=lo, vmax=hi if hi > lo else lo + 1.0)
    cmap = matplotlib.colormaps[str(spec.get("colormap") or "viridis")]
    fills = [to_hex(cmap(norm(v))) if np.isfinite(v) else None for v in z]
    return fills, ScalarMappable(norm=norm, cmap=cmap)


def draw_row_state_scatter(
    fig: Any,
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    z: NDArray[np.float64],
    label: str,
    spec: Mapping[str, Any],
    size: float | NDArray[np.float64],
    states: RowStates,
    diam: NDArray[np.float64] | None,
) -> Any:
    """Draw the colour-by series point by point, one scatter per glyph. The first collection
    is returned (the series' artist for the hitmap)."""
    colors, markers = states
    gradient = bool(spec.get("color_stops") and spec.get("color_lim"))
    base, mappable = _scale_fills(z, spec, gradient)
    default = spec.get("marker_shape") if gradient and spec.get("marker") else None
    default_code = MARKER_CODES.get(default, "o") if isinstance(default, str) else "o"
    fills = [(colors[i] if colors and i < len(colors) else None) or base[i] for i in range(len(z))]
    has_fill = np.array([f is not None for f in fills], dtype=bool)
    keep = np.isfinite(xv) & np.isfinite(yv) & has_fill
    if diam is not None:
        keep &= np.isfinite(diam)
    groups: dict[str, list[int]] = {}
    for i in np.flatnonzero(keep):
        m = markers[i] if markers and i < len(markers) else None
        groups.setdefault(MARKER_CODES[m] if m else default_code, []).append(int(i))
    first: Any = None
    for code, idx in groups.items():
        s_pt = size[idx] if isinstance(size, np.ndarray) else size
        sc = ax.scatter(
            xv[idx], yv[idx], c=[fills[i] for i in idx], marker=code, s=s_pt, zorder=3,
            label=label if first is None else None,
        )
        if diam is not None:
            tag_bubbles(sc, diam[idx])
        first = first if first is not None else sc
        _hollow(sc, spec)
    if first is None:  # nothing drawable: an empty artist keeps the legend entry and hitmap
        first = ax.scatter([], [], label=label)
    if not gradient or spec.get("colorbar", True):
        text = str(spec.get("colorbar_label") or "") if gradient else ""
        fig.colorbar(mappable, ax=ax, label=text)
    return first
