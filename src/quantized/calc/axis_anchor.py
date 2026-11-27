"""Anchored major ticks for the publication renderer (plan item 24, Origin's "Anchor tick at").

The export half of ``frontend/src/lib/axisAnchorTicks.ts``. ``AxisFormat.anchor`` on a LINEAR
axis puts the majors at ``anchor + k * step`` for the step the axis already uses: here the step
between the ticks the axis' own locator (a typed increment, the screen's hinted one, or
matplotlib's auto) would draw. The rule is :func:`anchor_ticks`, pinned against the canvas by
``tests/fixtures/wire/axis_anchor.json``. A log, probability or broken axis, and an axis with
explicit tick positions, keep their own ticks.

Pure: matplotlib objects in, nothing returned; a bad anchor leaves the axis as it was.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from matplotlib.ticker import Locator

__all__ = ["MAX_ANCHOR_TICKS", "AnchorLocator", "anchor_ticks", "apply_anchor_ticks"]

MAX_ANCHOR_TICKS = 1000


def anchor_ticks(vmin: float, vmax: float, step: float, anchor: float) -> list[float]:
    """The ticks ``anchor + k * step`` inside ``[vmin, vmax]`` (one within 1e-9 steps of an end is
    kept), ascending, rounded to 12 significant digits; none for a bad step or more than
    :data:`MAX_ANCHOR_TICKS`."""
    nums = (step, anchor, vmin, vmax)
    if not (step > 0) or not all(math.isfinite(v) for v in nums) or vmax < vmin:
        return []
    first = math.ceil((vmin - anchor) / step - 1e-9)
    last = math.floor((vmax - anchor) / step + 1e-9)
    if last - first + 1 > MAX_ANCHOR_TICKS:
        return []
    return [float(f"{anchor + k * step:.12g}") for k in range(first, last + 1)]


class AnchorLocator(Locator):
    """``inner``'s step, with the ticks moved onto ``anchor + k * step``."""

    def __init__(self, inner: Locator, anchor: float) -> None:
        self.inner = inner
        self.anchor = float(anchor)

    def set_axis(self, axis: Any) -> None:
        super().set_axis(axis)
        self.inner.set_axis(axis)

    def __call__(self) -> Any:
        assert self.axis is not None
        lo, hi = self.axis.get_view_interval()
        return self.tick_values(lo, hi)

    def tick_values(self, vmin: float, vmax: float) -> Any:
        own = list(self.inner.tick_values(vmin, vmax))
        if len(own) < 2:
            return own
        ticks = anchor_ticks(vmin, vmax, float(own[1] - own[0]), self.anchor)
        return ticks or own


def _anchor(fmt: Mapping[str, Any]) -> float | None:
    v = fmt.get("anchor")
    if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v):
        return None
    return float(v)


def apply_anchor_ticks(
    axis: Any, fmt: Mapping[str, Any], scale: str, *, broken: bool = False
) -> None:
    """Wrap ``axis``' major locator (module doc); call after the typed step, the hint and the
    custom ticks are installed."""
    anchor = _anchor(fmt)
    custom = fmt.get("custom")
    has_custom = isinstance(custom, Mapping) and bool(custom.get("at"))
    if anchor is None or scale != "linear" or broken or has_custom:
        return
    axis.set_major_locator(AnchorLocator(axis.get_major_locator(), anchor))

