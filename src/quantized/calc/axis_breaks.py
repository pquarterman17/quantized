"""Y-axis breaks for matplotlib export -- a BROKEN LINEAR AXIS.

The Axis dialog's "Break from / Break to" rows store ``breaks`` on an axis'
``AxisFormat`` (the mapping ``calc.figure_ticks.apply_tick_formats`` receives
as ``y_fmt``); the screen draws them through ``frontend/src/lib/axisBreaks.ts``
+ ``axisBreakExtras.ts``. This module is the export half and mirrors that
math one-for-one, so a point and a tick sit at the same spot on the canvas and
in the PDF. Both halves read ``tests/fixtures/wire/axis_breaks.json``.

A break ``[lo, hi]`` ELIDES that stretch: values at or below ``lo`` keep their
place, values at or above ``hi`` slide down by the elided length, and a small
fixed gap stands where the stretch was, marked by two diagonal strokes on the
axis line. The axes stays ONE axes -- one frame, one legend, every override
still applies -- which is how Origin draws a break; it is a matplotlib
``function`` scale, not the paneled layout the X break uses
(``calc.figure_break``).

Only a linear Y axis breaks this way: a log or reciprocal axis keeps its own
scale (the dialog refuses the combination) and X breaks stay paneled.

Pure (matplotlib + numpy in, nothing returned).
"""

from __future__ import annotations

import math
import weakref
from collections.abc import Sequence
from typing import Any

import numpy as np
from matplotlib.ticker import AutoMinorLocator, Locator, MultipleLocator, NullLocator
from numpy.typing import NDArray

__all__ = [
    "BREAK_GAP_FRACTION",
    "MAX_AXIS_BREAKS",
    "apply_y_breaks",
    "break_auto_range",
    "break_backward",
    "break_forward",
    "break_gap",
    "break_ticks",
    "elide",
    "axis_break_info",
    "is_broken_axis",
    "nice_break_step",
    "normalize_breaks",
    "unelide",
]

Breaks = Sequence[tuple[float, float]]

# The share of the KEPT data span one break's gap occupies.
BREAK_GAP_FRACTION = 0.04
# Major ticks aimed at across the kept span when no increment is typed.
BREAK_TARGET_TICKS = 6
MAX_AXIS_BREAKS = 4

# Every matplotlib Axis this module has broken, with its breaks and gap. A
# broken axis is a "function" scale, as the reciprocal one is, but unlike it
# takes values <= 0: ``calc.figure_scale.drawable_lim`` asks here before
# dropping a typed limit, and the preview hit-map reports the transform so
# the client can invert a pixel (``calc.figure_hitmap``). Weak, so a closed
# figure's axes are never kept alive.
_BreakInfo = tuple[list[tuple[float, float]], float]
_BROKEN: weakref.WeakKeyDictionary[Any, _BreakInfo] = weakref.WeakKeyDictionary()


def is_broken_axis(axis: Any) -> bool:
    """Whether :func:`apply_y_breaks` turned ``axis`` (a matplotlib Axis) into
    a broken linear axis."""
    return axis in _BROKEN


def axis_break_info(axis: Any) -> _BreakInfo | None:
    """The ``(breaks, gap)`` a broken ``axis`` was drawn with, else None."""
    return _BROKEN.get(axis)


def normalize_breaks(raw: Any) -> list[tuple[float, float]]:
    """``raw`` as a valid break list -- finite ``[lo, hi]`` pairs with
    ``lo < hi``, sorted and non-overlapping, at most :data:`MAX_AXIS_BREAKS`.
    An invalid entry is dropped, never repaired (``normalizeBreaks``)."""
    if not isinstance(raw, (list, tuple)):
        return []
    pairs: list[tuple[float, float]] = []
    for b in raw:
        if not isinstance(b, (list, tuple)) or len(b) != 2:
            continue
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in b):
            continue
        lo, hi = float(b[0]), float(b[1])
        if math.isfinite(lo) and math.isfinite(hi) and lo < hi:
            pairs.append((lo, hi))
    pairs.sort(key=lambda p: p[0])
    out: list[tuple[float, float]] = []
    for b in pairs:
        if len(out) < MAX_AXIS_BREAKS and (not out or b[0] >= out[-1][1]):
            out.append(b)
    return out


def elide(v: float, breaks: Breaks) -> float:
    """``v`` with every elided stretch below it removed (the gap not yet
    added): the coordinate along the KEPT axis."""
    out = v
    for lo, hi in breaks:
        out -= min(max(v - lo, 0.0), hi - lo)
    return out


def unelide(c: float, breaks: Breaks) -> float:
    """The inverse of :func:`elide`; a coordinate sitting exactly on a break
    maps to its LOWER edge."""
    out = c
    for lo, hi in breaks:
        if out > lo:
            out += hi - lo
    return out


def break_gap(breaks: Breaks, data_min: float, data_max: float) -> float:
    """The gap one break occupies, in data units: a fixed share of the kept
    span of the drawn data (1 when that span is degenerate)."""
    kept = elide(data_max, breaks) - elide(data_min, breaks)
    return BREAK_GAP_FRACTION * (kept if kept > 0 and math.isfinite(kept) else 1.0)


def break_forward(v: Any, breaks: Breaks, gap: float) -> NDArray[np.float64]:
    """Data value -> position along the broken axis: the kept coordinate plus
    ``gap`` per break passed; inside a break the value runs linearly across
    the gap. Vectorized (matplotlib hands arrays)."""
    arr = np.asarray(v, dtype=float)
    out = np.array(arr, dtype=float, copy=True)
    for lo, hi in breaks:
        out = out - np.minimum(np.maximum(arr - lo, 0.0), hi - lo)
        out = out + gap * np.clip((arr - lo) / (hi - lo), 0.0, 1.0)
    return np.asarray(out, dtype=float)


def break_backward(p: Any, breaks: Breaks, gap: float) -> NDArray[np.float64]:
    """The inverse of :func:`break_forward`: a position inside a gap maps back
    into the elided stretch."""
    pos = np.asarray(p, dtype=float)
    out = np.array(pos, dtype=float, copy=True)
    done = np.zeros(pos.shape, dtype=bool)
    shift = 0.0  # position minus value just below the break being tested
    for lo, hi in breaks:
        at = lo + shift
        below = ~done & (pos <= at)
        out = np.where(below, pos - shift, out)
        done |= below
        inside = ~done & (pos < at + gap)
        out = np.where(inside, lo + (pos - at) / gap * (hi - lo), out)
        done |= inside
        shift += gap - (hi - lo)
    return np.asarray(np.where(done, out, pos - shift), dtype=float)


def nice_break_step(span: float, target: int = BREAK_TARGET_TICKS) -> float:
    """A 1-2-5 step for ``span`` at about ``target`` intervals."""
    if not (span > 0) or not math.isfinite(span):
        return 1.0
    raw = span / target
    mag = 10.0 ** math.floor(math.log10(raw))
    residual = raw / mag
    return (1 if residual < 1.5 else 2 if residual < 3 else 5 if residual < 7 else 10) * mag


def break_ticks(lo: float, hi: float, breaks: Breaks, step: float | None = None) -> list[float]:
    """Major ticks of a broken axis showing ``[lo, hi]``: whole multiples of
    the step (the typed increment, else a 1-2-5 step sized for the KEPT span),
    never strictly inside a break."""
    if not (math.isfinite(lo) and math.isfinite(hi)) or not hi > lo:
        return []
    typed = step is not None and step > 0 and math.isfinite(step)
    st = float(step) if typed and step is not None else nice_break_step(
        elide(hi, breaks) - elide(lo, breaks)
    )
    first = math.ceil(lo / st - 1e-9)
    last = math.floor(hi / st + 1e-9)
    if last - first > 2000:
        return []
    out: list[float] = []
    for k in range(first, last + 1):
        v = float(f"{k * st:.12g}")
        if not any(b_lo < v < b_hi for b_lo, b_hi in breaks):
            out.append(v)
    return out


def break_auto_range(data_min: float, data_max: float, breaks: Breaks) -> tuple[float, float]:
    """The auto range of a broken axis: 10% of the KEPT span each side, never
    across zero (the canvas' soft zero)."""
    c_lo = elide(data_min, breaks)
    c_hi = elide(data_max, breaks)
    pad = ((c_hi - c_lo) if c_hi > c_lo else (abs(c_hi) or 1.0)) * 0.1
    lo = unelide(c_lo - pad, breaks)
    hi = unelide(c_hi + pad, breaks)
    return (0.0 if data_min >= 0 and lo < 0 else lo, 0.0 if data_max <= 0 and hi > 0 else hi)


class _BreakLocator(Locator):
    """Major ticks of the broken axis for whatever range it finally shows."""

    def __init__(self, breaks: Breaks, step: float | None) -> None:
        self.breaks = list(breaks)
        self.step = step

    def __call__(self) -> Any:
        assert self.axis is not None
        vmin, vmax = self.axis.get_view_interval()
        return self.tick_values(vmin, vmax)

    def tick_values(self, vmin: float, vmax: float) -> Any:
        lo, hi = (vmin, vmax) if vmin <= vmax else (vmax, vmin)
        return np.asarray(break_ticks(float(lo), float(hi), self.breaks, self.step), dtype=float)


class _KeptMinorLocator(AutoMinorLocator):
    """Minor ticks between majors, none inside an elided stretch."""

    def __init__(self, n: int, breaks: Breaks) -> None:
        super().__init__(n)
        self.breaks = list(breaks)

    def __call__(self) -> Any:
        locs = np.asarray(super().__call__(), dtype=float)
        keep = np.ones(locs.shape, dtype=bool)
        for lo, hi in self.breaks:
            keep &= ~((locs > lo) & (locs < hi))
        return locs[keep]


def _series_values(ax: Any) -> NDArray[np.float64]:
    """Finite y of every drawn series point on ``ax`` (error-bar ends and
    reference lines left out, as the canvas' extent leaves them out)."""
    from quantized.calc.figure_autoscale import _values  # shares the scan

    pts, _ends = _values([ax], 1)
    return pts


def _typed_step(locator: Any) -> float | None:
    """The major increment ``calc.figure_ticks.apply_tick_steps`` installed
    (a ``MultipleLocator``), read back through its public ``tick_values`` --
    multiples of the step either side of zero -- or ``None`` for an automatic
    locator."""
    if not isinstance(locator, MultipleLocator):
        return None
    locs = np.asarray(locator.tick_values(0.0, 0.0), dtype=float)
    if locs.size < 2:
        return None
    step = float(locs[1] - locs[0])
    return step if step > 0 and math.isfinite(step) else None


def _draw_marks(ax: Any, breaks: Breaks, right: bool) -> None:
    """Two diagonal strokes per break across the axis line (left spine, or
    the right one for a secondary axis)."""
    trans = ax.get_yaxis_transform()  # x in axes fraction, y in data
    for lo, hi in breaks:
        ax.plot(
            [1.0 if right else 0.0] * 2, [lo, hi], transform=trans, linestyle="none",
            marker=[(-1, -0.5), (1, 0.5)], markersize=9, color="k", mec="k", mew=1.0,
            clip_on=False, label="_axis_break", zorder=5, scalex=False, scaley=False,
        )


def apply_y_breaks(ax: Any, raw_breaks: Any, minor: Any = None) -> bool:
    """Break ``ax``'s Y axis at ``raw_breaks`` (module doc). Returns whether a
    break was applied -- nothing happens off a linear scale or with no valid
    break. Call after the tick formatter and any typed increment are in
    place: both are kept."""
    breaks = normalize_breaks(raw_breaks)
    if not breaks or ax.get_yscale() != "linear":
        return False
    axis = ax.yaxis
    formatter = axis.get_major_formatter()
    locator = axis.get_major_locator()
    step = _typed_step(locator)
    pts = _series_values(ax)
    d_lo, d_hi = (float(pts.min()), float(pts.max())) if pts.size else (0.0, 0.0)
    gap = break_gap(breaks, d_lo, d_hi)
    lim = ax.get_ylim()
    ax.set_yscale(
        "function",
        functions=(
            lambda v: break_forward(v, breaks, gap),
            lambda p: break_backward(p, breaks, gap),
        ),
    )
    axis.set_major_formatter(formatter)
    axis.set_major_locator(_BreakLocator(breaks, step))
    if isinstance(minor, int) and not isinstance(minor, bool) and 0 < minor <= 20:
        axis.set_minor_locator(_KeptMinorLocator(minor + 1, breaks))
    else:
        axis.set_minor_locator(NullLocator())
    if pts.size:
        new_lo, new_hi = break_auto_range(d_lo, d_hi, breaks)
        if new_hi > new_lo:
            lim = (new_hi, new_lo) if lim[0] > lim[1] else (new_lo, new_hi)
    ax.set_ylim(*lim)
    right = axis.get_ticks_position() == "right"
    _draw_marks(ax, breaks, right)
    _BROKEN[axis] = (breaks, gap)
    return True
