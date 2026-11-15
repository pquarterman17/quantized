"""matplotlib half of the tick hint (``calc.tick_hint``): a major locator
that takes the screen's increment when it fits the laid-out axes and falls
back to matplotlib's own spacing otherwise.

The decision is made in ``tick_values``, which matplotlib calls at draw time,
after the layout engine has sized the axes, so the Y2 slot, titles and a
colorbar are accounted for. A layout pass can ask more than once at
different sizes; the warning follows each locator's LAST decision, keyed by
the locator itself (``figure_warnings.set_keyed_figure_warning``), so one
axis' acceptance never retracts another's warning (review N3).

The fallback is AutoLocator's on Y and Y2. On X it also asks for at least
three ticks (``MaxNLocator(min_n_ticks=3)``), the screen's own X rule
(``frontend/src/lib/uplotRightPad.ts``'s ``xTickSpace``): a short X axis
otherwise kept only two labels where three or more fit (review N5).
"""

from __future__ import annotations

from typing import Any

from matplotlib.ticker import AutoLocator, Locator, MaxNLocator, MultipleLocator

from quantized.calc.figure_warnings import set_keyed_figure_warning
from quantized.calc.tick_hint import hint_fits

__all__ = ["HintLocator"]


class HintLocator(Locator):
    """``MultipleLocator(hint)`` when :func:`hint_fits`, else matplotlib's
    spacing. ``label`` ("X", "Y", "Y2") names the axis in the warning."""

    def __init__(self, hint: float, label: str) -> None:
        self.hint = float(hint)
        self.label = label
        self._multiple = MultipleLocator(self.hint)
        self._auto: Locator = (
            MaxNLocator("auto", steps=[1, 2, 2.5, 5, 10], min_n_ticks=3)
            if label == "X" else AutoLocator()
        )
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
        self.accepted = hint_fits(float(vmin), float(vmax), self.hint, space)
        note = (
            f"{self.label} ticks re-spaced for the export size: the screen's "
            f"increment {self.hint:g} does not fit this {self.label} axis"
        )
        set_keyed_figure_warning(self, None if self.accepted else note)
        if self.accepted:
            return self._multiple.tick_values(vmin, vmax)
        return self._auto.tick_values(vmin, vmax)
