"""Colour-mapped scatter (MAIN #14) for the publication renderer.

Split out of ``calc.figure`` purely to stay under the 500-line god-module
ceiling (mirrors ``figure_break``/``figure_y2``/``figure_overrides`` — a
self-contained draw branch pulled into its own module rather than trimmed).
Pure layer: no fastapi/pydantic imports.

P1.4's gradient Color-by (``calc.plotting_encoded.encoded_series_styles``)
draws through here too, with the screen's own colour rule:
:data:`GRADIENT_STOPS` are the screen's colormap stops and
:func:`gradient_colors` is the faithful port of ``lib/colorscatter.ts``'s
``colorScatterFill`` (``lib/colormap.ts``'s ``normalize`` + ``sampleColormap``),
so every exported point has exactly the RGB the Stage and the Graph Builder
preview paint.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_styles import FigureStyle
from quantized.heavy_import import heavy_imports

__all__ = ["GRADIENT_STOPS", "MARKER_CODES", "draw_color_scatter", "gradient_colors"]

#: The gradient Color-by's colormap stops -- a VERBATIM copy of
#: ``lib/colormap.ts``'s ``VIRIDIS`` anchor stops as hex (the same
#: copy-and-pin convention as ``calc.figure_greyscale``'s marker cycle). The
#: shared wire fixture's ``screen.stops`` is written from the frontend table and
#: ``tests/test_export_graph_encoding_gradient.py`` asserts this equals it.
GRADIENT_STOPS = (
    "#440154", "#472c7a", "#3b518b", "#2c718e", "#21908d",
    "#27ad81", "#5cc863", "#aadc32", "#fde725",
)

# 8 `MarkerShape` glyphs -> matplotlib codes; wire key `marker_shape` (sent by
# `lib/exportStyles`; was hardcoded "o", so every shape exported as a circle).
MARKER_CODES = {"circle": "o", "square": "s", "triangle": "^", "downtriangle": "v",
                "diamond": "D", "plus": "+", "cross": "x", "star": "*"}


def _js_round(v: float) -> int:
    """JavaScript's ``Math.round`` for a non-negative value (half rounds up;
    Python's ``round`` would round half to even)."""
    r = math.floor(v)
    return r + 1 if v - r >= 0.5 else r


def _sample(stops: Sequence[tuple[int, int, int]], t: float) -> tuple[int, int, int]:
    """``lib/colormap.ts``'s ``sampleColormap``: clamp, then linear between
    the two stops around ``t``, each channel rounded like ``Math.round``."""
    x = 0.0 if t <= 0 else 1.0 if t >= 1 else t
    span = len(stops) - 1
    pos = x * span
    i = min(span - 1, math.floor(pos))
    f = pos - i
    a, b = stops[i], stops[i + 1]
    r, g, bl = (_js_round(a[c] + (b[c] - a[c]) * f) for c in range(3))
    return r, g, bl


def gradient_colors(
    z: NDArray[np.float64], lo: float, hi: float, stops_hex: Sequence[str]
) -> list[str | None]:
    """Each value's hex fill: normalized linearly over ``[lo, hi]`` (a
    degenerate range reads 0), sampled from ``stops_hex``; ``None`` for a
    non-finite value (the point is not drawn) -- ``colorScatterFill``."""
    stops = [(int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16)) for s in stops_hex]
    out: list[str | None] = []
    for v in z:
        fv = float(v)
        if not math.isfinite(fv):
            out.append(None)
            continue
        t = 0.0 if hi <= lo else (fv - lo) / (hi - lo)
        out.append("#{:02x}{:02x}{:02x}".format(*_sample(stops, t)))
    return out


def _draw_gradient(
    fig: Any,
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    z: NDArray[np.float64],
    label: str,
    spec: Mapping[str, Any],
    size: float,
) -> Any:
    """The P1.4 gradient branch: explicit per-point fills, the series' glyph,
    and (for the first series only, ``colorbar``) one colourbar over the sent
    range from the sent stops."""
    stops = [str(s) for s in spec["color_stops"]]
    lo, hi = (float(v) for v in spec["color_lim"])
    fills = gradient_colors(z, lo, hi, stops)
    keep = np.isfinite(xv) & np.isfinite(yv) & np.array([f is not None for f in fills], dtype=bool)
    shape = spec.get("marker_shape") if spec.get("marker") else None
    marker = MARKER_CODES.get(shape, "o") if isinstance(shape, str) else "o"
    colors = [f for f, k in zip(fills, keep, strict=True) if k]
    sc = ax.scatter(xv[keep], yv[keep], c=colors, marker=marker, s=size, label=label)
    if spec.get("colorbar", True):
        with heavy_imports("matplotlib.cm", "matplotlib.colors"):
            from matplotlib.cm import ScalarMappable
            from matplotlib.colors import LinearSegmentedColormap, Normalize
        mappable = ScalarMappable(
            norm=Normalize(vmin=lo, vmax=hi if hi > lo else lo + 1.0),
            cmap=LinearSegmentedColormap.from_list("qz_gradient", stops),
        )
        fig.colorbar(mappable, ax=ax, label=str(spec.get("colorbar_label") or ""))
    return sc


def draw_color_scatter(
    fig: Any,
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    label: str,
    spec: Mapping[str, Any],
    st: FigureStyle,
) -> Any:
    """Colour-mapped scatter: each point coloured by a THIRD channel's value
    -- ``spec["color_by"]``, already resolved by
    ``calc.plotting.resolve_style_channels`` to a concrete per-row array
    (this module never sees a raw channel index). Replaces the normal line
    draw entirely for this series -- screen-side parity: ``uplotOpts.ts``
    hides the native line/points the same way whenever a series' ``colorBy``
    is set. Adds a colourbar so the mapping is legible. Returns the
    ``PathCollection`` artist (for the figure-hitmap element collector).

    With ``color_stops`` + ``color_lim`` (P1.4's gradient Color-by) the
    screen's colour rule is applied point by point instead of matplotlib's
    colormap -- see the module doc.

    Deliberately left OUT of P3.3's greyscale export mode
    (``calc.figure_greyscale.apply_greyscale`` passes a ``color_by`` spec
    through unchanged): a colour-mapped scatter's colour IS the plotted
    quantity, not a categorical series-to-series distinction, so forcing it
    to grey would delete information rather than make the figure print-safe.
    """
    z = np.asarray(spec["color_by"], dtype=float)
    n = min(len(xv), len(yv), len(z))
    size = float(spec.get("marker_size") or st.marker_size) ** 2
    if spec.get("color_stops") and spec.get("color_lim"):
        return _draw_gradient(fig, ax, xv[:n], yv[:n], z[:n], label, spec, size)
    sc = ax.scatter(
        xv[:n], yv[:n], c=z[:n], cmap=str(spec.get("colormap") or "viridis"), s=size, label=label
    )
    fig.colorbar(sc, ax=ax)
    return sc
