"""Axis-scale resolution + the reciprocal (1/x) transform for matplotlib
export (MAIN #12 -- Arrhenius-style plots: ln(rho) or log tau vs 1/T). Pure
layer. Split out of ``calc.figure`` purely to stay under the 500-line
god-module ceiling (mirrors ``figure_break``/``figure_overrides``).

matplotlib has no built-in reciprocal scale, so this applies one via
``Axes.set_xscale("function", functions=(f, finv))`` -- matplotlib's own
documented custom-scale hook (``matplotlib.scale.FuncScale``) -- with the
self-inverse transform ``f(v) = 1/v`` (``f(f(v)) == v`` for ``v != 0``, so one
function serves as both the forward and inverse transform) plus a tick
locator that places ticks at "nice" values evenly spaced IN 1/x SPACE,
returned in the ORIGINAL x units. That mirrors the screen-side reciprocal
scale (``frontend/src/lib/uplotOpts.ts``'s ``reciprocalTransform`` /
``reciprocalAxisSplits``): the axis POSITIONS by 1/x, but tick LABELS still
read the natural variable (e.g. T in Kelvin) -- Origin's "Reciprocal" axis
type convention.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from matplotlib.ticker import Locator
from numpy.typing import NDArray

__all__ = ["apply_axis_scale", "reciprocal_tick_values", "resolve_axis_scale"]

_SCALES = ("linear", "log", "reciprocal")


def resolve_axis_scale(explicit: str | None, legacy_log: bool) -> str:
    """MAIN #12 back-compat bridge: an explicit ``x_scale``/``y_scale`` (a
    new caller) wins when it's one of the 3 valid tokens; otherwise fall back
    to the old ``x_log``/``y_log`` boolean (``True`` -> ``"log"``, ``False``
    -> ``"linear"``) -- the same convention as the frontend's
    ``lib/plotview.ts``'s ``scaleFromLog``."""
    if explicit in _SCALES:
        return explicit
    return "log" if legacy_log else "linear"


def _reciprocal(v: NDArray[np.float64] | float) -> NDArray[np.float64]:
    """``1/v``, self-inverse. Non-positive input degrades to ``NaN`` --
    matplotlib omits a NaN point from the drawn view rather than erroring --
    the SAME domain restriction the log scale already has (physically apt
    for the Arrhenius case: T in Kelvin is always positive)."""
    arr = np.asarray(v, dtype=float)
    out = np.full_like(arr, np.nan)
    pos = arr > 0
    out[pos] = 1.0 / arr[pos]
    return out


def _nice_step(raw: float) -> float:
    """A nice round step >= raw, snapped to 1/2/5/10 x 10^n (mirrors the
    frontend's ``niceLinearStep``)."""
    if raw <= 0 or not np.isfinite(raw):
        return 1.0
    mag = float(10.0 ** np.floor(np.log10(raw)))
    norm = raw / mag
    snapped = 1.0 if norm < 1.5 else 2.0 if norm < 3.0 else 5.0 if norm < 7.0 else 10.0
    return snapped * mag


def reciprocal_tick_values(vmin: float, vmax: float, target: int = 5) -> list[float]:
    """Reciprocal-axis tick positions for a ``[vmin, vmax]`` data-space range:
    "nice" values evenly spaced in 1/x space, mapped back to ORIGINAL x units
    (mirrors the frontend's ``reciprocalAxisSplits``). Degenerate ranges
    (non-positive, or inverted/zero-width) return ``[]``."""
    if not (vmin > 0) or not (vmax > vmin):
        return []
    r0, r1 = 1.0 / vmin, 1.0 / vmax
    lo, hi = min(r0, r1), max(r0, r1)
    if not (hi > lo):
        return [vmin, vmax]
    step = _nice_step((hi - lo) / max(1, target))
    eps = 1e-9
    n0 = int(np.ceil(lo / step - eps))
    n1 = int(np.floor(hi / step + eps))
    out: list[float] = []
    for n in range(n0, n1 + 1):
        r = n * step
        if r == 0:
            continue  # 1/0 is undefined -- skip the (rare) exact-zero tick
        v = float(np.round(1.0 / r, 10))
        if vmin * (1 - eps) <= v <= vmax * (1 + eps):
            out.append(v)
    return sorted(out)


class _ReciprocalLocator(Locator):
    """Matplotlib tick locator for a reciprocal-scaled axis: ticks land at
    "nice" 1/x-evenly-spaced values, returned in ORIGINAL x units (see
    :func:`reciprocal_tick_values`). ``self.axis`` is set by matplotlib when
    the locator is attached via ``set_major_locator``."""

    def tick_values(self, vmin: float, vmax: float) -> list[float]:
        return reciprocal_tick_values(min(vmin, vmax), max(vmin, vmax))

    def __call__(self) -> list[float]:
        if self.axis is None:
            return []
        vmin, vmax = self.axis.get_view_interval()
        return self.tick_values(vmin, vmax)


def apply_axis_scale(ax: Any, axis: str, scale: str) -> None:
    """Apply ``scale`` (``"linear"``/``"log"``/``"reciprocal"``) to ``ax``'s
    x or y axis (``axis`` is ``"x"`` or ``"y"``). ``"linear"`` is a no-op
    (matplotlib's own default). ``"reciprocal"`` uses the ``"function"``
    scale (matplotlib's documented custom-scale hook,
    :class:`matplotlib.scale.FuncScale`) with the self-inverse 1/x transform
    plus :class:`_ReciprocalLocator` for reciprocal-spaced ticks."""
    set_scale = ax.set_xscale if axis == "x" else ax.set_yscale
    if scale == "log":
        set_scale("log")
        return
    if scale == "reciprocal":
        set_scale("function", functions=(_reciprocal, _reciprocal))
        locator = _ReciprocalLocator()
        if axis == "x":
            ax.xaxis.set_major_locator(locator)
        else:
            ax.yaxis.set_major_locator(locator)
