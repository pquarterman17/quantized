"""The top (secondary) X axis of the Axis dialog (gap-audit-2 #5).

A second X axis along the top of the plot whose labels show a transform of
the bottom axis: ``reciprocal`` (``factor / x``: 1/T, 1000/T), ``dspacing``
(Bragg ``d = wavelength / (2 sin(x/2))`` for x = 2-theta in degrees) or
``linear`` (``factor * x + shift``).

A line-for-line port of ``frontend/src/lib/axisTop.ts`` so the screen and the
export pick the SAME tick values and labels (``tests/test_axis_top.py`` and
``axisTop.test.ts`` share one table). :func:`apply_top_axis` draws it on a
matplotlib Axes. Pure: mapping in, matplotlib objects mutated.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

import numpy as np
from matplotlib.ticker import Formatter, Locator

__all__ = ["apply_top_axis", "nice_ticks", "top_forward", "top_inverse", "top_label", "top_ticks"]

TOP_TICK_TARGET = 8
_DEG = math.pi / 180


def _f(top: Mapping[str, Any], key: str, default: float) -> float:
    v = top.get(key)
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else default


def top_forward(top: Mapping[str, Any], x: float) -> float:
    """x -> the top axis' value, or NaN outside the transform's domain."""
    factor = _f(top, "factor", 1.0)
    kind = top.get("kind")
    if kind == "reciprocal":
        return math.nan if x == 0 else factor / x
    if kind == "linear":
        return factor * x + _f(top, "shift", 0.0)
    lam = _f(top, "wavelength", math.nan)
    return lam / (2 * math.sin((x / 2) * _DEG)) if 0 < x < 180 else math.nan


def top_inverse(top: Mapping[str, Any], t: float) -> float:
    """The top axis' value -> x, or NaN outside the domain."""
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
    [lo, hi]; empty when either end lies outside the transform's domain."""
    lo, hi = min(lo, hi), max(lo, hi)
    if top.get("kind") == "reciprocal" and lo <= 0 <= hi:
        return []
    values, decimals = nice_ticks(top_forward(top, lo), top_forward(top, hi))
    span = hi - lo
    out = []
    for value in values:
        pos = top_inverse(top, value)
        if math.isfinite(pos) and lo - span * 1e-9 <= pos <= hi + span * 1e-9:
            out.append((pos, value, top_label(value, decimals)))
    return sorted(out)


class _TopLocator(Locator):
    """The secondary axis' ticks, recomputed from the PRIMARY axis' limits."""

    def __init__(self, ax: Any, top: Mapping[str, Any]) -> None:
        self.ax = ax
        self.top = top
        self.labels: dict[float, str] = {}

    def __call__(self) -> list[float]:
        lo, hi = self.ax.get_xlim()
        ticks = top_ticks(self.top, lo, hi)
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
    if not top or top.get("kind") not in ("reciprocal", "dspacing", "linear"):
        return None
    if top.get("kind") == "dspacing" and not _f(top, "wavelength", 0.0) > 0:
        return None
    if top.get("kind") != "dspacing" and _f(top, "factor", 1.0) == 0:
        return None
    sec = ax.secondary_xaxis(
        "top",
        functions=(
            _vectorize(lambda x: top_forward(top, x)),
            _vectorize(lambda t: top_inverse(top, t)),
        ),
    )
    locator = _TopLocator(ax, top)
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
