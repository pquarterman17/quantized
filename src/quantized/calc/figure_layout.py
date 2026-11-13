"""Page margins as OUTER padding around a tight layout (publication-figures
audit B3, 2026-11).

The window's Page setup (``frontend/src/lib/pageGeometry.ts``) used to ride
the request as ``overrides.margins`` -- matplotlib *subplot* fractions. That
placed the axes BOX at the margin, skipped ``tight_layout`` (``calc.figure``
only lays out when no explicit ``margins`` are given) and left nothing for the
tick labels, axis titles or figure title: an 8.5 x 6 cm page with 0.5 cm
margins exported with all of them clipped off the canvas.

A page margin is the blank border of the PAGE, not the position of the
axes. So the Page setup now sends ``overrides.page_pad`` (each side a
fraction of its page dimension, the same numbers ``marginFractions``
computes) and this module lays the figure out with ``tight_layout`` inside
the padded rectangle: every decoration (tick labels, axis titles, title,
an outside legend) fits inside the page minus its margins, and the page
size itself is untouched (no ``bbox_inches="tight"`` crop), so a PDF is
exactly the requested size.

``overrides.margins`` keeps its explicit meaning -- the Figure Builder's
"Canvas (margins)" fields place the axes box by hand -- and wins over
``page_pad`` when both are present (``_apply_overrides`` applies it with
``subplots_adjust``; no layout pass runs here then).

Pure layer: mutates the passed matplotlib Figure.
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Mapping
from typing import Any

from quantized.calc.figure_warnings import note_figure_warning

__all__ = ["PAGE_PAD_MAX", "apply_figure_layout", "page_pad_rect", "validate_page_pad"]

# The frontend clamps each margin to 47.5% of its dimension (pageGeometry's
# marginFractions); the backend refuses anything that leaves no page at all.
PAGE_PAD_MAX = 0.475
# tight_layout's own padding INSIDE the padded rect, in font-size units --
# matplotlib's default, the border every export without a Page setup already
# has. The page margin is added OUTSIDE it, so a 0 margin (the Page setup
# default) exports exactly like no Page setup at all.
_INNER_PAD = 1.08
_SIDES = ("left", "right", "top", "bottom")


def validate_page_pad(pad: Any) -> None:
    """Raise ``ValueError`` unless ``pad`` is ``None`` or a mapping of side ->
    fraction in ``[0, PAGE_PAD_MAX]``."""
    if pad is None:
        return
    if not isinstance(pad, Mapping):
        raise ValueError("page_pad must be an object of side -> page fraction")
    for side in _SIDES:
        v = pad.get(side)
        if v is None:
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f"page_pad {side} must be a finite number")
        if not 0.0 <= float(v) <= PAGE_PAD_MAX:
            raise ValueError(f"page_pad {side} must be a page fraction in [0, {PAGE_PAD_MAX}]")


def page_pad_rect(ov: Mapping[str, Any]) -> tuple[float, float, float, float] | None:
    """The ``(left, bottom, right, top)`` figure-fraction rect the layout must
    fit in, or ``None`` without a ``page_pad`` override."""
    pad = ov.get("page_pad")
    if not pad:
        return None

    def side(name: str) -> float:
        v = pad.get(name)
        return 0.0 if v is None else float(v)

    return (side("left"), side("bottom"), 1.0 - side("right"), 1.0 - side("top"))


def apply_figure_layout(fig: Any, ov: Mapping[str, Any], *, default_tight: bool = True) -> None:
    """Lay ``fig`` out for export. Explicit ``margins`` (already applied by
    ``_apply_overrides``): nothing to do. ``page_pad``: ``tight_layout``
    inside the padded rect. Neither: matplotlib's plain ``tight_layout``
    when ``default_tight`` (the single-figure path's long-standing default),
    else leave the figure alone (the x-breaks path, which never laid out)."""
    if ov.get("margins"):
        return
    rect = page_pad_rect(ov)
    if rect is None:
        if default_tight:
            fig.tight_layout()
        return
    with warnings.catch_warnings(record=True) as caught:
        # A page too small for its own labels cannot be solved; matplotlib
        # then keeps the previous layout and warns. Relay it to the client
        # (calc.figure_warnings) rather than to a server log nobody reads.
        warnings.simplefilter("always", UserWarning)
        fig.tight_layout(pad=_INNER_PAD, rect=rect)
    if any(issubclass(w.category, UserWarning) for w in caught):
        note_figure_warning(
            "The page is too small for the figure's labels at these margins; "
            "some text may be clipped. Enlarge the page or reduce the margins."
        )
