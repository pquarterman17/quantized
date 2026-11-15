"""Curve-record gates: what a decoded ``.opju`` curve must NOT be drawn as.

Both read the curve record ``curve_style_color.opju_style_record``
reconstructs from the curve token (the ``.opj`` curve-anchor layout).

**Step connects: withhold the line style.** Byte 17 is the line's connect
mode. A step plot is a LINE plot (byte 76 ``0xc8``; Origin's own
``DataPlot::GetPlotType()`` reads 200) whose points join by
horizontal-then-vertical steps; quantized draws ``"line"`` as straight
segments, so claiming it draws another curve. The style is dropped (the
curve keeps its binding, colour and width) -- never a wrong shape.
Evidence (Origin 2026b Student COM, 2026-11-15, ``tools/plot_corpus``): all
13 specimens built with ``layer.plotN.line.connect = 7`` (39 curves) store
byte 17 = 11; the same families built as plain lines (connect 2) store 1,
and the records differ in no other byte. Corpus: 0 of 7,103 decoded
line / scatter / line+symbol records carry 11. Only this value is proven:
the other byte-17 values (``docs/origin_re/curve_axis_fidelity.md``) are
not read -- the item-52 revert forbids inferring a connect mode without an
oracle.

**Error-bar plots are not curves.** Byte 76 is Origin's plot type
(``0xc8`` = 200 line ...); ``0xe7`` = 231 and ``0xe9`` = 233 are the Y- and
X-error-bar plots (OriginLab ``plotxy`` ids; ``tools/plot_corpus`` README).
Such a DataPlot draws bars on the curve before it, from the error column the
token names; quantized draws error bars from the column designation, so a
curve bound to that column is a phantom line: it is omitted
(``error_bar_plot``), its legend caption with it (``without_captions``
renumbers the rest, so no kept curve's caption changes).

Evidence (Origin 2026b COM ``DataPlot::GetPlotType()`` per plot,
2026-11-15): the ``error_columns`` specimens' error tokens store 231 / 233
exactly where Origin reads 231 / 233. On the 36 real files carrying such
tokens, all 2,738 decoded tokens with byte 0xe7 / 0xe9 are Origin error-bar
plots (2,725 + 1 type-matched, 12 0xe7 tokens that Origin reads 233), and
none of the 1,731 decoded tokens with any other byte is. Every one was a
curve drawn against the wrong X before (the bar's own X is the Y it
decorates). Resolved legend captions of all 1,395 kept curves on those
layers are unchanged. Bars that still draw from designations: 109 Y-error
bars attach to Origin's Y; 2,616 Y-error and 13 X-error bars are lost
(mostly books whose designations do not decode) -- an omission, not a wrong
line.
"""

from __future__ import annotations

from collections.abc import MutableMapping

__all__ = [
    "CONNECT_OFF",
    "ERROR_BAR_PLOTS",
    "PLOT_TYPE_OFF",
    "STEP_HORIZONTAL",
    "X_NOT_A_COLUMN",
    "COLUMN_PLOT",
    "error_bar_reason",
    "mark_column",
    "mark_rowless",
    "rowless_kind",
    "stat_x_reason",
    "withhold_step_style",
]

CONNECT_OFF = 17
STEP_HORIZONTAL = 11  # layer.plotN.line.connect 7
PLOT_TYPE_OFF = 76
ERROR_BAR_PLOTS = frozenset({0xE7, 0xE9})  # plot 231 Y-error bar, 233 X-error bar
X_NOT_A_COLUMN = "x_not_a_column"  # opju_curve_token_x: the record X id is 0
# Plot types Origin draws with no X column (box family 206, histogram 219):
# kept from their Y alone, see ``opju_stat_plots``.
_ROWLESS = {206: "box", 219: "histogram"}
COLUMN_PLOT = 203  # Origin's vertical column plot (plotType "column")


def withhold_step_style(curve: MutableMapping[str, str | float], record: bytes | None) -> None:
    """Drop ``curve["style"]`` when ``record`` is a step-connected line."""
    if record is not None and len(record) > CONNECT_OFF and record[CONNECT_OFF] == STEP_HORIZONTAL:
        curve.pop("style", None)


def error_bar_reason(record: bytes | None) -> str:
    """``"error_bar_plot"`` when ``record`` is an error-bar DataPlot, else ``""``."""
    if (
        record is not None
        and len(record) > PLOT_TYPE_OFF
        and record[PLOT_TYPE_OFF] in ERROR_BAR_PLOTS
    ):
        return "error_bar_plot"
    return ""


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


def mark_column(curve: MutableMapping[str, str | float], record: bytes | None) -> None:
    """``plotType`` ``"column"`` on a curve whose record is a 203 column plot
    (bars from zero at each X, ``originCurveSeriesStyle``); whether the layer
    may keep it is ``opju_stat_plots.apply_stat_kinds``'s call."""
    if record is not None and len(record) > PLOT_TYPE_OFF and record[PLOT_TYPE_OFF] == COLUMN_PLOT:
        curve["plotType"] = "column"
