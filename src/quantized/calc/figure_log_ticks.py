"""Log-axis ticks for matplotlib export, mirroring the screen's
``frontend/src/lib/logTicks.ts`` and ``uplotOpts.fixedLogAxisSplits`` so an
exported log axis reads like the plot.

Positions (``fixed_log_splits``): a view spanning at least a decade gets the
decades plus their 2-9 subdivisions; a sub-decade view gets ticks stepped
arithmetically (an Origin step, or a nice 1/2/5 step). The 2-9 subdivisions
(drawn here as minor ticks and grid) are dropped when the decade labels are
thinned or the view spans more than six decades.

Labels: on a decade view only every n-th decade carries text, n chosen so
labels stay 50 px (x) / 30 px (y) apart at 96 px per inch -- uPlot's minimum
label spacing. A sub-decade view labels its arithmetic ticks with ordinary
numbers, skipping one closer than that spacing to the last label kept.

Pure layer (matplotlib only); split from ``calc.figure_scale`` for size.
"""

from __future__ import annotations

import math
from typing import Any

from matplotlib.ticker import Formatter, Locator

from quantized.calc.figure_ticks import _AxisTickFormatter, _decimals_for_increment, _pow10

__all__ = ["LogMajorLocator", "LogMinorLocator", "LogTickLabels", "fixed_log_splits"]

_EPS = 1e-9


def _clean(v: float) -> float:
    """``cleanStepValue``: drop float noise from ``n * step``."""
    return float(f"{v:.12g}")


def _nice_step(span: float, target: int = 5) -> float:
    """``niceLinearStep``: a 1/2/5 x 10^n step giving about ``target`` ticks."""
    if not span > 0:
        return 1.0
    raw = span / target
    mag = _pow10(math.floor(math.log10(raw)))
    r = raw / mag
    return (1.0 if r < 1.5 else 2.0 if r < 3 else 5.0 if r < 7 else 10.0) * mag


def fixed_log_splits(lo: float, hi: float, step: float | None = None) -> list[float]:
    """Port of the screen's ``fixedLogAxisSplits`` (see the module doc)."""
    if not (lo > 0) or not (hi > lo):
        return []
    if math.log10(hi / lo) >= 1 - _EPS:
        out = []
        for k in range(math.floor(math.log10(lo) + _EPS), math.ceil(math.log10(hi) - _EPS) + 1):
            for m in range(1, 10):
                v = m * _pow10(k)
                if lo * (1 - _EPS) <= v <= hi * (1 + _EPS):
                    out.append(v)
        return out
    s = step if step and step > 0 else _nice_step(hi - lo)
    n0, n1 = math.ceil(lo / s - _EPS), math.floor(hi / s + _EPS)
    return [] if n1 - n0 + 1 > 1000 else [_clean(n * s) for n in range(n0, n1 + 1)]


def _decade_of(v: float) -> int | None:
    """Exact decade exponent of ``v``, or None when ``v`` is not 10^k."""
    if not (v > 0) or not math.isfinite(v):
        return None
    exp = math.log10(v)
    k = round(exp)
    return k if abs(exp - k) < 1e-9 else None


def _spans_decade(vals: list[float]) -> bool:
    pos = [v for v in vals if v > 0 and math.isfinite(v)]
    return len(pos) >= 2 and max(pos) / min(pos) >= 9.99999999


def _space(axis: Any) -> float:
    """uPlot's minimum label spacing in CSS px: 50 along x, 30 along y."""
    return 50.0 if axis.axis_name == "x" else 30.0


def _gap(axis: Any, a: float, b: float) -> float:
    """CSS px (96 per inch) between values ``a`` and ``b`` along ``axis``."""
    ax = axis.axes
    pa, pb = ax.transData.transform([(a, a), (b, b)])
    i = 0 if axis.axis_name == "x" else 1
    return float(abs(pa[i] - pb[i])) / float(ax.figure.dpi) * 96.0


def _stride(axis: Any) -> int:
    """Every n-th decade keeps its label so labels stay ``_space`` apart."""
    g = _gap(axis, 10.0, 1.0)
    return max(1, math.ceil(_space(axis) / g)) if g > 0 else 1


def _view(axis: Any) -> tuple[float, float]:
    lo, hi = sorted(float(v) for v in axis.get_view_interval())
    return lo, hi


def _grid(axis: Any, step: float | None) -> list[float]:
    """The screen's ``logGridSplits(fixedLogAxisSplits(view))``."""
    s = fixed_log_splits(*_view(axis), step)
    if _spans_decade(s) and (s[-1] / s[0] > 1e6 or _stride(axis) > 1):
        return [v for v in s if _decade_of(v) is not None]
    return s


class LogMajorLocator(Locator):
    """Decades on a decade view, every arithmetic tick on a sub-decade one.
    ``step`` is an Origin-decoded linear increment (``apply_tick_steps``)."""

    def __init__(self) -> None:
        self.step: float | None = None

    def tick_values(self, vmin: float, vmax: float) -> list[float]:
        return fixed_log_splits(min(vmin, vmax), max(vmin, vmax), self.step)

    def __call__(self) -> list[float]:
        if self.axis is None:
            return []
        s = _grid(self.axis, self.step)
        return [v for v in s if _decade_of(v) is not None] if _spans_decade(s) else s


class LogMinorLocator(Locator):
    """The 2-9 subdivisions a decade view keeps (see the module doc)."""

    def tick_values(self, vmin: float, vmax: float) -> list[float]:
        return []

    def __call__(self) -> list[float]:
        if self.axis is None:
            return []
        major = getattr(self.axis, "get_major_locator", lambda: None)()
        s = _grid(self.axis, getattr(major, "step", None))
        return [v for v in s if _decade_of(v) is None] if _spans_decade(s) else []


def _labelled(axis: Any) -> tuple[list[float], bool]:
    """The ticks that carry text, and whether the view is a decade view --
    the screen's ``logMajorTickFilter``."""
    s = _grid(axis, getattr(axis.get_major_locator(), "step", None))
    if _spans_decade(s):
        n = _stride(axis)
        return [v for v in s if (k := _decade_of(v)) is not None and k % n == 0], True
    kept: list[float] = []
    for v in s:
        if not kept or _gap(axis, v, kept[-1]) >= _space(axis):
            kept.append(v)
    return kept, False


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
    decides WHICH ticks carry text. On a decade view sci/eng drop their
    increment floor (every labelled mantissa is 1), as the screen's
    ``tickFormatter`` does, so the digits stay the same across decades."""

    def __init__(self, minor: bool, inner: Formatter | None = None) -> None:
        self.minor = minor
        self.inner = inner

    def set_axis(self, axis: Any) -> None:
        super().set_axis(axis)
        if self.inner is not None:
            self.inner.set_axis(axis)

    def __call__(self, x: float, pos: int | None = None) -> str:
        axis = self.axis
        if self.minor or axis is None or not hasattr(axis, "get_view_interval"):
            return ""
        kept, decades = _labelled(axis)
        if not any(abs(x - v) <= _EPS * abs(v) for v in kept):
            return ""
        gaps = [b - a for a, b in zip(kept, kept[1:], strict=False) if b > a]
        incr = min(gaps) if gaps else 0.0
        if isinstance(self.inner, _AxisTickFormatter):
            mantissa_one = decades and self.inner.mode in ("sci", "eng")
            return self.inner.text(x, 0.0 if mantissa_one else incr)
        if self.inner is not None:
            return str(self.inner(x, pos))
        if decades:
            k = _decade_of(x)
            if k is None:
                return ""
            return f"$\\mathdefault{{{10**k if k in (0, 1) else f'10^{{{k}}}'}}}$"
        return _plain(x, incr, kept[0], kept[-1])
