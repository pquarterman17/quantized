"""The Axis dialog's per-axis extras for matplotlib export (figures-audit #6).

The interactive Axis dialog (frontend ``components/overlays/figuredialogs/
AxisDialog.tsx``) stores five optional fields on an axis' ``AxisFormat`` --
the same mapping ``calc.figure_ticks.apply_tick_formats`` already receives
as ``x_fmt``/``y_fmt`` -- and the screen draws them through
``frontend/src/lib/axisExtras.ts``. This module is the export half, so a
published figure reads like the canvas:

* ``divide`` -- tick labels show ``value / divide``; the factor is shown at
  the axis end as matplotlib's offset text (``"x10^-3"``), the same place the
  screen draws it.
* ``minor`` -- that many minor ticks between majors (linear axes).
* ``ticks`` -- tick direction: ``"in"``, ``"out"`` (matplotlib's default) or
  ``"both"`` (``inout``).
* ``size`` -- tick-label font size in points.
* ``base`` -- ``"e"`` on a log axis: Origin's "Ln" scale, majors at powers of
  e labelled ``e^n``.
* ``breaks`` -- ``[lo, hi]`` stretches elided from a linear Y axis
  (``calc.axis_breaks``); ignored on X, whose breaks are paneled.

Pure (matplotlib objects in, nothing returned); every field is optional and
validated, so an absent or malformed one leaves matplotlib's own behaviour.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from matplotlib.ticker import AutoMinorLocator, Formatter, FuncFormatter, LogLocator, NullFormatter

from quantized.calc.axis_breaks import apply_y_breaks

__all__ = ["apply_axis_extras", "divide_offset_text"]

_DIRECTIONS = {"in": "in", "out": "out", "both": "inout"}
_SUPERSCRIPT = str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹")


def divide_offset_text(divide: float) -> str:
    """The "x factor" text for a divide-by factor -- ``x10⁻³`` for
    a power of ten, else ``x2.5`` -- the same string the screen draws
    (``axisExtras.ts``'s ``divideLabel``)."""
    exp = math.log10(abs(divide)) if divide else 0.0
    if divide > 0 and abs(exp - round(exp)) < 1e-9:
        return "×10" + str(int(round(exp))).translate(_SUPERSCRIPT)
    return f"×{divide:g}"


class _DividedFormatter(Formatter):
    """Wraps an axis' formatter so each label reads ``value / divide``, and
    reports the factor as the axis offset text."""

    def __init__(self, inner: Formatter | None, divide: float) -> None:
        self.inner = inner
        self.divide = divide

    def set_axis(self, axis: Any) -> None:
        super().set_axis(axis)
        if self.inner is not None:
            self.inner.set_axis(axis)

    def __call__(self, x: float, pos: int | None = None) -> str:
        v = x / self.divide
        if self.inner is None:
            return f"{v:g}"
        return str(self.inner(v, pos))

    def get_offset(self) -> str:
        return divide_offset_text(self.divide)


def _ln_label(v: float, _pos: int | None = None) -> str:
    """A natural-log axis' major label: ``e`` with a superscript exponent."""
    return "e" + str(int(round(math.log(v)))).translate(_SUPERSCRIPT) if v > 0 else ""


def _positive(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) and v > 0 else None


def _apply_one(ax: Any, which: str, axis: Any, scale: str, fmt: Mapping[str, Any]) -> None:
    if fmt.get("base") == "e" and scale == "log":
        axis.set_major_locator(LogLocator(base=math.e))
        axis.set_major_formatter(FuncFormatter(_ln_label))
        axis.set_minor_formatter(NullFormatter())
    divide = _positive(fmt.get("divide"))
    if divide is not None and divide != 1:
        inner = axis.get_major_formatter()
        # matplotlib's own default formatter carries an offset/scientific
        # notation of its own; a plain "%g" label is what the screen shows.
        keep = inner if type(inner).__module__.startswith("quantized") else None
        axis.set_major_formatter(_DividedFormatter(keep, divide))
    minor = fmt.get("minor")
    if isinstance(minor, int) and 0 < minor <= 20 and scale == "linear":
        axis.set_minor_locator(AutoMinorLocator(minor + 1))
        ax.tick_params(axis=which, which="minor", length=2.0, width=0.6)
    direction = _DIRECTIONS.get(str(fmt.get("ticks")))
    if direction is not None:
        ax.tick_params(axis=which, which="both", direction=direction)
    size = _positive(fmt.get("size"))
    if size is not None and size <= 72:
        ax.tick_params(axis=which, labelsize=size)
        axis.get_offset_text().set_fontsize(size)
    # Last: the break keeps the formatter and typed increment set above.
    if which == "y" and scale == "linear" and fmt.get("breaks"):
        apply_y_breaks(ax, fmt.get("breaks"), minor)


def apply_axis_extras(
    ax: Any, x_fmt: Mapping[str, Any] | None, y_fmt: Mapping[str, Any] | None
) -> None:
    """Apply each axis' Axis-dialog extras (module doc). Called from
    ``calc.figure_ticks.apply_tick_formats`` after the tick formatter is in
    place, so ``divide`` wraps the final formatter."""
    pairs = (("x", ax.xaxis, ax.get_xscale(), x_fmt), ("y", ax.yaxis, ax.get_yscale(), y_fmt))
    for which, axis, scale, fmt in pairs:
        if fmt:
            _apply_one(ax, which, axis, scale, fmt)
