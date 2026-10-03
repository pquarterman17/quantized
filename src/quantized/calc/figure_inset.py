"""The magnifier inset in the publication renderer (plot audit leftovers).

The screen's magnifier (``frontend/src/components/Stage/InsetPlot.tsx``) is a
second, zoomed view of the plot's own series pinned over the plot. It used to
be screen-only: every export path dropped it. The view now carries its state
(``PlotView.inset``) and the request carries it as ``overrides["inset"]``::

    {"x": [lo, hi], "y": [lo, hi], "at": [left, top, width, height], "lines": bool}

``at`` is the inset's PLOT AREA as fractions of the main axes, top-origin (the
screen's frame fractions); ``x``/``y`` the source region in data coordinates.
A missing ``x`` seeds the screen's own default (the central 30% of the data's
x, ``lib/inset.ts`` ``centralRange``); a missing ``y`` autoscales over the rows
inside that x window. ``draw_series_axes`` calls :func:`apply_inset` last, so
the inset copies every drawn series line with its finished style (colour,
dash, width, marker, step, the log-gap masking) and the axes' own scales and
direction -- the "same series styles and scales" the screen's inset draws.
Like the screen's inset it shows the series only: no error bars, fills,
annotations or legend. The source region is outlined on the main axes and,
with ``lines``, joined to the inset by the two connector lines the screen
draws (:func:`inset_connectors`, the shared ``inset_connectors.json`` table).

Single-axes figures only: the secondary-axis path strips it
(``figure_y2.render_with_secondary_axis``), a broken x-axis and a facet grid
never read it, and the screen shows no inset on those views either.
Pure layer: matplotlib + numpy only.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle

from quantized.calc.figure_autoscale import log_auto_range
from quantized.calc.figure_scale import apply_axis_scale

__all__ = ["apply_inset", "inset_connectors", "validate_inset"]

_EDGE = "0.35"  # the outline/connector ink: a soft grey, as the screen's dimmed ink
_EDGE_WIDTH = 0.8
_SEED_FRACTION = 0.3  # lib/inset.ts centralRange's default


def _ascending(v: Any) -> bool:
    return (
        isinstance(v, (list, tuple))
        and len(v) == 2
        and all(isinstance(n, (int, float)) and math.isfinite(n) for n in v)
        and v[0] < v[1]
    )


def validate_inset(spec: Any) -> None:
    """Raise ``ValueError`` for a malformed ``overrides["inset"]``."""
    if not isinstance(spec, Mapping):
        raise ValueError("inset must be an object")
    at = spec.get("at")
    if not (
        isinstance(at, (list, tuple))
        and len(at) == 4
        and all(isinstance(n, (int, float)) and math.isfinite(n) for n in at)
        and at[2] > 0
        and at[3] > 0
    ):
        raise ValueError("inset.at must be [left, top, width, height] with a positive size")
    for key in ("x", "y"):
        if spec.get(key) is not None and not _ascending(spec[key]):
            raise ValueError(f"inset.{key} must be a [lo, hi] pair with lo < hi")


def inset_connectors(source: Sequence[float], inset: Sequence[float]) -> list[str]:
    """The corners ("ll", "ul", "lr", "ur") whose connector lines join the
    source region to the inset -- matplotlib's ``indicate_inset_zoom`` choice.
    Both rects are ``[x0, y0, x1, y1]`` in y-UP axes fractions. The screen
    applies the same rule (``lib/inset.ts`` ``insetConnectors``)."""
    x0 = source[0] < inset[0]
    x1 = source[2] < inset[2]
    y0 = source[1] < inset[1]
    y1 = source[3] < inset[3]
    out: list[str] = []
    if x0 != y0:
        out.append("ll")
    if x0 == y1:
        out.append("ul")
    if x1 == y0:
        out.append("lr")
    if x1 != y1:
        out.append("ur")
    return out


def _corner(r: Sequence[float], c: str) -> tuple[float, float]:
    return (r[0] if c[1] == "l" else r[2], r[1] if c[0] == "l" else r[3])


def _auto_y(
    lines: Sequence[Line2D], x0: float, x1: float, scale: str
) -> tuple[float, float] | None:
    """The y range over the points inside ``[x0, x1]``: the screen's rules
    (log: ``rangeLog``; linear: a 10% pad that never crosses zero)."""
    parts = []
    for ln in lines:
        x = np.asarray(ln.get_xdata(), dtype=float)
        y = np.asarray(ln.get_ydata(), dtype=float)
        parts.append(y[(x >= x0) & (x <= x1) & np.isfinite(y)])
    v = np.concatenate(parts) if parts else np.empty(0)
    if scale != "linear":
        v = v[v > 0]
    if not v.size:
        return None
    lo, hi = float(v.min()), float(v.max())
    if scale == "log":
        return log_auto_range(lo, hi)
    if scale != "linear":
        return lo / 1.1, hi * 1.1
    pad = (hi - lo or abs(hi) or 1.0) * 0.1
    lo = lo - pad if lo < 0 else max(0.0, lo - pad)
    return lo, hi + pad if hi >= 0 else min(0.0, hi + pad)


def _copy_line(ins: Any, ln: Line2D) -> None:
    ins.plot(
        ln.get_xdata(),
        ln.get_ydata(),
        color=ln.get_color(),
        linestyle=ln.get_linestyle(),
        linewidth=ln.get_linewidth(),
        marker=ln.get_marker(),
        markersize=ln.get_markersize(),
        markerfacecolor=ln.get_markerfacecolor(),
        markeredgecolor=ln.get_markeredgecolor(),
        drawstyle=ln.get_drawstyle(),
        alpha=ln.get_alpha(),
        label="_inset",
    )


def _clip01(v: float) -> float:
    return min(1.0, max(0.0, float(v)))


def _indicate(
    ax: Any, region: tuple[float, float, float, float], at: Sequence[float], lines: bool
) -> None:
    """Outline the source region on ``ax`` and, with ``lines``, connect it to
    the inset. ``add_artist`` (not ``add_patch``/``plot``) so neither widens
    the main axes' limits."""
    x0, x1, y0, y1 = region
    ax.get_xlim(), ax.get_ylim()  # settle a lazy autoscale before reading transData
    rect = Rectangle(
        (x0, y0), x1 - x0, y1 - y0, transform=ax.transData,
        fill=False, edgecolor=_EDGE, linewidth=_EDGE_WIDTH, zorder=4.5,
    )
    ax.add_artist(rect)
    if not lines:
        return
    to_frac = ax.transData + ax.transAxes.inverted()
    (ax0, ay0), (ax1, ay1) = to_frac.transform([(x0, y0), (x1, y1)])
    lo_x, hi_x = sorted((ax0, ax1))
    lo_y, hi_y = sorted((ay0, ay1))
    src = [_clip01(lo_x), _clip01(lo_y), _clip01(hi_x), _clip01(hi_y)]
    left, top, width, height = (float(v) for v in at)
    box = [left, 1.0 - top - height, left + width, 1.0 - top]
    for c in inset_connectors(src, box):
        (sx, sy), (bx, by) = _corner(src, c), _corner(box, c)
        ax.add_artist(Line2D(
            [sx, bx], [sy, by], transform=ax.transAxes, color=_EDGE, linewidth=_EDGE_WIDTH,
            zorder=4.5, clip_on=False, label="_inset_connector",
        ))


def apply_inset(
    ax: Any,
    artists: Sequence[Any],
    ov: Mapping[str, Any],
    x_scale: str,
    y_scale: str,
    grid_alpha: float,
) -> Any | None:
    """Draw ``ov["inset"]`` (see the module doc) on ``ax`` from the series
    ``artists`` already drawn there; returns the inset axes, or ``None`` when
    there is no inset (or no line to magnify)."""
    spec = ov.get("inset")
    if not isinstance(spec, Mapping):
        return None
    lines = [a for a in artists if isinstance(a, Line2D)]
    xs = [np.asarray(ln.get_xdata(), dtype=float) for ln in lines]
    finite = np.concatenate([x[np.isfinite(x)] for x in xs]) if xs else np.empty(0)
    if not finite.size:
        return None
    if _ascending(spec.get("x")):
        x0, x1 = float(spec["x"][0]), float(spec["x"][1])
    else:
        lo, hi = float(finite.min()), float(finite.max())
        mid, half = (lo + hi) / 2, (hi - lo) * _SEED_FRACTION / 2
        x0, x1 = (mid - half, mid + half) if hi > lo else (lo, hi)
    left, top, width, height = (float(v) for v in spec["at"])
    ins = ax.inset_axes((left, 1.0 - top - height, width, height))
    for ln in lines:
        _copy_line(ins, ln)
    apply_axis_scale(ins, "x", x_scale)
    apply_axis_scale(ins, "y", y_scale)
    if x1 > x0:
        ins.set_xlim((x1, x0) if ax.xaxis_inverted() else (x0, x1))
    y = (
        (float(spec["y"][0]), float(spec["y"][1]))
        if _ascending(spec.get("y"))
        else _auto_y(lines, x0, x1, y_scale)
    )
    if y is not None:
        ins.set_ylim(*y)
    ins.tick_params(labelsize="small")
    if ov.get("grid", grid_alpha > 0):
        ins.grid(True, which="major", alpha=grid_alpha or 0.3)
    else:
        ins.grid(False)
    y0, y1 = sorted(ins.get_ylim())
    _indicate(ax, (x0, x1, y0, y1), spec["at"], spec.get("lines", True) is not False)
    return ins
