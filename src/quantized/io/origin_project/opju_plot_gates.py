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
curve bound to that column is a phantom line. Evidence: every
``error_columns`` specimen's error column token stores 231 where Origin's
``GetPlotType()`` reads 231 (6 specimens), and its X-error column 233.
"""

from __future__ import annotations

from collections.abc import MutableMapping

__all__ = [
    "CONNECT_OFF",
    "ERROR_BAR_PLOTS",
    "PLOT_TYPE_OFF",
    "STEP_HORIZONTAL",
    "error_bar_reason",
    "withhold_step_style",
]

CONNECT_OFF = 17
STEP_HORIZONTAL = 11  # layer.plotN.line.connect 7
PLOT_TYPE_OFF = 76
ERROR_BAR_PLOTS = frozenset({0xE7, 0xE9})  # plot 231 Y-error bar, 233 X-error bar


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
