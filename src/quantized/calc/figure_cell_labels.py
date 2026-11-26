"""Heatmap cell labels in the vector export: each cell's value printed on it,
in the ink that reads against the cell's colour, skipped where the cell is too
small to hold the text. The map canvas (``mapRender`` + ``mapCellLabels.ts``)
applies the same rules from ``calc.cell_labels``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.cell_labels import (
    CELL_FORMATS,
    DEFAULT_PRECISION,
    cell_label_fits,
    contrast_text_color,
    format_cell_value,
)

__all__ = ["check_cell_labels", "draw_cell_labels"]

_LABELLED_KINDS = ("heatmap", "contourf")


def check_cell_labels(spec: Mapping[str, Any] | None) -> None:
    """Raise ``ValueError`` on an unknown format or a non-integer precision."""
    if spec is None:
        return
    if spec.get("format", "general") not in CELL_FORMATS:
        raise ValueError(f"cell label format must be one of {CELL_FORMATS}")
    precision = spec.get("precision", DEFAULT_PRECISION)
    if isinstance(precision, bool) or not isinstance(precision, int) or precision < 0:
        raise ValueError("cell label precision must be a non-negative integer")


def draw_cell_labels(
    fig: Any,
    ax: Any,
    mappable: Any,
    kind: str,
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    z: NDArray[np.float64],
    spec: Mapping[str, Any] | None,
    *,
    font_size: float,
    log10: bool,
) -> None:
    """Label every cell of the ``(ny, nx)`` grid ``z`` (over ``x``/``y``).

    ``spec["values"]``, when present, is the grid to print (the raw values:
    ``z`` is clamped by colour limits and log10-ed under a log scale, neither
    of which the label should show); otherwise ``z`` is printed, un-logged
    under ``log10``. Call after the layout is final: the cell size is measured
    from the drawn axes."""
    if not spec or kind not in _LABELLED_KINDS or mappable is None or z.ndim != 2:
        return
    values = spec.get("values")
    shown = (
        np.asarray(values, dtype=float)
        if values is not None
        else (np.power(10.0, z) if log10 else z)
    )
    if shown.shape != z.shape:
        raise ValueError("cell label values must match the grid shape")
    fmt = str(spec.get("format", "general"))
    precision = int(spec.get("precision", DEFAULT_PRECISION))
    fig.canvas.draw()
    box = ax.get_window_extent()
    pt = 72.0 / fig.dpi
    cell_w = box.width * pt / max(1, x.size - 1)
    cell_h = box.height * pt / max(1, y.size - 1)
    xlim, ylim = ax.get_xlim(), ax.get_ylim()
    cmap, norm = mappable.get_cmap(), mappable.norm
    for j in range(y.size):
        for i in range(x.size):
            zv, sv = z[j, i], shown[j, i]
            if not (np.isfinite(zv) and np.isfinite(sv)):
                continue
            text = format_cell_value(float(sv), fmt, precision)
            if not cell_label_fits(cell_w, cell_h, text, font_size):
                continue
            r, g, b, _ = cmap(norm(zv))
            ax.text(
                x[i], y[j], text, ha="center", va="center", fontsize=font_size,
                color=contrast_text_color(r * 255, g * 255, b * 255), clip_on=True,
            )
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
