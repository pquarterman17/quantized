"""``.opju`` curve plot kinds quantized can draw beyond line / scatter / bars.

Read from the curve record ``curve_style_color.opju_style_record``
reconstructs (the ``.opj`` curve-anchor layout; offsets in
``opju_plot_gates``). Each sets ``curve["plotType"]``; the frontend maps it
to a series style (``lib/originCurveText.ts::originCurveSeriesStyle``).

* **Area** -- byte 76 ``0xcc`` = Origin plot 204 (``worksheet -p 204 Area``;
  ``DataPlot::GetPlotType()`` reads 204). Origin fills each curve down to
  Y = 0, not to the axis (``area/negative``: fill crosses the X axis at 0),
  which is quantized's ``fill: "under"``.
* **Step** -- byte 76 ``0xc8`` (a line plot) with byte 17 = 11
  (``layer.plotN.line.connect = 7``, "step horizontal": hold Y to the next
  X, then jump), which is quantized's ``step: "post"``. The straight-line
  style stays withheld (``opju_plot_gates.withhold_step_style``).

Evidence (Origin 2026b Student COM, ``tools/plot_corpus``, 2026-11-15): every
area specimen's curve record (30 / 30) carries ``0xcc`` and every step
specimen's (27 / 27, plus one error-bar token) byte 17 = 11; no other
specimen type carries either. Real corpus (359 ``.opju``): 0 of the ~10,300
decoded curve records carry ``0xcc`` or byte 17 = 11, so no real file
changes. Stacked area (``0xd6`` = 214) and offset lines are NOT mapped:
quantized cannot draw them yet, so they stay the default line view.
"""

from __future__ import annotations

from collections.abc import MutableMapping

from quantized.io.origin_project.opju_plot_gates import (
    CONNECT_OFF,
    PLOT_TYPE_OFF,
    STEP_HORIZONTAL,
    withhold_step_style,
)

__all__ = ["AREA_PLOT", "LINE_PLOT", "apply_plot_kind"]

AREA_PLOT = 0xCC  # Origin plot 204
LINE_PLOT = 0xC8  # Origin plot 200


def apply_plot_kind(curve: MutableMapping[str, str | float], record: bytes | None) -> None:
    """Set ``curve["plotType"]`` to ``"area"`` / ``"step"`` when ``record``
    proves it (see the module docstring); leave the curve as it is otherwise."""
    withhold_step_style(curve, record)
    if record is None or len(record) <= PLOT_TYPE_OFF:
        return
    kind = record[PLOT_TYPE_OFF]
    if kind == AREA_PLOT:
        curve["plotType"] = "area"
    elif kind == LINE_PLOT and record[CONNECT_OFF] == STEP_HORIZONTAL:
        curve["plotType"] = "step"
