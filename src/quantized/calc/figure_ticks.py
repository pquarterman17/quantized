"""Axis tick-label FORMATTING for matplotlib export (MAIN #24) -- mirrors the
on-screen `AxisFormat` contract (`frontend/src/lib/uplotOpts.ts`'s
`tickFormatter` + `frontend/src/lib/ticks.ts`'s `decimalsForIncrement`) so a
published figure's tick labels read exactly like the interactive plot's.
Pure layer, split out of ``calc.figure`` purely to stay under the 500-line
god-module ceiling (mirrors ``figure_scale``/``figure_break``/``figure_overrides``).

``AxisFormat`` is ``{mode: "auto"|"fixed"|"sci"|"eng", digits: number}``:
``auto`` returns ``None`` here (matplotlib's own default formatter stays,
unlike the frontend's own Intl-based ``auto`` formatter -- the two rendering
engines don't need byte-identical ``auto`` output, only the explicit
fixed/sci/eng modes the owner can actually configure per axis). ``fixed``/
``sci``/``eng`` each floor their configured ``digits`` at whatever the DRAWN
tick increment needs (screen-side ``decimalsForIncrement``/
``mantissaDecimalFloor``), the same "never render two different ticks with
the same label" guarantee MAIN #20 fixed on-screen.

matplotlib has no direct equivalent of uPlot's ``values(u, splits, ...,
foundIncr)`` callback (which receives the increment its own tick generator
just found). A tick label is instead built one at a time by a
``Formatter.__call__(x, pos)``, with no increment argument at all.
``_AxisTickFormatter`` below is a ``matplotlib.ticker.Formatter`` subclass
(not a plain ``FuncFormatter`` closure) so it can read ``self.axis`` (set by
``Axis.set_major_formatter``) and pull ``self.axis.get_majorticklocs()``
LAZILY, INSIDE ``__call__`` -- at draw time, after the axis's locator has
committed to its final tick positions. A ``FuncFormatter`` closure computed
once when the formatter is attached would instead capture whatever ticks
existed at THAT moment, which ``tight_layout``/``savefig`` can still revise
before the real draw -- the locator-aware subclass approach is robust to
matplotlib recomputing ticks between attachment and draw.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from matplotlib.ticker import Formatter, MultipleLocator

__all__ = ["apply_tick_formats", "apply_tick_steps", "axis_tick_formatter"]

_MODES = ("fixed", "sci", "eng", "date", "time", "datetime")


def _pow10(k: int) -> float:
    """Exact ``10**k`` for integer ``k`` via decimal-literal parsing --
    mirrors the frontend's ``pow10`` (``lib/ticks.ts``), which exists because
    ``Math.pow(10, k)`` is not guaranteed correctly rounded; both Python's
    ``float()`` and JS's ``Number()`` ARE required to correctly round a
    parsed decimal literal, so this stays exact on every platform."""
    return float(f"1e{k}")


def _js_round(v: float) -> int:
    """``Math.round`` semantics (round half AWAY FROM negative infinity, i.e.
    half rounds up) -- Python's builtin ``round`` is round-half-to-EVEN, which
    disagrees with JS at exact X.5 digit counts. Only the sign/tie-break at
    ``.5`` differs; both agree everywhere else."""
    return math.floor(v + 0.5)


def _decimals_for_increment(incr: float, max_decimals: int = 20) -> int:
    """Port of the frontend's ``decimalsForIncrement`` (``lib/ticks.ts``):
    the decimal-place FLOOR a fixed-decimal tick formatter must never go
    below, so ticks ``incr`` apart never collapse to the same label. Starts
    from the log10 order of magnitude, then round-trips (format -> parse ->
    compare) upward for "nice" non-power-of-10 steps whose exact decimal form
    needs a digit or two more than ``-log10(incr)`` alone implies."""
    if not (incr > 0) or not math.isfinite(incr):
        return 0
    d = max(0, min(max_decimals, math.ceil(-math.log10(incr) - 1e-9)))
    tol = max(incr * 1e-6, 1e-15)
    while d < max_decimals and abs(float(f"{incr:.{d}f}") - incr) > tol:
        d += 1
    return d


def _mantissa_decimal_floor(incr: float, exp: int) -> int:
    """Port of ``mantissaDecimalFloor``: ``incr`` rescaled into the
    mantissa's own units (divided by the value's own ``10**exp``) before
    flooring -- used by the sci/eng formatters below."""
    return _decimals_for_increment(incr / _pow10(exp)) if incr > 0 else 0


def _splits_increment(locs: Any) -> float:
    """Smallest positive gap between the axis's CURRENT major tick
    locations -- port of the frontend's ``splitsIncrement``, minus its
    uPlot-specific ``foundIncr`` fallback (matplotlib's Locator/Formatter
    split has no equivalent second value fed to the formatter). A
    degenerate axis (fewer than 2 finite ticks) returns 0, which floors
    nothing (``max(digits, 0) == digits``) -- the same degenerate-range
    behaviour the frontend documents for ``decimalsForIncrement``."""
    vals = sorted(v for v in locs if math.isfinite(v))
    incr = math.inf
    for a, b in zip(vals, vals[1:], strict=False):
        gap = b - a
        if 0 < gap < incr:
            incr = gap
    return incr if math.isfinite(incr) else 0.0


def _strip_neg_zero(formatted: str) -> str:
    """Port of ``stripNegZero``: a legitimately non-zero split (e.g.
    ``-0.00003``) can still format as "-0"/"-0.00"/"-0.00e+0" once rounded to
    the tick's display precision -- never meaningful data (MAIN #20, the
    owner's screenshot showed a bare "-0" tick on a dense M-H moment axis)."""
    if not formatted.startswith("-"):
        return formatted
    bare = formatted[1:]
    try:
        return bare if float(bare) == 0 else formatted
    except ValueError:
        return formatted


def _to_exponential(v: float, d: int) -> str:
    """``v.toExponential(d)`` equivalent, in the frontend's plain (no rich
    ``x10^n`` markup) shape: ``1.20e-3`` / ``1.20e+3`` -- NOT Python's own
    zero-padded ``%e`` shape (``1.20e-03``). Python's ``%e`` formatting is
    itself correctly rounded (it normalizes a mantissa that rounds up to 10
    into the next exponent automatically, the same guarantee JS's
    ``Number.prototype.toExponential`` makes), so this only reformats its
    exponent -- no zero-padding, explicit sign -- rather than re-deriving the
    mantissa by hand."""
    mantissa, exp_str = f"{v:.{d}e}".split("e")
    exp = int(exp_str)
    return f"{mantissa}e{'+' if exp >= 0 else '-'}{abs(exp)}"


def _format_fixed(v: float, digits: int, incr: float) -> str:
    d = max(digits, _decimals_for_increment(incr))
    return _strip_neg_zero(f"{v:.{min(20, d)}f}")


def _format_sci(v: float, digits: int, incr: float) -> str:
    exp = 0 if v == 0 else math.floor(math.log10(abs(v)))
    d = max(digits, _mantissa_decimal_floor(incr, exp))
    return _strip_neg_zero(_to_exponential(v, min(20, d)))


def _format_eng(v: float, digits: int, incr: float) -> str:
    """Engineering notation: mantissa in [1, 1000), exponent a multiple of 3
    (e.g. ``1.2e-3``, ``12.3e-6``) -- port of the frontend's ``formatEng``.
    ``v == 0`` has no meaningful exponent, so it renders bare "0". A mantissa
    that rounds up to >= 1000 bumps the exponent by 3 and re-divides."""
    if v == 0:
        return "0"
    sign = "-" if v < 0 else ""
    av = abs(v)
    exp = math.floor(math.floor(math.log10(av)) / 3) * 3
    d = min(20, max(digits, _mantissa_decimal_floor(incr, exp)))
    mantissa = av / _pow10(exp)
    m_str = f"{mantissa:.{d}f}"
    if float(m_str) >= 1000:
        exp += 3
        mantissa = av / _pow10(exp)
        m_str = f"{mantissa:.{d}f}"
    exp_str = f"+{exp}" if exp >= 0 else str(exp)
    return _strip_neg_zero(f"{sign}{m_str}e{exp_str}")


class _AxisTickFormatter(Formatter):
    """A ``matplotlib.ticker.Formatter`` for one non-``auto`` ``AxisFormat``
    mode. See the module doc for why this is a ``Formatter`` subclass
    (reading ``self.axis`` lazily) rather than a ``FuncFormatter`` closure."""

    def __init__(self, mode: str, digits: float) -> None:
        self.mode = mode
        self.digits = max(0, min(20, _js_round(digits)))

    def __call__(self, x: float, pos: int | None = None) -> str:
        if self.mode in ("date", "time", "datetime"):
            stamp = datetime.fromtimestamp(x, tz=UTC)
            if self.mode == "date":
                return stamp.strftime("%Y-%m-%d")
            if self.mode == "time":
                return stamp.strftime("%H:%M:%S")
            return stamp.strftime("%Y-%m-%d %H:%M")
        # `self.axis` is typed as a union of matplotlib's real `Axis` and two
        # internal placeholder types (`_DummyAxis`/`_AxisWrapper`) that don't
        # declare `get_majorticklocs` -- getattr-with-default sidesteps the
        # union-attr mismatch; a placeholder axis (never seen in practice,
        # only used by matplotlib internals for detached artists) just skips
        # the increment floor, same as the "no axis attached yet" case.
        get_locs = getattr(self.axis, "get_majorticklocs", None)
        locs = get_locs() if callable(get_locs) else ()
        incr = _splits_increment(locs)
        if self.mode == "sci":
            return _format_sci(x, self.digits, incr)
        if self.mode == "eng":
            return _format_eng(x, self.digits, incr)
        return _format_fixed(x, self.digits, incr)


def axis_tick_formatter(fmt: Mapping[str, Any] | None) -> Formatter | None:
    """Build a matplotlib tick ``Formatter`` from an ``AxisFormat``-shaped
    mapping (``{"mode": ..., "digits": ...}``). ``None``/an ``"auto"`` mode
    returns ``None`` -- matplotlib's own default formatter stays untouched,
    the same "no override" contract ``apply_axis_scale``'s callers rely on
    for ``"linear"``."""
    if not fmt:
        return None
    mode = fmt.get("mode", "auto")
    if mode not in _MODES:
        return None
    digits = fmt.get("digits", 2)
    return _AxisTickFormatter(str(mode), float(digits))


def apply_tick_formats(
    ax: Any, x_fmt: Mapping[str, Any] | None, y_fmt: Mapping[str, Any] | None
) -> None:
    """Apply ``x_fmt``/``y_fmt`` (``AxisFormat``-shaped mappings) to ``ax``'s
    x/y major tick formatter, when non-``auto``. The single application
    chokepoint shared by ``figure.draw_series_axes`` (single-figure export +
    figure-page panels) and ``figure_break.render_breaks_impl`` (broken-axis
    panels) -- MAIN #24."""
    xf = axis_tick_formatter(x_fmt)
    if xf is not None:
        ax.xaxis.set_major_formatter(xf)
    yf = axis_tick_formatter(y_fmt)
    if yf is not None:
        ax.yaxis.set_major_formatter(yf)


def apply_tick_steps(
    ax: Any,
    x_step: float | None,
    y_step: float | None,
    x_scale: str,
    y_scale: str,
) -> None:
    """Apply saved major-tick increments to linear axes only.

    Origin's decoded ``from/to/step`` triples carry a linear increment. Log
    axes retain their scale-specific locator; reciprocal axes have their own
    locator. Invalid or absent increments leave matplotlib's locator intact.
    ``MultipleLocator`` anchors ticks at integer multiples of the step, the
    same convention as the interactive ``fixedLinearAxisSplits`` helper.
    """
    def apply_one(axis: Any, limits: tuple[float, float], step: float | None) -> None:
        if step is None or not math.isfinite(step) or step <= 0:
            return
        span = abs(float(limits[1]) - float(limits[0]))
        if not math.isfinite(span) or span / step > 1000:
            return
        axis.set_major_locator(MultipleLocator(float(step)))

    if x_scale == "linear":
        apply_one(ax.xaxis, ax.get_xlim(), x_step)
    if y_scale == "linear":
        apply_one(ax.yaxis, ax.get_ylim(), y_step)
