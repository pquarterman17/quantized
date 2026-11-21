"""The ``clock`` tick mode on export: seconds since midnight labelled as a
time of day (``HH:MM`` / ``HH:MM:SS`` / ``HH:MM:SS.fff``), never a date.

A time-only column the Import Wizard read as "Time of day"
(``io._time_of_day``, ``metadata["time_is_clock"]``) is seconds since
midnight. The calendar ``time`` mode would treat it as an epoch -- and add
"1970-01-01" once its ticks are a day apart. ``clock`` wraps every 24 h
instead (an axis unwrapped across midnight reads 23:00, 00:00, 01:00) and
only names the day offset (``1d 00:00``) when the ticks are a day or more
apart, where a clock face alone would repeat one label.

Mirrors the screen's ``frontend/src/lib/clockTicks.ts`` exactly (labels and
the step table), so an exported figure reads like the plot it came from.
"""

from __future__ import annotations

import math
from typing import Any

from matplotlib.ticker import Locator

__all__ = ["CLOCK_MODE", "ClockLocator", "clock_label", "clock_step"]

CLOCK_MODE = "clock"
_DAY = 86_400.0
#: Tick increments a clock axis steps by, in seconds (then whole days by
#: 1-2-5 multiples). The same table as `clockTicks.ts`'s `CLOCK_STEPS`.
CLOCK_STEPS = (
    0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800,
    3600, 7200, 10800, 21600, 43200, 86400,
)


def clock_step(min_step: float) -> float:
    """The smallest clock increment of at least ``min_step`` seconds."""
    if not math.isfinite(min_step) or min_step <= 0:
        return 1.0
    for step in CLOCK_STEPS:
        if step >= min_step - 1e-12:
            return float(step)
    days = min_step / _DAY
    mag = 10.0 ** math.floor(math.log10(days))
    for m in (1, 2, 5, 10):
        if m * mag >= days - 1e-12:
            return m * mag * _DAY
    return 10 * mag * _DAY


def _decimals(step: float) -> int:
    """How many fraction digits resolve ``step`` exactly (at most 9)."""
    if not math.isfinite(step) or step <= 0 or step >= 1:
        return 0
    for d in range(1, 10):
        scaled = step * 10**d
        if abs(scaled - round(scaled)) < 1e-6:
            return d
    return 9


def clock_label(x: float, step: float) -> str:
    """The tick label of ``x`` seconds on an axis whose ticks are ``step``
    apart: seconds shown when the step is not whole minutes, fraction
    digits when it is under a second, the day offset when it is a day or
    more. Blank for a non-finite value."""
    if not math.isfinite(x):
        return ""
    incr = step if math.isfinite(step) and step > 0 else 0.0
    d = _decimals(incr)
    # Round first (59.9999 is the next minute), half up like JS `Math.round`.
    total = math.floor(x * 10**d + 0.5) / 10**d
    day = math.floor(total / _DAY)
    t = total - day * _DAY
    h = int(t // 3600)
    m = int((t - h * 3600) // 60)
    s = t - h * 3600 - m * 60
    text = f"{h:02d}:{m:02d}"
    if incr == 0 or incr < 60 or incr % 60:
        text += f":{s:0{3 + d if d else 2}.{d}f}"
    return f"{day}d {text}" if incr >= _DAY else text


class ClockLocator(Locator):
    """Major ticks at whole clock increments (``clock_step``), about
    ``nbins`` across the view -- matplotlib's own 1-2-5 locator would put
    them at 5000 s (01:23:20)."""

    def __init__(self, nbins: int = 7) -> None:
        self.nbins = nbins

    def __call__(self) -> Any:
        if self.axis is None:
            return []
        vmin, vmax = self.axis.get_view_interval()
        return self.tick_values(vmin, vmax)

    def tick_values(self, vmin: float, vmax: float) -> Any:
        lo, hi = sorted((float(vmin), float(vmax)))
        if not (math.isfinite(lo) and math.isfinite(hi)) or hi <= lo:
            return [lo]
        step = clock_step((hi - lo) / self.nbins)
        first = math.ceil(lo / step - 1e-9) * step
        n = min(int((hi - first) / step + 1e-9) + 1, 1000)
        return [first + i * step for i in range(n)]
