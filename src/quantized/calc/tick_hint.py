"""The screen's tick increment, offered to an export as a HINT (audit 6
lane L, reviews H2 / N2). Pure layer: no matplotlib.

0.34.0 made an export mark the tick positions the screen drew by copying the
canvas' automatic increment into ``x_step``/``y_step``/``y2_step``. That
crowded a short export axis, and Publication preview never sent it. Now the
exports of the focused window's own view (Stage Export / Copy figure and
its Publication preview) send the drawn increment as ``*_step_hint``. The
export takes it only when it fits the FINAL axes (:func:`hint_fits`, checked
at draw time after layout by ``calc.figure_tick_hint.HintLocator``);
otherwise matplotlib places the ticks and the render says so
(``calc.figure_warnings``). A typed ``*_step`` always wins over a hint.
"""

from __future__ import annotations

import math

__all__ = ["HINT_MAX", "TickHint", "hint_fits", "step_or_hint"]

# The route's exclusive upper bound on a hint (``Field(lt=HINT_MAX)``): far
# above any plotted span, and far below where ``span / hint`` or matplotlib's
# ``MultipleLocator`` arithmetic overflows.
HINT_MAX = 1e300


class TickHint(float):
    """An automatic increment the screen drew: a ``float`` the renderers pass
    through unchanged, which ``calc.figure_ticks.apply_tick_steps`` applies
    only when :func:`hint_fits`."""


def step_or_hint(step: float | None, hint: float | None) -> float | None:
    """``step`` when typed, else ``hint`` as a :class:`TickHint`, else None."""
    if step is not None:
        return step
    if hint is None or not math.isfinite(hint) or not 0 < hint < HINT_MAX:
        return None
    return TickHint(hint)


def hint_fits(lo: float, hi: float, hint: float, tick_space: int) -> bool:
    """True when ``hint`` over the view ``[lo, hi]`` (either order) both

    - marks at most one interval more than matplotlib's tick BUDGET for this
      axis: ``ceil(span / hint) <= clip(tick_space, 1, 9) + 1``, where
      ``tick_space`` is ``Axis.get_tick_space()`` of the laid-out axes (the
      axis length over two tick-font sizes on Y, three on X) -- the bins
      matplotlib may use, not the intervals it happens to place; and
    - leaves at least two ticks visible (review N2: a hint at or above the
      span drew one tick or none)."""
    lo, hi = min(lo, hi), max(lo, hi)
    if not (hint > 0 and math.isfinite(hint) and math.isfinite(lo) and math.isfinite(hi)):
        return False
    count, first, last = (hi - lo) / hint, lo / hint, hi / hint
    if not (0 < count < 1e6 and abs(first) < 1e15 and abs(last) < 1e15):
        return False
    bins = min(9, max(1, int(tick_space)))
    two_ticks = math.floor(last + 1e-9) - math.ceil(first - 1e-9) >= 1
    return math.ceil(count - 1e-9) <= bins + 1 and two_ticks
