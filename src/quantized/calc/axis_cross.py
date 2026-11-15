"""An axis drawn across the other axis at a value, for matplotlib export (gap
audit 4 G17: Origin's "axis position at", e.g. Y crossing at X = 0 for an
M-H loop).

The export half of ``frontend/src/lib/axisScaleExtras.ts``'s ``drawCross``.
The axis' own ``AxisFormat`` carries ``cross``: the value on the OTHER axis
where it is drawn. As on screen:

* the frame and the layout stay put -- the axis' own ticks and labels keep
  their space but are drawn transparent, and the axis title stays at the
  frame;
* the axis line, its major ticks and their labels are drawn at the crossing,
  facing the axis' own side (left of a left Y, below an X);
* a crossing off the other axis' view is clamped to the nearer frame edge,
  and one the other axis cannot show at all (0 on a log axis, a value off a
  probability axis' domain) leaves the axis at its frame.

The drawing happens at draw time (a small artist), so it reads the final
ticks and limits -- whatever ``tight_layout`` or a later limit settles on.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Literal

import numpy as np
from matplotlib.artist import Artist
from matplotlib.lines import Line2D
from matplotlib.text import Text
from matplotlib.transforms import offset_copy

__all__ = ["apply_cross", "cross_fraction", "cross_position"]

_HIDDEN = (0.0, 0.0, 0.0, 0.0)
# matplotlib's TICKLEFT / TICKRIGHT / TICKUP / TICKDOWN marker codes.
_MARKERS: dict[str, Literal[0, 1, 2, 3]] = {"left": 0, "right": 1, "top": 2, "bottom": 3}


def cross_position(cross: float, vmin: float, vmax: float, drawable: bool) -> float | None:
    """``cross`` clamped into ``[vmin, vmax]``, or None when the other axis
    cannot draw it (the screen's ``crossPosition``)."""
    if not drawable or not all(math.isfinite(v) for v in (cross, vmin, vmax)):
        return None
    lo, hi = min(vmin, vmax), max(vmin, vmax)
    return min(hi, max(lo, cross))


def _drawable(other: Any, v: float) -> bool:
    scale = other.get_scale()
    if scale in ("log", "symlog") and v <= 0:
        return v != 0 and scale == "symlog"
    t = other.get_transform().transform(np.array([v], dtype=float))
    return bool(np.all(np.isfinite(t)))


def cross_fraction(other: Any, cross: float, frame: float) -> float:
    """Where along ``other`` (a matplotlib Axis) the crossing sits, as an
    axes fraction: ``frame`` (0 or 1) when it cannot be drawn there."""
    a, b = other.get_view_interval()
    pos = cross_position(cross, a, b, _drawable(other, cross))
    if pos is None:
        return frame
    t = other.get_transform()
    ta, tb, tp = (float(t.transform(np.array([v], dtype=float))[0]) for v in (a, b, pos))
    return frame if tb == ta else (tp - ta) / (tb - ta)


class _CrossedAxis(Artist):
    """Draws ``axis``' line, major ticks and labels across ``other``."""

    def __init__(
        self, ax: Any, which: str, side: str, cross: float, look: Mapping[str, Any]
    ) -> None:
        super().__init__()
        self.ax, self.which, self.side, self.cross, self.look = ax, which, side, cross, look
        self.set_zorder(2.6)

    def draw(self, renderer: Any) -> None:
        ax, which, look = self.ax, self.which, self.look
        axis, other = (ax.xaxis, ax.yaxis) if which == "x" else (ax.yaxis, ax.xaxis)
        frame = 1.0 if self.side in ("right", "top") else 0.0
        f = cross_fraction(other, self.cross, frame)
        lo, hi = sorted(axis.get_view_interval())
        tol = (hi - lo) * 1e-9
        locs = [float(v) for v in axis.get_major_locator()() if lo - tol <= v <= hi + tol]
        labels = axis.get_major_formatter().format_ticks(locs) if locs else []
        fig = ax.figure
        trans = ax.get_xaxis_transform() if which == "x" else ax.get_yaxis_transform()
        out = -1.0 if self.side in ("left", "bottom") else 1.0
        span = [[0.0, 1.0], [f, f]] if which == "x" else [[f, f], [0.0, 1.0]]
        parts: list[Artist] = [
            Line2D(
                *span,
                transform=ax.transAxes,
                color=look["line"],
                linewidth=look["lw"],
                clip_on=False,
            )
        ]
        if locs:
            marker = _MARKERS[self.side]
            xs, ys = (locs, [f] * len(locs)) if which == "x" else ([f] * len(locs), locs)
            parts.append(
                Line2D(
                    xs,
                    ys,
                    transform=trans,
                    linestyle="none",
                    marker=marker,
                    markersize=look["size"],
                    markeredgewidth=look["width"],
                    color=look["tick"],
                    clip_on=False,
                )
            )
        shift = out * (look["size"] + look["pad"])
        place = offset_copy(
            trans,
            fig,
            x=0 if which == "x" else shift,
            y=shift if which == "x" else 0,
            units="points",
        )
        for v, label in zip(locs, labels, strict=True):
            if not label:
                continue
            x, y = (v, f) if which == "x" else (f, v)
            parts.append(
                Text(
                    x,
                    y,
                    label,
                    transform=place,
                    fontsize=look["fontsize"],
                    color=look["color"],
                    ha="center" if which == "x" else ("left" if out > 0 else "right"),
                    va=("bottom" if out > 0 else "top") if which == "x" else "center",
                    clip_on=False,
                )
            )
        for part in parts:
            part.set_figure(fig)
            part.draw(renderer)


def apply_cross(ax: Any, which: str, fmt: Mapping[str, Any], side: str) -> None:
    """Draw ``ax``'s ``which`` axis (on ``side``) across the other axis at
    ``fmt["cross"]`` (module doc). Call after the limits are set."""
    cross = fmt.get("cross")
    if not isinstance(cross, (int, float)) or isinstance(cross, bool) or not math.isfinite(cross):
        return
    axis = ax.xaxis if which == "x" else ax.yaxis
    ticks = axis.get_major_ticks()
    tick = ticks[0] if ticks else None
    label = None if tick is None else tick.label1 if side in ("left", "bottom") else tick.label2
    spine = ax.spines[side]
    look = {
        "size": tick.tick1line.get_markersize() if tick is not None else 3.5,
        "width": tick.tick1line.get_markeredgewidth() if tick is not None else 0.8,
        "tick": tick.tick1line.get_color() if tick is not None else "k",
        "pad": tick.get_pad() if tick is not None else 3.5,
        "fontsize": label.get_fontsize() if label is not None else 10,
        "color": label.get_color() if label is not None else "k",
        "line": spine.get_edgecolor(),
        "lw": spine.get_linewidth(),
    }
    # The ticks and labels keep their space (the frame and title stay where
    # they are, as on screen); only the crossing draws them.
    ax.tick_params(axis=which, which="both", color=_HIDDEN, labelcolor=_HIDDEN)
    ax.add_artist(_CrossedAxis(ax, which, side, float(cross), look))
