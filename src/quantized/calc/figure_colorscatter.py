"""Colour-mapped scatter (MAIN #14) for the publication renderer.

Split out of ``calc.figure`` purely to stay under the 500-line god-module
ceiling (mirrors ``figure_break``/``figure_y2``/``figure_overrides`` — a
self-contained draw branch pulled into its own module rather than trimmed).
Pure layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_styles import FigureStyle

__all__ = ["draw_color_scatter"]


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

    Deliberately left OUT of P3.3's greyscale export mode
    (``calc.figure_greyscale.apply_greyscale`` passes a ``color_by`` spec
    through unchanged): a colour-mapped scatter's colour IS the plotted
    quantity, not a categorical series-to-series distinction, so forcing it
    to grey would delete information rather than make the figure print-safe.
    """
    z = np.asarray(spec["color_by"], dtype=float)
    n = min(len(xv), len(yv), len(z))
    size = float(spec.get("marker_size") or st.marker_size) ** 2
    sc = ax.scatter(
        xv[:n], yv[:n], c=z[:n], cmap=str(spec.get("colormap") or "viridis"), s=size, label=label
    )
    fig.colorbar(sc, ax=ax)
    return sc
