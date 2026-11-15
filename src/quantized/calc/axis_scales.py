"""The Axis dialog's extra scales and tick rules for matplotlib export (gap
audit 4 G17).

The export half of ``frontend/src/lib/axisScales.ts`` (the math) and
``lib/axisScaleExtras.ts`` (the canvas). Each rides the axis' ``AxisFormat``
mapping (``x_fmt`` / ``y_fmt`` / ``y2_fmt``), applied from
``calc.axis_extras``:

* ``base: "2"`` on a log axis -- Origin's "Log2": majors at powers of 2,
  thinned to every k-th power past 12, labelled with the number for
  2^-10..2^10 and ``2`` with a superscript exponent beyond.
* ``prob: "fraction" | "percent"`` on a linear axis -- Origin's
  "Probability" scale: positions by the normal quantile (probit) of a value
  in (0, 1) or (0, 100). Majors are Origin's standard list; the auto range
  runs out to the nearest of them around the in-domain data. A value off the
  domain is not drawn (NaN), never clamped onto the axis.
* ``custom: {"at": [...], "labels": [...]}`` -- explicit majors, labelled
  where a label is given (otherwise the axis' own number). Labels are
  literal text, as the canvas draws them: a ``$`` is escaped, never
  mathtext. A list with a repeated position is refused whole.

The axis crossing (``cross``) is ``calc.axis_cross``. The shared numbers are
pinned by ``tests/fixtures/wire/axis_scales.json`` from both suites.

Pure: matplotlib objects in, nothing returned; an absent or malformed field
leaves matplotlib's behaviour as it was.
"""

from __future__ import annotations

import math
import weakref
from collections.abc import Callable, Mapping, Sequence
from statistics import NormalDist
from typing import Any

import numpy as np
from matplotlib.ticker import Formatter, FuncFormatter, Locator, NullFormatter, NullLocator
from numpy.typing import NDArray

from quantized.heavy_import import heavy_imports

__all__ = [
    "PROB_TICKS_PCT",
    "apply_custom_ticks",
    "apply_scale_extras",
    "custom_ticks_in",
    "drawable_on",
    "in_prob_domain",
    "log2_label",
    "log2_ticks",
    "nice_step",
    "plain_label",
    "prob_auto_range",
    "prob_backward",
    "prob_forward",
    "prob_ticks",
    "prob_unit_of",
]

#: Origin's probability-axis majors, in percent.
PROB_TICKS_PCT: tuple[float, ...] = (
    0.01,
    0.1,
    1,
    5,
    10,
    20,
    30,
    40,
    50,
    60,
    70,
    80,
    90,
    95,
    99,
    99.9,
    99.99,
)
_EPS = 1e-9
_NORMAL = NormalDist()
_SUPERSCRIPT = str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹")
_PROB_AXES: weakref.WeakKeyDictionary[Any, str] = weakref.WeakKeyDictionary()


def _scale(unit: str) -> float:
    return 100.0 if unit == "percent" else 1.0


def in_prob_domain(v: float, unit: str) -> bool:
    """Is ``v`` inside the probability axis' open domain?"""
    return math.isfinite(v) and 0 < v < _scale(unit)


def prob_forward(v: float, unit: str) -> float:
    """A probability axis' position of ``v`` (NaN off the domain)."""
    return _NORMAL.inv_cdf(v / _scale(unit)) if in_prob_domain(v, unit) else math.nan


def prob_backward(z: float, unit: str) -> float:
    """The value at probability-axis position ``z``."""
    return _NORMAL.cdf(z) * _scale(unit) if math.isfinite(z) else math.nan


def prob_unit_of(axis: Any) -> str | None:
    """The unit :func:`apply_scale_extras` made ``axis`` a probability axis
    with, else None."""
    return _PROB_AXES.get(axis)


#: How far past the standard majors the auto range extends, by decades:
#: down to 1e-10 and up to 1 - 1e-10 (as a fraction).
PROB_MIN_DECADE = 10


def _decades(lo: float, hi: float, unit: str) -> list[float]:
    """Decade majors past the standard list (``10^-n`` and ``1 - 10^-n`` as a
    fraction, n = 5..PROB_MIN_DECADE) inside ``[lo, hi]``."""
    k = _scale(unit)
    out = []
    for n in range(5, PROB_MIN_DECADE + 1):
        for f in (float(f"1e-{n}"), 1 - float(f"1e-{n}")):
            v = _p12(f * k)
            if lo <= v <= hi and in_prob_domain(v, unit):
                out.append(v)
    return sorted(out)


def prob_auto_range(lo: float | None, hi: float | None, unit: str) -> tuple[float, float]:
    """The auto range over in-domain data ``[lo, hi]`` (None = none): out to
    the nearest standard majors, or past them by decades (to 1e-10 as a
    fraction) for data beyond 0.01 % or 99.99 % (the screen's ``probAutoRange``)."""
    k = _scale(unit)
    std = [t / 100 * k for t in PROB_TICKS_PCT]
    if lo is None or hi is None:
        return std[0], std[-1]
    a = std[0]
    for t in std:
        if t <= lo * (1 + _EPS):
            a = t
    b = std[-1]
    for t in reversed(std):
        if t >= hi * (1 - _EPS):
            b = t
    floor = float(f"1e-{PROB_MIN_DECADE}")
    # Data past 0.01 % / 99.99 %: out by whole decades, never past 1e-10.
    if lo < std[0]:
        a = _p12(max(floor, float(f"1e{math.floor(math.log10(lo / k) + _EPS)}")) * k)
    if hi > std[-1]:
        b = _p12((1 - max(floor, float(f"1e{math.floor(math.log10(1 - hi / k) + _EPS)}"))) * k)
    if not b > a:
        i = std.index(a)
        return std[max(0, i - 1)], std[min(len(std) - 1, i + 1)]
    return a, b


def nice_step(raw: float) -> float:
    """1, 2 or 5 x 10^n at or above ``raw`` (the screen's ``niceStep``)."""
    if not raw > 0 or not math.isfinite(raw):
        return 1.0
    mag = float(f"1e{math.floor(math.log10(raw))}")
    n = raw / mag
    return (1 if n <= 1 + _EPS else 2 if n <= 2 + _EPS else 5 if n <= 5 + _EPS else 10) * mag


def _p12(v: float) -> float:
    """``Number(v.toPrecision(12))``."""
    return float(f"{v:.12g}")


def prob_ticks(vmin: float, vmax: float, unit: str) -> list[float]:
    """The majors inside ``[vmin, vmax]``: the standard ones, or -- on a view
    too narrow to hold two -- even steps of the value."""
    lo, hi = min(vmin, vmax), max(vmin, vmax)
    k = _scale(unit)

    def inside(v: float) -> bool:
        return lo - _EPS * k <= v <= hi + _EPS * k and in_prob_domain(v, unit)

    std = [v for v in (_p12(t / 100 * k) for t in PROB_TICKS_PCT) if inside(v)]
    std = sorted([*_decades(lo - _EPS * k, hi + _EPS * k, unit), *std])
    if len(std) >= 2 or not hi > lo:
        return std
    step = nice_step((hi - lo) / 4)
    out: list[float] = []
    for n in range(math.ceil(lo / step - _EPS), math.floor(hi / step + _EPS) + 1):
        v = _p12(n * step)
        if inside(v):
            out.append(v)
    return out


def plain_label(v: float, _pos: int | None = None) -> str:
    """A plain number label: JavaScript's ``String(Number(v.toPrecision(12)))``,
    the screen's ``plainLabel`` (positional from 1e-6 to 1e21, else
    exponent notation with no padded exponent)."""
    x = _p12(v)
    if x == 0:
        return "0"
    if 1e-6 <= abs(x) < 1e21:
        return str(np.format_float_positional(x, trim="-"))
    mant, exp = repr(x).split("e")
    return f"{mant.removesuffix('.0')}e{'-' if exp[0] == '-' else '+'}{int(exp[1:])}"


def log2_ticks(vmin: float, vmax: float) -> list[float]:
    """Powers of 2 in ``[vmin, vmax]``, every k-th once more than 12."""
    if not vmin > 0 or not vmax > vmin:
        return []
    k0 = math.ceil(math.log2(vmin) - _EPS)
    k1 = math.floor(math.log2(vmax) + _EPS)
    if k1 - k0 < 1:
        # Fewer than two powers of 2 in view: even steps of the value.
        step = nice_step((vmax - vmin) / 4)
        rng = range(math.ceil(vmin / step - _EPS), math.floor(vmax / step + _EPS) + 1)
        return [v for v in (_p12(n * step) for n in rng) if v > 0]
    every = max(1, math.ceil((k1 - k0 + 1) / 12))
    start = math.ceil(k0 / every) * every
    return [2.0**k for k in range(start, k1 + 1, every)]


def log2_label(v: float, _pos: int | None = None) -> str:
    """A log2 major's label (the screen's ``log2Label``)."""
    if not v > 0:
        return ""
    k = round(math.log2(v))
    # Only an exact power of 2 takes the 2^k form: 3000 is not "2¹²".
    exact = abs(math.log2(v) - k) < 1e-9
    return plain_label(v) if abs(k) <= 10 or not exact else "2" + str(k).translate(_SUPERSCRIPT)


def drawable_on(v: float, scale: str, fmt: Mapping[str, Any] | None) -> bool:
    """Can an axis of ``scale`` with format ``fmt`` draw ``v`` at all?"""
    if not math.isfinite(v):
        return False
    if scale in ("log", "reciprocal"):
        return v > 0
    prob = (fmt or {}).get("prob")
    if scale == "linear" and prob in ("fraction", "percent"):
        return in_prob_domain(v, str(prob))
    return True


def _custom(raw: Any) -> tuple[list[float], list[str]] | None:
    """``raw`` as valid custom ticks, else None -- refused whole, as the
    screen's ``normalizeCustomTicks`` refuses it."""
    if not isinstance(raw, Mapping):
        return None
    at = raw.get("at")
    labels = raw.get("labels") or []
    if not isinstance(at, list) or not 0 < len(at) <= 50:
        return None
    finite = (
        isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in at
    )
    if not all(finite):
        return None
    if not isinstance(labels, list) or len(labels) > len(at):
        return None
    if not all(isinstance(s, str) for s in labels):
        return None
    if len(set(at)) != len(at):
        return None  # a repeated position: which label is meant is ambiguous
    return [float(v) for v in at], [str(s) for s in labels]


def custom_ticks_in(
    raw: Any, vmin: float, vmax: float, ok: Callable[[float], bool]
) -> tuple[list[float], list[str | None]]:
    """The custom majors inside ``[vmin, vmax]`` that ``ok`` admits, sorted,
    with their labels (None = the axis' own number)."""
    parsed = _custom(raw)
    if parsed is None:
        return [], []
    at, labels = parsed
    lo, hi = min(vmin, vmax), max(vmin, vmax)
    tol = (hi - lo) * _EPS
    pairs = sorted(
        (
            (v, labels[i] if i < len(labels) and labels[i].strip() else None)
            for i, v in enumerate(at)
            if lo - tol <= v <= hi + tol and ok(v)
        ),
        key=lambda p: p[0],
    )
    return [p[0] for p in pairs], [p[1] for p in pairs]


class _FuncLocator(Locator):
    """Majors from a ``(vmin, vmax) -> ticks`` rule over the view."""

    def __init__(self, rule: Callable[[float, float], Sequence[float]]) -> None:
        self.rule = rule

    def tick_values(self, vmin: float, vmax: float) -> list[float]:
        return list(self.rule(min(vmin, vmax), max(vmin, vmax)))

    def __call__(self) -> list[float]:
        if self.axis is None:
            return []
        vmin, vmax = self.axis.get_view_interval()
        return self.tick_values(vmin, vmax)


def _in_domain_values(ax: Any, which: str, unit: str) -> NDArray[np.float64]:
    # Function-level: figure_autoscale -> figure_ticks -> axis_extras imports
    # this module, so a top-level import would be a cycle.
    with heavy_imports("quantized.calc.figure_autoscale"):
        from quantized.calc.figure_autoscale import _values  # shares the scan

    pts, _ends = _values([ax], 0 if which == "x" else 1)
    k = _scale(unit)
    return np.asarray(pts[(pts > 0) & (pts < k)], dtype=float)


def _apply_prob(ax: Any, which: str, axis: Any, unit: str) -> None:
    pts = _in_domain_values(ax, which, unit)
    lo, hi = prob_auto_range(
        float(pts.min()) if pts.size else None, float(pts.max()) if pts.size else None, unit
    )

    with heavy_imports("scipy.special"):
        from scipy.special import ndtr, ndtri
    k = _scale(unit)

    def fwd(v: Any) -> NDArray[np.float64]:
        arr = np.asarray(v, dtype=float)
        ok = (arr > 0) & (arr < k)
        safe = np.where(ok, arr / k, 0.5)
        return np.asarray(np.where(ok, ndtri(safe), np.nan), dtype=float)

    def bwd(z: Any) -> NDArray[np.float64]:
        return np.asarray(ndtr(np.asarray(z, dtype=float)) * k, dtype=float)

    (ax.set_xscale if which == "x" else ax.set_yscale)("function", functions=(fwd, bwd))
    axis.set_major_locator(_FuncLocator(lambda a, b: prob_ticks(a, b, unit)))
    axis.set_major_formatter(FuncFormatter(plain_label))
    axis.set_minor_locator(NullLocator())
    axis.set_minor_formatter(NullFormatter())
    (ax.set_xlim if which == "x" else ax.set_ylim)(lo, hi)
    _PROB_AXES[axis] = unit


def apply_scale_extras(ax: Any, which: str, axis: Any, scale: str, fmt: Mapping[str, Any]) -> str:
    """Apply ``fmt``'s log2 or probability scale to ``ax``'s ``which`` axis;
    returns the drawn scale ("probit" for a probability axis)."""
    if scale == "log" and fmt.get("base") == "2":
        axis.set_major_locator(_FuncLocator(log2_ticks))
        axis.set_major_formatter(FuncFormatter(log2_label))
        axis.set_minor_locator(NullLocator())
        axis.set_minor_formatter(NullFormatter())
    prob = fmt.get("prob")
    if scale == "linear" and prob in ("fraction", "percent"):
        _apply_prob(ax, which, axis, str(prob))
        return "probit"
    return scale


class _CustomFormatter(Formatter):
    """The custom labels, else the axis' own formatter's number."""

    def __init__(self, inner: Formatter, labels: dict[float, str]) -> None:
        self.inner = inner
        self.labels = labels

    def set_axis(self, axis: Any) -> None:
        super().set_axis(axis)
        self.inner.set_axis(axis)

    def set_locs(self, locs: Any) -> None:
        super().set_locs(locs)
        self.inner.set_locs(locs)

    def __call__(self, x: float, pos: int | None = None) -> str:
        label = self.labels.get(float(x))
        # The screen draws a label as literal text: a "$" is not mathtext here.
        return label.replace("$", r"\$") if label is not None else str(self.inner(x, pos))

    def get_offset(self) -> str:
        return str(self.inner.get_offset())


def apply_custom_ticks(
    axis: Any, fmt: Mapping[str, Any], scale: str, skip: Callable[[float], bool]
) -> None:
    """Install ``fmt``'s custom majors (after divide-by, so a label replaces
    the divided number), dropping any the scale cannot draw or ``skip``
    refuses (inside an axis break)."""
    raw = fmt.get("custom")
    if _custom(raw) is None:
        return
    base = "linear" if scale == "probit" else scale

    def ok(v: float) -> bool:
        return drawable_on(v, base, fmt) and not skip(v)

    at, labels = custom_ticks_in(raw, -math.inf, math.inf, ok)
    axis.set_major_locator(_FuncLocator(lambda a, b: custom_ticks_in(raw, a, b, ok)[0]))
    named = {v: lab for v, lab in zip(at, labels, strict=True) if lab is not None}
    axis.set_major_formatter(_CustomFormatter(axis.get_major_formatter(), named))
