"""The screen's tick increment, offered to an export as a HINT (audit 6
lane L, review H2). Pure layer: no matplotlib.

0.34.0 made an export mark the tick positions the screen drew by copying the
canvas' automatic increment into ``x_step``/``y_step``/``y2_step``. That
crowded a short export axis, and Publication preview never sent it. Now the
client sends the drawn increment as ``*_step_hint`` from the shared spec
builder, so Export, Copy and Publication preview send the same request. The
export takes the hint only when it fits the FINAL axes (:func:`hint_fits`,
checked at draw time after layout by ``calc.figure_tick_hint.HintLocator``);
otherwise matplotlib's AutoLocator places the ticks and the render says so
(``calc.figure_warnings``). A typed ``*_step`` always wins over a hint.
"""

from __future__ import annotations

import math

__all__ = ["TickHint", "hint_fits", "step_or_hint"]


class TickHint(float):
    """An automatic increment the screen drew: a ``float`` the renderers pass
    through unchanged, which ``calc.figure_ticks.apply_tick_steps`` applies
    only when :func:`hint_fits`."""


def step_or_hint(step: float | None, hint: float | None) -> float | None:
    """``step`` when typed, else ``hint`` as a :class:`TickHint`, else None."""
    if step is not None:
        return step
    if hint is None or not math.isfinite(hint) or hint <= 0:
        return None
    return TickHint(hint)


def hint_fits(span: float, hint: float, tick_space: int) -> bool:
    """True when ``hint`` marks at most one interval more over ``span`` than
    matplotlib's AutoLocator allows on this axis:
    ``ceil(span / hint) <= clip(tick_space, 1, 9) + 1``. ``tick_space`` is
    ``Axis.get_tick_space()`` of the laid-out axes (the axis length over two
    tick-font sizes on Y, three on X)."""
    if not (span > 0 and hint > 0) or not math.isfinite(span / hint):
        return False
    bins = min(9, max(1, int(tick_space)))
    return math.ceil(span / hint - 1e-9) <= bins + 1
