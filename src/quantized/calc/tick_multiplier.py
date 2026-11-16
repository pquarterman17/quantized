"""The export half of the AUTO tick labels' common x10^n factor (UX audit 8 #8).

The screen (``frontend/src/lib/autoTickValues.ts``, rule ``autoTickExponent``)
labels an auto linear axis whose ticks are all below 1e-2 or reach 1e4 with
mantissas and draws "x10^n" at the axis end. :class:`AutoTickFormatter` does
the same in matplotlib: the factor is its offset text, which matplotlib places
at the same axis end. Between those
limits it is matplotlib's own ``ScalarFormatter``, exactly as before. Pinned
with the screen by the shared fixture ``tests/fixtures/wire/tick_multiplier.json``.

Pure layer (matplotlib only); applied by ``calc.figure_ticks.apply_tick_formats``.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from typing import Any

from matplotlib.ticker import ScalarFormatter

__all__ = [
    "AutoTickFormatter",
    "auto_multiplier_allowed",
    "auto_tick_exponent",
    "disable_auto_multiplier",
    "install_auto_formatter",
    "times_ten",
]

_SUPERSCRIPT = str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹")
_MINUS = "−"


def times_ten(n: int) -> str:
    """``x10^n`` with superscript digits -- the screen's ``timesTen``."""
    return "×10" + str(n).translate(_SUPERSCRIPT)


def auto_tick_exponent(ticks: Iterable[float]) -> int | None:
    """The order of magnitude of the largest |tick|, when it is at most -3 or
    at least 4 (ticks all below 1e-2, or reaching 1e4); else ``None``. Also
    ``None`` for a tight range (span / |max| < 1e-3)."""
    finite = [float(v) for v in ticks if math.isfinite(v)]
    peak = max((abs(v) for v in finite), default=0.0)
    if not peak > 0:
        return None
    # A tight range far from zero (1000.001..1000.002): its mantissas would
    # need more than 5 digits, so no factor -- the screen skips it too.
    if max(finite) > min(finite) and (max(finite) - min(finite)) / peak < 1e-3:
        return None
    n = math.floor(math.log10(peak) + 1e-9)
    return n if n <= -3 or n >= 4 else None


def auto_multiplier_allowed(fmt: Mapping[str, Any] | None) -> bool:
    """The screen's ``autoMultiplierAllowed``: an auto axis with no divide-by,
    prefix / suffix, custom ticks, breaks, probability scale or crossing."""
    if not fmt:
        return True
    divide = fmt.get("divide")
    return (
        fmt.get("mode", "auto") == "auto"
        and not (divide and divide != 1)
        and not fmt.get("prefix")
        and not fmt.get("suffix")
        and not fmt.get("custom")
        and not fmt.get("breaks")
        and not fmt.get("prob")
        and fmt.get("cross") is None
    )


def _mantissa(x: float, n: int, incr: float) -> str:
    """``x`` in units of ``10**n``, at the decimals ``incr`` needs there."""
    # Imported lazily: figure_ticks imports this module.
    from quantized.calc.figure_ticks import _decimals_for_increment, _pow10

    k = _pow10(n)
    return f"{x / k:.{min(20, _decimals_for_increment(incr / k))}f}"


class AutoTickFormatter(ScalarFormatter):
    """matplotlib's ``ScalarFormatter``, except that a tiny or huge axis gets
    the screen's mantissa labels and ``x10^n`` offset text."""

    def __init__(self) -> None:
        super().__init__()
        # Never matplotlib's own offset ("+1e3" with "0.0010" labels): the screen draws full labels.
        self.set_useOffset(False)
        self.multiplier = True
        self._exp: int | None = None
        self._incr = 0.0

    def set_locs(self, locs: Any) -> None:
        super().set_locs(locs)
        values = [float(v) for v in locs]
        view = getattr(self.axis, "get_view_interval", None)
        lo, hi = sorted(float(v) for v in view()) if callable(view) else (-math.inf, math.inf)
        tol = 1e-9 * (hi - lo) if math.isfinite(hi - lo) else 0.0
        # matplotlib's locator places ticks past the view; only drawn ones count.
        shown = [v for v in values if lo - tol <= v <= hi + tol]
        self._exp = auto_tick_exponent(shown) if self.multiplier else None
        gaps = [b - a for a, b in zip(sorted(shown), sorted(shown)[1:], strict=False) if b - a > 0]
        self._incr = min(gaps) if gaps else 0.0

    def __call__(self, x: float, pos: int | None = None) -> str:
        if self._exp is None:
            return str(super().__call__(x, pos))
        text = _mantissa(x, self._exp, self._incr)
        if text.startswith("-"):
            text = text[1:] if float(text[1:]) == 0 else _MINUS + text[1:]
        return text

    def get_offset(self) -> str:
        return str(super().get_offset()) if self._exp is None else times_ten(self._exp)


def install_auto_formatter(axis: Any, scale: str, fmt: Mapping[str, Any] | None) -> None:
    """Give an auto linear axis the :class:`AutoTickFormatter`. Only over
    matplotlib's own default formatter: a shared axis (a twin's X) already
    carries its owner's formatter and keeps it."""
    default = type(axis.get_major_formatter()) is ScalarFormatter
    if scale == "linear" and default and auto_multiplier_allowed(fmt):
        axis.set_major_formatter(AutoTickFormatter())


def disable_auto_multiplier(axis: Any) -> None:
    """No factor on this axis (a Y3+ axis: its factor would sit on Y2's)."""
    formatter = axis.get_major_formatter()
    if isinstance(formatter, AutoTickFormatter):
        formatter.multiplier = False
