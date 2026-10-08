"""The export's autoscale and log-axis gaps, ruled as the screen's canvas.

matplotlib pads a linear view by 5% each side and a log one by 5% of its
decades; the screen (uPlot) snaps a log view outward to a one-digit mantissa
below and a whole decade above (``rangeLog``), and never pads data on one side
of zero across it. ``shared_autoscale`` applies the screen's rule to an axis
the caller has not given a typed limit (``_apply_overrides`` sets those after).

A FLAT (zero-span) axis takes uPlot's own rule too, on x, y and y2 alike
(``flat_auto_range``; ``log_auto_range`` already is ``rangeLog``'s): a flat
1000 Oe field reads 0..2000, not matplotlib's ~950..1050, which frames a
constant like a trace resolved to 0.1%. The rule, and why, is stated once in
``frontend/src/lib/flatAutoscaleFixture.test.ts``; both halves read
``tests/fixtures/wire/flat_autoscale.json``.

On a log axis:

* a value <= 0 has no position. matplotlib's default clips it to the bottom
  edge, so a line dropped there (spin-flip PNR, zero-count XRD). The drawn
  line's copy of such points becomes NaN -- a gap with no marker, as the
  screen's ``lib/logGaps.ts`` -- and the data are untouched;
* an error-bar end more than two decades below the lowest point (or <= 0)
  does not stretch the view; the bar runs to the axis floor, as the screen's
  ``lib/uplotErrorRange.ts`` ``barFloor``.

Pure layer (matplotlib + numpy only).
"""

from __future__ import annotations

import math
import re
import sys
from typing import Any

import numpy as np
from matplotlib.collections import LineCollection, PathCollection
from matplotlib.container import ErrorbarContainer
from numpy.typing import NDArray

from quantized.calc.figure_ticks import _pow10

__all__ = ["flat_auto_range", "log_auto_range", "mask_nonpositive", "shared_autoscale"]


def _fix(v: float) -> float:
    """Drop float noise (uPlot's ``fixFloat``)."""
    return float(f"{v:.12g}")


_NOISE = re.compile(r"\.\d*?(?=9{6,}|0{6,})")


def _js_str(v: float) -> str:
    """``String(v)`` in JS: positional from 1e-6 up to 1e21, else exponent."""
    if v == 0 or 1e-6 <= abs(v) < 1e21:
        return np.format_float_positional(v, unique=True, trim="-")
    return np.format_float_scientific(v, unique=True, trim="-", exp_digits=1)


def _round_dec(v: float, dec: int) -> float:
    """uPlot's ``roundDec`` (half up, with its 1 + epsilon nudge)."""
    if v.is_integer():
        return v
    p = 10.0**dec
    n = v * p * (1 + sys.float_info.epsilon)
    whole = math.floor(n)  # Math.round exactly: n + 0.5 itself can round
    return (whole + (n - whole >= 0.5)) / p


def _fix_float(v: float) -> float:
    """uPlot's ``fixFloat``: round off a run of six 0s or 9s in the digits
    (``1999.9999999998`` -> ``2000``) -- exact, where ``_fix`` is 12 digits."""
    if v.is_integer():
        return v
    text = _js_str(v)
    run = _NOISE.search(text)
    if run is None:
        return v
    if "e-" in text:
        num, exp = text.split("e")
        return float(f"{_fix_float(float(num))}e{exp}")
    return _round_dec(v, len(run.group(0)) - 1)


def flat_auto_range(lo: float, hi: float) -> tuple[float, float] | None:
    """uPlot's ``rangeNum(lo, hi, 0.1, true)`` when [lo, hi] is flat by its
    own test (a span under 1e-24, or 11+ decades below the values), else
    None. The span grows by |v| each side, snapped out to a tenth of v's
    decade, never across zero (a soft 0); a flat 0 reads 0..100."""
    delta = hi - lo
    scalar = max(abs(lo), abs(hi))
    if delta >= 1e-24 and abs(math.log10(scalar) - math.log10(delta)) <= 10:
        return None
    delta = 1e-24 if lo == 0 or hi == 0 else 0.0
    nonzero = delta or scalar or 1e3
    incr = _pow10(math.floor(math.log10(nonzero))) / 10
    pad = nonzero * (0.1 if delta else 1.0)
    new_lo = _round_dec(_fix_float(math.floor(_fix_float((lo - pad) / incr)) * incr), 24)
    new_hi = _round_dec(_fix_float(math.ceil(_fix_float((hi + pad) / incr)) * incr), 24)
    out_lo = 0.0 if lo >= 0 and new_lo <= 0 else new_lo
    out_hi = 0.0 if hi <= 0 and new_hi >= 0 else new_hi
    return (0.0, 100.0) if out_lo == out_hi == 0 else (out_lo, out_hi)


def log_auto_range(lo: float, hi: float) -> tuple[float, float]:
    """uPlot's ``rangeLog(lo, hi, 10, false)``: ``lo`` down to a one-digit
    mantissa in its own decade, ``hi`` up to the next whole decade."""
    if lo == hi:
        lo, hi = lo / 10, hi * 10
    lo_incr = _pow10(math.floor(math.log10(lo)))
    hi_incr = _pow10(math.ceil(math.log10(hi)))
    return (
        _fix(math.floor(_fix(lo / lo_incr)) * lo_incr),
        _fix(math.ceil(_fix(hi / hi_incr)) * hi_incr),
    )


def _axes_of(ax: Any, axis: str) -> list[Any]:
    """``ax`` plus every axes sharing its ``axis`` (facets share x)."""
    shared = ax.get_shared_x_axes() if axis == "x" else ax.get_shared_y_axes()
    return list(shared.get_siblings(ax))


def mask_nonpositive(ax: Any, axis: str) -> None:
    """NaN every value <= 0 in the drawn copy of ``ax``'s data lines along
    ``axis`` (see the module doc)."""
    for line in ax.lines:
        if line.get_transform() != ax.transData:
            continue
        v = np.asarray(line.get_xdata() if axis == "x" else line.get_ydata(), dtype=float)
        if v.size and np.any(v <= 0):
            masked = np.where(v > 0, v, np.nan)
            line.set_xdata(masked) if axis == "x" else line.set_ydata(masked)


def _values(axes: list[Any], i: int) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Point coordinates and error-bar end coordinates (index ``i``: 0 = x)
    across ``axes``, finite only."""
    pts: list[NDArray[np.float64]] = []
    ends: list[NDArray[np.float64]] = []
    for a in axes:
        caps = {id(cap) for c in a.containers if isinstance(c, ErrorbarContainer) for cap in c[1]}
        for line in a.lines:
            if line.get_transform() == a.transData:
                xy = np.asarray(line.get_xydata(), dtype=float)
                (ends if id(line) in caps else pts).append(xy[:, i])
        for c in a.collections:
            if isinstance(c, PathCollection):
                pts.append(np.asarray(c.get_offsets(), dtype=float).reshape(-1, 2)[:, i])
            elif isinstance(c, LineCollection):
                for seg in c.get_segments():
                    ends.append(np.asarray(seg, dtype=float).reshape(-1, 2)[:, i])

    def cat(parts: list[NDArray[np.float64]]) -> NDArray[np.float64]:
        v = np.concatenate(parts) if parts else np.empty(0)
        return np.asarray(v[np.isfinite(v)], dtype=float)

    return cat(pts), cat(ends)


def shared_autoscale(ax: Any, axis: str, scale: str) -> None:
    """Apply the screen's autoscale rule to ``ax``'s ``axis`` (module doc).
    Call after every series and error bar is drawn and before typed limits;
    an axis whose limits are already set (a break panel's x) is left alone."""
    if not (ax.get_autoscalex_on() if axis == "x" else ax.get_autoscaley_on()):
        return
    axes = _axes_of(ax, axis)
    if any(not (a.lines or a.collections) for a in axes):
        return  # a shared panel not drawn yet: its own call (the last) rules all
    pts, ends = _values(axes, 0 if axis == "x" else 1)
    get_lim = ax.get_xlim if axis == "x" else ax.get_ylim
    set_lim = ax.set_xlim if axis == "x" else ax.set_ylim
    if scale == "log":
        pts = pts[pts > 0]
        if not pts.size:
            return
        floor = float(pts.min()) / 100
        ends = ends[ends > floor]
        both = np.concatenate([pts, ends])
        set_lim(*log_auto_range(float(both.min()), float(both.max())))
    elif scale == "linear":
        both = np.concatenate([pts, ends])
        if not both.size:
            return
        lo, hi = get_lim()
        flip = lo > hi
        lo, hi = min(lo, hi), max(lo, hi)
        new_lo = 0.0 if both.min() >= 0 and lo < 0 else lo
        new_hi = 0.0 if both.max() <= 0 and hi > 0 else hi
        flat = flat_auto_range(float(both.min()), float(both.max()))
        if flat:  # already soft at zero
            new_lo, new_hi = flat
        if (flat or (new_lo, new_hi) != (lo, hi)) and new_hi > new_lo:
            set_lim(*((new_hi, new_lo) if flip else (new_lo, new_hi)))
