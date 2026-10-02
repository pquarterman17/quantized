"""Log-axis tick LABELS for matplotlib export, mirroring the screen's
``frontend/src/lib/logTicks.ts`` so an exported log axis reads like the plot.

On a view spanning at least a decade only the decade anchors carry text
(``1``, ``10``, ``10^2``, ``10^-3``; the 2-9 subdivisions stay blank). On a
sub-decade view every tick is labelled with an ordinary number (0.8, 0.9),
because a zoomed log view usually has no decade inside it at all. matplotlib's
own log formatter labels decades only, and the minor ticks it would otherwise
label were nulled here, so such a view exported with no tick labels.

Pure layer (matplotlib only); split from ``calc.figure_scale`` for size.
"""

from __future__ import annotations

import math
from typing import Any

from matplotlib.ticker import Formatter

from quantized.calc.figure_ticks import _decimals_for_increment

__all__ = ["LogTickLabels"]


def _decade_of(v: float) -> int | None:
    """Exact decade exponent of ``v``, or None when ``v`` is not 10^k."""
    if not (v > 0) or not math.isfinite(v):
        return None
    exp = math.log10(v)
    k = round(exp)
    return k if abs(exp - k) < 1e-9 else None


def _visible_ticks(axis: Any) -> list[float]:
    """Every major and minor tick location inside the current view."""
    lo, hi = sorted(axis.get_view_interval())
    locs = [*axis.get_majorticklocs(), *axis.get_minorticklocs()]
    eps = 1e-9 * max(abs(lo), abs(hi), 1e-300)
    return sorted({float(v) for v in locs if v > 0 and lo - eps <= v <= hi + eps})


def _trim(text: str) -> str:
    """Drop trailing fractional zeros, as ``Intl.NumberFormat`` does."""
    return text.rstrip("0").rstrip(".") if "." in text else text


def _plain(v: float, incr: float, lo: float, hi: float) -> str:
    """The screen's sub-decade label: just enough decimals for the tick
    spacing. Huge or tiny views (``hi >= 1e6`` or ``lo < 1e-4``) read
    ``1.5x10^22`` in each value's own decade instead, as the screen's
    ``scaledLabels`` (lib/logTicks.ts)."""
    if hi < 1e6 and lo >= 1e-4:
        return _trim(f"{v:.{_decimals_for_increment(incr)}f}")
    k = math.floor(math.log10(v) + 1e-9)
    m = _trim(f"{v / 10.0**k:.{_decimals_for_increment(incr / 10.0**k)}f}")
    body = f"10^{{{k}}}" if m == "1" else f"{m}\\times10^{{{k}}}"
    return f"$\\mathdefault{{{body}}}$"


class LogTickLabels(Formatter):
    """One log axis' major or minor tick labels (see the module doc).

    ``inner`` is an explicit tick format (``figure_ticks.axis_tick_formatter``)
    that writes the text instead of the auto rule; this class then only
    decides WHICH ticks carry text, as the screen's ``logMajorTickFilter``."""

    def __init__(self, minor: bool, inner: Formatter | None = None) -> None:
        self.minor = minor
        self.inner = inner

    def set_axis(self, axis: Any) -> None:
        super().set_axis(axis)
        if self.inner is not None:
            self.inner.set_axis(axis)

    def __call__(self, x: float, pos: int | None = None) -> str:
        axis = self.axis
        if axis is None or not hasattr(axis, "get_minorticklocs"):
            return ""
        ticks = _visible_ticks(axis)
        if len(ticks) >= 2 and ticks[-1] / ticks[0] >= 10 * (1 - 1e-9):
            k = _decade_of(x)
            if self.minor or k is None:
                return ""
            if self.inner is not None:
                return str(self.inner(x, pos))
            return f"$\\mathdefault{{{10**k if k in (0, 1) else f'10^{{{k}}}'}}}$"
        if self.inner is not None:
            return str(self.inner(x, pos))
        gaps = [b - a for a, b in zip(ticks, ticks[1:], strict=False) if b > a]
        return _plain(x, min(gaps) if gaps else 0.0, ticks[0], ticks[-1]) if ticks else ""
