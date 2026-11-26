"""Heatmap cell labels in the vector export: each cell's value printed on it,
in the ink that reads against the cell's colour, skipped where the cell is too
small to hold the text. The cells are the MEASURED ones (``spec["native"]``)
whenever the caller sends them, else the grid being drawn. The map canvas (``mapRender`` + ``mapCellLabels.ts``)
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
    native_cell_spots,
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
    native = spec.get("native")
    if native is not None:
        nx, ny = len(native["x_axis"]), len(native["y_axis"])
        values = native["values"]
        if len(values) != ny or any(len(row) != nx for row in values):
            raise ValueError("native cell values must be (len(y_axis), len(x_axis))")


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
    if spec.get("native") is not None:
        _draw_native(fig, ax, mappable, spec, font_size=font_size, log10=log10)
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


def _draw_native(
    fig: Any, ax: Any, mappable: Any, spec: Mapping[str, Any], *, font_size: float, log10: bool
) -> None:
    """Label the MEASURED cells (``spec["native"]``: a ``(ny, nx)`` lattice of raw
    values over ``x_axis`` / ``y_axis``) however fine the displayed grid is: one
    label per cell, at the centre of the part of it the frame shows, in the ink
    that reads against its colour (``calc.cell_labels.native_cell_spots``)."""
    native = spec["native"]
    fig.canvas.draw()
    box = ax.get_window_extent()
    pt = 72.0 / fig.dpi
    xlim, ylim = ax.get_xlim(), ax.get_ylim()
    values = [
        [None if v is None else float(v) for v in row] for row in native["values"]
    ]
    spots = native_cell_spots(
        native["x_axis"], native["y_axis"], values, (*xlim, *ylim),
        (box.width * pt, box.height * pt),
        str(spec.get("format", "general")), int(spec.get("precision", DEFAULT_PRECISION)),
        font_size,
    )
    cmap, norm = mappable.get_cmap(), mappable.norm
    for s in spots:
        raw = values[s["j"]][s["i"]]
        if raw is None or (log10 and raw <= 0):
            continue  # a non-positive cell is a gap under a log scale, as the canvas draws it
        r, g, b, _ = cmap(norm(np.log10(raw) if log10 else raw))
        ax.text(
            s["x"], s["y"], s["text"], ha="center", va="center", fontsize=font_size,
            color=contrast_text_color(r * 255, g * 255, b * 255), clip_on=True,
        )
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
