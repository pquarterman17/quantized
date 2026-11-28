"""Round tick positions for the calendar tick modes (``date`` / ``time`` /
``datetime``) on export -- a port of what uPlot does on screen, so an exported
figure's ticks fall at 09:00 and 12:00 where the screen's do, not at the
5000 s multiples of matplotlib's numeric ``AutoLocator`` (09:03, 10:26).

The screen (``scales.x.time`` in ``frontend/src/lib/uplotOpts.ts``) takes
uPlot's own rule, ported here in UTC (the screen pins ``tzDate`` to UTC):

* the increment is the smallest entry of uPlot's ``timeIncrsS`` table whose
  spacing on the plot is at least ``space`` px, where ``space`` is the wider
  of 50 px and ``(label characters + 2) x 0.6`` font sizes (``xTickSpace``);
* below a day the ticks sit at whole increments after midnight; at a day or
  more they start at the first midnight in view and step by the increment;
  month and year increments sit on the first of a month / of January,
  starting one increment after the first month / year in view when the view
  does not begin exactly on one (uPlot's own, slightly odd, rule).

The label width in that rule is what the screen DREW. An export request may
carry it (``label_chars``, the longest drawn tick label, from the screen's
``TickFormatSpec.labelChars``); the step then follows it exactly. Without it
the export measures its own label text, widened by :func:`_screen_width`'s
allowance for the screen's longer date spelling.

Pinned to the screen by ``tests/fixtures/wire/date_ticks.json``. Pure:
the matplotlib ``Locator`` class below is the only matplotlib touch.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from matplotlib import rcParams
from matplotlib.font_manager import FontProperties
from matplotlib.ticker import Locator

__all__ = ["DateLocator", "date_tick_values", "date_increment"]

_MIN, _HOUR, _DAY = 60.0, 3600.0, 86_400.0
_MONTH, _YEAR = 30 * _DAY, 365 * _DAY

#: uPlot's ``timeIncrsS`` (seconds): sub-second 1/2/2.5/5 steps, then the
#: minute, hour, day, month and year divisors.
INCREMENTS: tuple[float, ...] = (
    0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5,
    1, 5, 10, 15, 30,
    _MIN, _MIN * 5, _MIN * 10, _MIN * 15, _MIN * 30,
    _HOUR, _HOUR * 2, _HOUR * 3, _HOUR * 4, _HOUR * 6, _HOUR * 8, _HOUR * 12,
    *(_DAY * n for n in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15)),
    *(_MONTH * n for n in (1, 2, 3, 4, 6)),
    *(_YEAR * n for n in (1, 2, 5, 10, 25, 50, 100)),
)


def _screen_width(label: str) -> int:
    """The label's length as the SCREEN draws it: its date reads "Mar 01, 2026"
    (12 characters, not "2026-03-01"), and ", " (not " ") joins it to the clock.
    The minimum tick spacing follows the drawn label, so the export measures the
    screen's text, not its own."""
    has_date = label.count("-") >= 2
    return len(label) + (2 if has_date else 0) + (1 if has_date and ":" in label else 0)


def _stamp(secs: float) -> datetime:
    return datetime.fromtimestamp(secs, tz=UTC)


def _first_of(year: int, month0: int) -> float:
    """Epoch seconds of the first of month ``month0`` (0-based, may overflow) of ``year``."""
    y, m = divmod(year * 12 + month0, 12)
    return datetime(y, m + 1, 1, tzinfo=UTC).timestamp()


def date_increment(lo: float, hi: float, plot_px: float, min_space: float) -> float | None:
    """The tick increment (s) uPlot's ``findIncr`` picks: the smallest one that
    keeps ticks ``min_space`` px apart on a ``plot_px`` wide plot. None when none does."""
    delta = hi - lo
    if not (plot_px > 0 and delta > 0):
        return None
    return next((i for i in INCREMENTS if plot_px * i / delta >= min_space), None)


def _splits(lo: float, hi: float, incr: float) -> list[float]:
    """uPlot's ``timeAxisSplits`` in UTC."""
    out: list[float] = []
    lo_d = _stamp(lo)
    if incr >= _MONTH:
        year_step = round(incr / _YEAR) if incr >= _YEAR else 0
        mo_step = round(incr / _MONTH) if incr < _YEAR else 0
        min_min = _first_of(lo_d.year, 0 if year_step else lo_d.month - 1)
        if lo == min_min:
            split = lo
        else:
            split = _first_of(lo_d.year + year_step, (0 if year_step else lo_d.month - 1) + mo_step)
        base = _stamp(split)
        i = 0
        while True:
            nxt = _first_of(base.year + year_step * i, base.month - 1 + mo_step * i)
            if nxt > hi:
                return out
            out.append(nxt)
            i += 1
    midnight = lo_d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    step0 = _DAY if incr >= _DAY else incr
    first = midnight + math.ceil(round((lo - midnight) / step0, 9)) * step0
    j = 0
    while first + j * incr <= hi + 1e-9 and j < 2000:
        out.append(round(first + j * incr, 3))
        j += 1
    return out


def date_tick_values(
    lo: float,
    hi: float,
    plot_px: float,
    font_px: float,
    text: Callable[[float, float], str],
    label_chars: int | None = None,
) -> list[float]:
    """Round ticks across ``lo..hi`` (epoch seconds). ``text(x, incr)`` labels a
    tick, used only for its length (the screen's minimum spacing follows it);
    ``label_chars``, when given, is the width the screen's labels had and
    replaces that measurement."""
    if not (math.isfinite(lo) and math.isfinite(hi)) or hi <= lo:
        return [lo] if math.isfinite(lo) else []
    chosen: float | None = None
    for cand in INCREMENTS:
        if plot_px * cand / (hi - lo) < 50:
            continue
        if label_chars is not None:
            n = label_chars
        else:
            sample = _splits(lo, hi, cand)[:60] or [lo]
            n = max(_screen_width(text(x, cand)) for x in sample)
        if plot_px * cand / (hi - lo) >= max(math.ceil((n + 2) * font_px * 0.6), 50):
            chosen = cand
            break
    if chosen is None:
        return [lo]
    return _splits(lo, hi, chosen)


class DateLocator(Locator):
    """Major ticks at the screen's round calendar positions."""

    def __init__(self, text: Callable[[float, float], str], label_chars: int | None = None) -> None:
        self.text = text
        self.label_chars = label_chars

    def __call__(self) -> Any:
        if self.axis is None:
            return []
        vmin, vmax = self.axis.get_view_interval()
        return self.tick_values(vmin, vmax)

    def tick_values(self, vmin: float, vmax: float) -> Any:
        lo, hi = sorted((float(vmin), float(vmax)))
        axes = getattr(self.axis, "axes", None)  # a placeholder axis has none
        try:
            plot_px = float(axes.bbox.width)  # type: ignore[union-attr]
            dpi = float(axes.figure.dpi)  # type: ignore[union-attr]
        except AttributeError:
            plot_px, dpi = 480.0, 72.0
        font_px = FontProperties(size=rcParams["xtick.labelsize"]).get_size_in_points() * dpi / 72.0
        try:
            return date_tick_values(lo, hi, plot_px, font_px, self.text, self.label_chars)
        except (OSError, OverflowError, ValueError):
            return []  # an out-of-range epoch: no ticks, as the formatter draws a blank
