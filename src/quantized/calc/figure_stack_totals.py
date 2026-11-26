"""Total labels on a stack (plan item 24, Origin's Layer > Stack "show total").

The export half of ``frontend/src/lib/uplotStackTotals.ts``. A series flagged
``stack_total`` that is also ``stack`` labels the running total at its top edge
-- the stack's sum up to and including it -- at every row where it has a value,
above the edge for a positive total and below it for a negative one. Put it on
the TOP series of a stack to total the stack. By the time a series is drawn
:func:`quantized.calc.figure_bars.stacked_series` has made its y the new total,
so the label is read straight off it.

Rules shared with the canvas: the label is the total to 6 significant figures
with trailing zeros dropped; 9 pt text, centred, 3 pt clear of the edge. A
horizontal-bar plot draws none, and says so.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_warnings import note_figure_warning

__all__ = ["STACK_TOTAL_GAP_PT", "STACK_TOTAL_PT", "draw_stack_totals", "stack_total_label"]

STACK_TOTAL_PT = 9.0
STACK_TOTAL_GAP_PT = 3.0


def stack_total_label(v: float) -> str:
    """``String(Number(v.toPrecision(6)))`` of the canvas, for ordinary magnitudes."""
    rounded = float(f"{v:.6g}")
    text = np.format_float_positional(rounded, trim="-")
    return "0" if text in ("-0", "") else text


def draw_stack_totals(
    ax: Any, xv: NDArray[np.float64], yv: NDArray[np.float64], spec: Mapping[str, Any] | None
) -> None:
    """Label ``spec``'s stack totals (``yv`` is already the new total)."""
    if not spec or spec.get("stack_total") is not True or not spec.get("stack"):
        return
    if spec.get("bars") == "horizontal":
        note_figure_warning("Stack total labels are not drawn on horizontal bar plots.")
        return
    for x, total in zip(xv, yv, strict=True):
        if not (np.isfinite(x) and np.isfinite(total)):
            continue
        below = bool(total < 0)
        ax.annotate(
            stack_total_label(float(total)), (x, total),
            xytext=(0, -STACK_TOTAL_GAP_PT if below else STACK_TOTAL_GAP_PT),
            textcoords="offset points",
            ha="center", va="top" if below else "bottom", fontsize=STACK_TOTAL_PT,
            annotation_clip=True, gid="stack-total",
        )
