"""Bubble axis padding for the publication export (mirror of ``lib/bubblePad.ts``).

An autoscaled linear axis runs exactly to the data, so a bubble (a ``size_by``
marker) on the edge would be cut in half by the frame. The screen widens the
axis until the largest bubble fits (:func:`pad_for_radius`, the port of
``padForRadius``); the export does the same so the two read alike.

A bubble's diameter is a size in POINTS here, so the margin is solved against
the axes' size in points: ``m = r * (span + 2m) / size``, by fixed-point
iteration. Only an AUTOSCALED, linear axis is padded -- ``shared_autoscale``
calls this on the range it just chose, and typed limits are applied after it,
so they stay what the user typed. A log axis never reaches it, and a view that
does not cover every bubble centre is left alone (as the screen's zoom).

Pure layer (matplotlib artists, duck-typed).
"""

from __future__ import annotations

from typing import Any

import numpy as np

__all__ = ["max_bubble_radius", "pad_for_bubbles", "pad_for_radius", "tag_bubbles"]

_ATTR = "_qz_bubble_diam"


def tag_bubbles(artist: Any, diam: Any) -> None:
    """Record the largest finite diameter (points) a size-by scatter draws."""
    d = np.asarray(diam, dtype=float)
    d = d[np.isfinite(d)]
    if d.size and float(d.max()) > 0:
        setattr(artist, _ATTR, float(d.max()))


def max_bubble_radius(axes: list[Any]) -> float:
    """The largest bubble radius (points) drawn on ``axes``; 0 when none."""
    best = 0.0
    for a in axes:
        for c in a.collections:
            best = max(best, float(getattr(c, _ATTR, 0.0)))
    return best / 2.0


def pad_for_radius(
    lo: float, hi: float, dmin: float, dmax: float, radius: float, size: float
) -> tuple[float, float]:
    """``[lo, hi]`` widened until every centre in ``[dmin, dmax]`` has ``radius``
    of room on a plot ``size`` long; unchanged when it cannot fit (as the screen)."""
    if not (size > 4 * radius) or not (radius > 0):
        return lo, hi
    for _ in range(8):
        m = radius * (hi - lo) / size
        lo = min(lo, dmin - m)
        hi = max(hi, dmax + m)
    return lo, hi


def pad_for_bubbles(
    axes: list[Any], ax: Any, axis: str, lo: float, hi: float
) -> tuple[float, float]:
    """The autoscaled ``[lo, hi]`` of ``ax``'s physical ``axis`` ("x"/"y"), widened
    for the biggest bubble drawn on ``axes`` (the sharing group)."""
    radius = max_bubble_radius(axes)
    if radius <= 0:
        return lo, hi
    i = 0 if axis == "x" else 1
    vals: list[Any] = []
    for a in axes:
        for c in a.collections:
            if getattr(c, _ATTR, 0.0) > 0:
                off = np.asarray(c.get_offsets(), dtype=float).reshape(-1, 2)
                vals.append(off[:, i])
    v = np.concatenate(vals) if vals else np.empty(0)
    v = v[np.isfinite(v)]
    if not v.size:
        return lo, hi
    dmin, dmax = float(v.min()), float(v.max())
    if lo > dmin or hi < dmax:
        return lo, hi  # a view that does not cover every bubble centre
    fig = ax.figure
    box = ax.bbox
    size = (box.width if axis == "x" else box.height) * 72.0 / fig.dpi
    return pad_for_radius(lo, hi, dmin, dmax, radius, size)
