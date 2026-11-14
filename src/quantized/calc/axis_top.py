"""The top (secondary) X axis of the Axis dialog (gap-audit-2 #5).

A second X axis along the top of the plot whose labels show a transform of
the bottom axis: ``reciprocal`` (``factor / x``: 1/T, 1000/T), ``dspacing``
(Bragg ``d = wavelength / (2 sin(x/2))`` for x = 2-theta in degrees) or
``linear`` (``factor * x + shift``) or ``expr`` (any expression ``f(x)`` of the
bottom axis -- ``1240/x``, ``sqrt(x)`` -- parsed without ``eval`` by
``calc.axis_expr``; only the longest finite, strictly monotonic stretch of the
bottom axis is labelled, so a range through a pole labels its valid side).

A line-for-line port of ``frontend/src/lib/axisTop.ts`` so the screen and the
export pick the SAME tick values and labels (``tests/test_axis_top.py`` and
``axisTop.test.ts`` share one table). :func:`apply_top_axis` draws it on a
matplotlib Axes. Pure: mapping in, matplotlib objects mutated.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from functools import lru_cache
from typing import Any

import numpy as np
from matplotlib.ticker import Formatter, Locator

from quantized.calc.axis_expr import compile_expr

__all__ = [
    "apply_top_axis",
    "nice_ticks",
    "top_forward",
    "top_inverse",
    "top_label",
    "top_span",
    "top_ticks",
]

TOP_TICK_TARGET = 8
# Closest two top-axis labels may sit, as a fraction of the axis length.
TOP_MIN_GAP = 0.05
# Where a transform is undefined at one end of the axis (1/x at 0, d-spacing at
# 0 or 180 deg), the lower end of the drawn part starts this fraction of the
# upper end above it. Mirrors TOP_SPAN_FLOOR in frontend/src/lib/axisTop.ts.
TOP_SPAN_FLOOR = 0.01
_DEG = math.pi / 180
_DSPACING_MAX = 179.99
# An ``expr`` axis samples the bottom axis this many times to find its valid,
# monotonic stretch; mirrors EXPR_SAMPLES in axisTop.ts.
EXPR_SAMPLES = 400
# ... and trims a same-sign stretch to at most this change in magnitude (the end
# next to a pole is cut back), so ticks do not crowd where the value explodes.
EXPR_MAX_RATIO = 20.0
_EXPR_BISECT = 80


def _f(top: Mapping[str, Any], key: str, default: float) -> float:
    v = top.get(key)
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else default


def _expr(top: Mapping[str, Any]) -> Callable[[float], float] | None:
    src = top.get("expr")
    return _compiled(src) if isinstance(src, str) else None


@lru_cache(maxsize=64)
def _compiled(src: str) -> Callable[[float], float] | None:
    try:
        return compile_expr(src)
    except ValueError:
        return None


def _expr_span(fn: Callable[[float], float], lo: float, hi: float) -> tuple[float, float] | None:
    """The longest stretch of [lo, hi] (sampled) where ``fn`` is finite and
    strictly monotonic; a tie keeps the later one (the positive side of a pole)."""
    if not (math.isfinite(lo) and math.isfinite(hi) and hi > lo):
        return None
    n = EXPR_SAMPLES
    xs = [lo + (hi - lo) * i / (n - 1) for i in range(n)]
    ys = [fn(x) for x in xs]
    best: tuple[float, float] | None = None
    start, direction = 0, 0
    for i in range(1, n + 1):
        d = 0
        if i < n and math.isfinite(ys[i]) and math.isfinite(ys[i - 1]):
            d = (ys[i] > ys[i - 1]) - (ys[i] < ys[i - 1])
        if i < n and d != 0 and (direction in (0, d)):
            direction = d
            continue
        if i - 1 > start and (best is None or xs[i - 1] - xs[start] >= best[1] - best[0]):
            best = (xs[start], xs[i - 1])
        start, direction = (i - 1, d) if d != 0 else (i, 0)
    return _trim_to_ratio(fn, best) if best else None


def _trim_to_ratio(fn: Callable[[float], float], span: tuple[float, float]) -> tuple[float, float]:
    lo, hi = span
    flo, fhi = fn(lo), fn(hi)
    if not flo * fhi > 0:
        return span
    big_is_lo = abs(flo) > abs(fhi)
    cap = EXPR_MAX_RATIO * min(abs(flo), abs(fhi))
    if max(abs(flo), abs(fhi)) <= cap:
        return span
    a, c = (lo, hi) if big_is_lo else (hi, lo)  # |f(a)| > cap >= |f(c)|
    for _ in range(_EXPR_BISECT):
        mid = (a + c) / 2
        if abs(fn(mid)) > cap:
            a = mid
        else:
            c = mid
    return (c, hi) if big_is_lo else (lo, c)


def _expr_inverse(fn: Callable[[float], float], t: float, span: tuple[float, float]) -> float:
    lo, hi = span
    flo, fhi = fn(lo), fn(hi)
    if not (math.isfinite(t) and min(flo, fhi) <= t <= max(flo, fhi)):
        return math.nan
    rising = fhi > flo
    for _ in range(_EXPR_BISECT):
        mid = (lo + hi) / 2
        if (fn(mid) < t) == rising:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def top_forward(top: Mapping[str, Any], x: float) -> float:
    """x -> the top axis' value, or NaN outside the transform's domain."""
    if top.get("kind") == "expr":
        fn = _expr(top)
        return fn(x) if fn else math.nan
    factor = _f(top, "factor", 1.0)
    kind = top.get("kind")
    if kind == "reciprocal":
        return math.nan if x == 0 else factor / x
    if kind == "linear":
        return factor * x + _f(top, "shift", 0.0)
    lam = _f(top, "wavelength", math.nan)
    return lam / (2 * math.sin((x / 2) * _DEG)) if 0 < x < 180 else math.nan


def _inverse_on(top: Mapping[str, Any], t: float, span: tuple[float, float] | None) -> float:
    fn = _expr(top)
    return _expr_inverse(fn, t, span) if fn and span else math.nan


def top_inverse(top: Mapping[str, Any], t: float, rng: tuple[float, float] | None = None) -> float:
    """The top axis' value -> x, or NaN outside the domain. An ``expr`` axis is
    inverted numerically inside the valid stretch of the bottom range ``rng``."""
    if top.get("kind") == "expr":
        return _inverse_on(top, t, top_span(top, *rng) if rng else None)
    factor = _f(top, "factor", 1.0)
    kind = top.get("kind")
    if kind == "reciprocal":
        return math.nan if t == 0 else factor / t
    if kind == "linear":
        return math.nan if factor == 0 else (t - _f(top, "shift", 0.0)) / factor
    if not t > 0:
        return math.nan
    r = _f(top, "wavelength", math.nan) / (2 * t)
    return (2 * math.asin(r)) / _DEG if r <= 1 else math.nan


def top_span(top: Mapping[str, Any], lo: float, hi: float) -> tuple[float, float] | None:
    """The part of the bottom axis [lo, hi] where the transform is finite and
    monotonic, or ``None`` when no part is (1/x needs x > 0; d-spacing needs
    0 < x < 180). A range that runs into the singularity keeps only its valid
    side, starting a small fraction of the way in so the mapped range is finite."""
    lo, hi = float(min(lo, hi)), float(max(lo, hi))
    kind = top.get("kind")
    if kind == "linear":
        return (lo, hi)
    if kind == "expr":
        fn = _expr(top)
        return _expr_span(fn, lo, hi) if fn else None
    if kind == "reciprocal":
        top_hi = hi
    elif kind == "dspacing":
        top_hi = min(hi, _DSPACING_MAX)
    else:
        return None
    if not (math.isfinite(lo) and math.isfinite(top_hi)) or top_hi <= 0 or lo >= top_hi:
        return None
    return (lo if lo > 0 else top_hi * TOP_SPAN_FLOOR, top_hi)


def nice_ticks(a: float, b: float, target: int = TOP_TICK_TARGET) -> tuple[list[float], int]:
    """Nice tick values covering [a, b]: steps of 1, 2, 2.5 or 5 times a power
    of ten, about ``target`` of them, and the decimals their labels need."""
    lo, hi = min(a, b), max(a, b)
    if not (math.isfinite(lo) and math.isfinite(hi) and hi > lo):
        return [], 0
    raw = (hi - lo) / target
    exp = math.floor(math.log10(raw))
    mag = 10.0**exp
    mult = next((m for m in (1, 2, 2.5, 5, 10) if m * mag >= raw * (1 - 1e-9)), 10)
    step = mult * mag
    decimals = max(0, -exp + (1 if mult == 2.5 else 0) - (1 if mult == 10 else 0))
    values = [
        float(f"{k * step:.12g}")
        for k in range(math.ceil(lo / step - 1e-9), math.floor(hi / step + 1e-9) + 1)
    ]
    return values, min(decimals, 12)


def top_label(value: float, decimals: int) -> str:
    """A tick label: ``value`` to ``decimals`` places, never ``-0``."""
    s = f"{value:.{decimals}f}"
    return s[1:] if s.startswith("-") and float(s) == 0 else s


def top_ticks(top: Mapping[str, Any], lo: float, hi: float) -> list[tuple[float, float, str]]:
    """``(position in x, value, label)`` per tick for a bottom axis showing
    [lo, hi]; only the part of the axis inside the transform's domain gets ticks, and
    none when no part does."""
    lo, hi = min(lo, hi), max(lo, hi)
    valid = top_span(top, lo, hi)
    if valid is None:
        return []
    span = hi - lo  # label spacing is measured on the whole axis
    values, decimals = nice_ticks(top_forward(top, valid[0]), top_forward(top, valid[1]))
    lo, hi = valid
    out = []
    for value in values:
        pos = (
            _inverse_on(top, value, valid) if top.get("kind") == "expr" else top_inverse(top, value)
        )
        if math.isfinite(pos) and lo - span * 1e-9 <= pos <= hi + span * 1e-9:
            out.append((pos, value, top_label(value, decimals)))
    out.sort()
    # Keep a tick only when it sits at least TOP_MIN_GAP of the axis from the
    # last kept one, so labels never overlap (mirrors frontend axisTop.ts).
    kept: list[tuple[float, float, str]] = []
    for tick in out:
        if not kept or tick[0] - kept[-1][0] >= span * TOP_MIN_GAP - span * 1e-9:
            kept.append(tick)
    return kept


class _TopLocator(Locator):
    """The secondary axis' ticks, recomputed from the PRIMARY axis' limits."""

    def __init__(self, ax: Any, top: Mapping[str, Any]) -> None:
        self.ax = ax
        self.top = top
        self.labels: dict[float, str] = {}
        self.sec: Any = None

    def __call__(self) -> list[float]:
        lo, hi = self.ax.get_xlim()
        ticks = top_ticks(self.top, lo, hi)
        if self.sec is not None:  # nothing valid to show: no axis, no title
            self.sec.set_visible(top_span(self.top, lo, hi) is not None)
        self.labels = {value: label for _pos, value, label in ticks}
        return [value for _pos, value, _label in ticks]


class _TopFormatter(Formatter):
    def __init__(self, locator: _TopLocator) -> None:
        self.locator = locator

    def __call__(self, x: float, pos: int | None = None) -> str:
        labels = self.locator.labels
        if not labels:
            return ""
        nearest = min(labels, key=lambda v: abs(v - x))
        return labels[nearest] if abs(nearest - x) <= 1e-9 * max(1.0, abs(x)) else ""


def _clamped(ax: Any, top: Mapping[str, Any], fn: Any, *, forward: bool) -> Any:
    """``fn`` with its argument kept inside the valid part of the primary
    axis (read lazily from its limits), so matplotlib always maps the limits
    to finite numbers. With no valid part the axis is hidden and x passes through."""

    def apply(v: float) -> float:
        valid = top_span(top, *ax.get_xlim())
        if valid is None:
            return v
        return float(fn(min(max(v, valid[0]), valid[1])) if forward else fn(v))

    return apply


def _vectorize(fn: Any) -> Any:
    def apply(values: Any) -> Any:
        arr = np.asarray(values, dtype=float)
        with np.errstate(all="ignore"):
            return np.vectorize(fn, otypes=[float])(arr) if arr.size else arr

    return apply


def apply_top_axis(
    ax: Any, top: Mapping[str, Any] | None, *, label_size: float | None = None
) -> Any:
    """Add the top axis ``top`` describes to ``ax``; returns it (or ``None``
    when ``top`` is absent or cannot be drawn)."""
    if not top or top.get("kind") not in ("reciprocal", "dspacing", "linear", "expr"):
        return None
    if top.get("kind") == "expr" and _expr(top) is None:
        return None
    if top.get("kind") == "dspacing" and not _f(top, "wavelength", 0.0) > 0:
        return None
    if top.get("kind") not in ("dspacing", "expr") and _f(top, "factor", 1.0) == 0:
        return None
    inverse = (
        (lambda t: _inverse_on(top, t, top_span(top, *ax.get_xlim())))
        if top.get("kind") == "expr"
        else (lambda t: top_inverse(top, t))
    )
    sec = ax.secondary_xaxis(
        "top",
        functions=(
            _vectorize(_clamped(ax, top, lambda x: top_forward(top, x), forward=True)),
            _vectorize(_clamped(ax, top, inverse, forward=False)),
        ),
    )
    locator = _TopLocator(ax, top)
    locator.sec = sec
    sec.xaxis.set_major_locator(locator)
    sec.xaxis.set_major_formatter(_TopFormatter(locator))
    sec.xaxis.set_minor_locator(_NoTicks())
    title = top.get("title")
    if isinstance(title, str) and title:
        sec.set_xlabel(title)
    if label_size is not None:
        sec.tick_params(labelsize=label_size)
    return sec


class _NoTicks(Locator):
    def __call__(self) -> list[float]:
        return []
