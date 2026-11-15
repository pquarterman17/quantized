"""matplotlib half of the tick hint (``calc.tick_hint``): a major locator
that takes the screen's increment when it fits the laid-out axes and falls
back to AutoLocator otherwise.

The decision is made in ``tick_values``, which matplotlib calls at draw time,
after the layout engine has sized the axes, so the Y2 slot, titles and a
colorbar are accounted for. A layout pass can ask more than once at
different sizes; the warning follows the LAST decision (a later acceptance
retracts an earlier rejection's note).
"""

from __future__ import annotations

from typing import Any

from matplotlib.ticker import AutoLocator, Locator, MultipleLocator

from quantized.calc.figure_warnings import note_figure_warning, retract_figure_warning
from quantized.calc.tick_hint import hint_fits

__all__ = ["HintLocator"]


class HintLocator(Locator):
    """``MultipleLocator(hint)`` when :func:`hint_fits`, else AutoLocator."""

    def __init__(self, hint: float) -> None:
        self.hint = float(hint)
        self._multiple = MultipleLocator(self.hint)
        self._auto = AutoLocator()
        self.accepted: bool | None = None

    def set_axis(self, axis: Any) -> None:
        super().set_axis(axis)
        self._multiple.set_axis(axis)
        self._auto.set_axis(axis)

    def __call__(self) -> Any:
        if self.axis is None:
            return self._auto()
        lo, hi = self.axis.get_view_interval()
        return self.tick_values(lo, hi)

    def tick_values(self, vmin: float, vmax: float) -> Any:
        space = self.axis.get_tick_space() if self.axis is not None else 9
        self.accepted = hint_fits(abs(float(vmax) - float(vmin)), self.hint, space)
        name = str(getattr(self.axis, "axis_name", "")).upper()
        note = (
            f"{name} ticks re-spaced for the export size: the screen's "
            f"increment {self.hint:g} would crowd this axis"
        )
        if self.accepted:
            retract_figure_warning(note)
            return self._multiple.tick_values(vmin, vmax)
        note_figure_warning(note)
        return self._auto.tick_values(vmin, vmax)
