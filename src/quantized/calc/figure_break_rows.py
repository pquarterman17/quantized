"""Row states (G24, "Use row states") on the panels of an x-break figure.

The flat export draws a row-states series as its line plus one scatter point per
row in the row's own colour and glyph (``calc.figure_row_states``). A break
figure is the same flat request with ``x_breaks``: the per-row arrays on the
series style are aligned to the request's rows, so a panel draws the slice of
them its ``shown`` mask selects -- the rows whose x lies in that panel. The
canvas maps each panel's rows to the sheet rows the same way
(``lib/panelSheetRows.ts`` -> ``Stage/useBreakRowStates``), so a row carries one
colour and one glyph on screen and on paper.

Pure layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_row_states import draw_row_points, row_states

__all__ = ["RowStates", "draw_panel_row_points", "panel_row_states", "plain_kwargs"]

RowStates = tuple[list[str | None] | None, list[str | None] | None]


def panel_row_states(spec: Mapping[str, Any] | None, rows: int) -> RowStates | None:
    """The usable row states of a series over the request's ``rows`` rows, or None.

    A colour-by or size-by series is drawn plain in a break panel (neither is drawn there, on
    screen or on paper), so it takes no row states here either."""
    if spec and (spec.get("color_by") is not None or spec.get("size_by") is not None):
        return None
    return row_states(spec, rows)


def plain_kwargs(kw: dict[str, Any]) -> float | None:
    """Drop the line's own markers from ``kw`` (the row points replace them, as on the
    flat plot) and return the marker size they carried, if any."""
    size = kw.get("markersize")
    for key in ("marker", "markersize", "markerfacecolor"):
        kw.pop(key, None)
    return None if size is None else float(size)


def draw_panel_row_points(
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    spec: Mapping[str, Any],
    color: Any,
    states: RowStates,
    shown: NDArray[np.bool_],
    size_pt: float | None,
) -> None:
    """Draw the panel's rows (``xv``/``yv`` are already cut by ``shown``) in their states."""

    def cut(cells: list[str | None] | None) -> list[str | None] | None:
        return None if cells is None else [c for c, keep in zip(cells, shown, strict=True) if keep]

    colors, markers = states
    draw_row_points(ax, xv, yv, spec, color, (cut(colors), cut(markers)), size_pt)
