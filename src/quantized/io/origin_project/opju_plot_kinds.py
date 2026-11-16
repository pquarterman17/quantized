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

* **Column** -- byte 76 ``0xcb`` = Origin plot 203: ``"column"`` (bars from
  zero at each X); a layer keeps it only for its ONLY column series
  (``opju_stat_plots``).
* **Box / histogram with no X column** -- byte 76 206 (box, violin, strip)
  or 219 (histogram) with record X id 0 (``x_not_a_column``): the curve is
  kept from its Y alone (``x == ""``) with ``"box"`` / ``"histogram"``
  (``rowless_kind``); ``opju_stat_plots`` resolves the box kind per page. A
  206 / 219 curve that is not row-less is omitted (``stat_x_reason``).

Byte 76 equals ``DataPlot::GetPlotType()`` on every plot of the 231 built
plot-corpus specimens (2026-11-15); real-corpus COM evidence for the column
and row-less curves is in ``opju_stat_plots``.
"""

from __future__ import annotations

from collections.abc import MutableMapping

from quantized.io.origin_project.opju_plot_gates import (
    CONNECT_OFF,
    PLOT_TYPE_OFF,
    STEP_HORIZONTAL,
    withhold_step_style,
)

__all__ = [
    "AREA_PLOT",
    "COLUMN_PLOT",
    "LINE_PLOT",
    "X_NOT_A_COLUMN",
    "apply_plot_kind",
    "mark_rowless",
    "rowless_kind",
    "stat_x_reason",
]

AREA_PLOT = 0xCC  # Origin plot 204
LINE_PLOT = 0xC8  # Origin plot 200
X_NOT_A_COLUMN = "x_not_a_column"  # opju_curve_token_x: the record X id is 0
# Plot types Origin draws with no X column (box family 206, histogram 219):
# kept from their Y alone, see ``opju_stat_plots``.
_ROWLESS = {206: "box", 219: "histogram"}
COLUMN_PLOT = 203  # Origin's vertical column plot (plotType "column")


def apply_plot_kind(
    curve: MutableMapping[str, str | float], record: bytes | None, rowless: str | None = None
) -> None:
    """Set ``curve["plotType"]`` to ``"area"`` / ``"step"`` / ``"column"``
    when ``record`` proves it, or re-bind a row-less curve (``rowless``, from
    `rowless_kind`) to no X (see the module docstring); leave the curve as it
    is otherwise."""
    withhold_step_style(curve, record)
    if rowless:
        mark_rowless(curve, rowless)
        return
    if record is None or len(record) <= PLOT_TYPE_OFF:
        return
    kind = record[PLOT_TYPE_OFF]
    if kind == COLUMN_PLOT:
        curve["plotType"] = "column"
    elif kind == AREA_PLOT:
        curve["plotType"] = "area"
    elif kind == LINE_PLOT and record[CONNECT_OFF] == STEP_HORIZONTAL:
        curve["plotType"] = "step"


def rowless_kind(x_reason: str, record: bytes | None) -> str | None:
    """``"box"`` / ``"histogram"`` when a curve whose X field reads
    ``x_reason`` is a 206 / 219 plot with no X column (``opju_stat_plots``),
    else ``None``: the curve is then drawn from its Y alone."""
    if x_reason != X_NOT_A_COLUMN or record is None or len(record) <= PLOT_TYPE_OFF:
        return None
    return _ROWLESS.get(record[PLOT_TYPE_OFF])


def mark_rowless(curve: MutableMapping[str, str | float], kind: str) -> None:
    """Re-bind ``curve`` to no X with ``plotType`` ``kind``; a decoded
    line / scatter style is not what Origin draws, so it is dropped."""
    curve["x"] = ""
    curve["plotType"] = kind
    curve.pop("style", None)


def stat_x_reason(stat: str | None, record: bytes | None) -> str:
    """``"stat_plot_x_not_decoded"`` for a 206 / 219 curve that is NOT
    row-less (its X field is undecodable or names a column): quantized cannot
    draw Origin's grouped box / histogram from it, and drawing it as a line
    against that X is a curve Origin does not show. ``""`` otherwise."""
    if stat is None and record is not None and len(record) > PLOT_TYPE_OFF:
        if record[PLOT_TYPE_OFF] in _ROWLESS:
            return "stat_plot_x_not_decoded"
    return ""
