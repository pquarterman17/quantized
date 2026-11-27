"""The 2-D map's scale bar: how long it is, what it says and where it sits.

The map is drawn on screen (``frontend/src/components/Stage/mapScaleBarDraw.ts``)
and in the vector export (``calc.figure_map_scalebar``); both take these three
rules from here, and ``frontend/src/lib/mapScaleBar.ts`` implements the same ones,
pinned by ``tests/fixtures/wire/map_scalebar.json``:

* **length**: the bar's own, in the map's X data units, or when none is set a
  round number near 20 % of the axis width (:func:`nice_length`);
* **label**: the user's text, or the length with the axis unit (``200 nm``);
* **placement**: a corner of the plot area, inset, the label under the bar and
  centred on it, pushed back inside the frame when it is wider than the bar.

Placement is in one plane with y growing downward, in SCREEN pixels (the export
converts its own display pixels), so the bar looks the same in both.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from quantized.calc.annotation_measure import fit_label_box, fmt_sig

__all__ = [
    "BAR_PX",
    "CORNERS",
    "DEFAULT_COLOR",
    "MARGIN_PX",
    "check_scale_bar",
    "nice_length",
    "resolve_scale_bar",
    "scale_bar_layout",
]

CORNERS = ("bl", "br", "tl", "tr")
DEFAULT_COLOR = "#ffffff"
BAR_PX = 3.0  # the bar's thickness
MARGIN_PX = 12.0  # the bar's inset from the frame
GAP_PX = 4.0  # between the bar and its label
_TARGET_SHARE = 0.2  # an automatic bar spans about this much of the axis
_STEPS = (1.0, 2.0, 5.0, 10.0)


def check_scale_bar(spec: Mapping[str, Any] | None) -> None:
    """Raise ``ValueError`` on a malformed scale bar option."""
    if spec is None:
        return
    length = spec.get("length")
    bad_type = isinstance(length, bool) or not isinstance(length, (int, float))
    if length is not None and (bad_type or not 0 < length < math.inf):
        raise ValueError("scale bar length must be a positive number")
    if spec.get("corner", "br") not in CORNERS:
        raise ValueError(f"scale bar corner must be one of {CORNERS}")


def nice_length(span: float) -> float | None:
    """A round bar length (1, 2 or 5 times a power of ten) nearest to 20 % of
    ``span``; ``None`` for a span that is not a positive finite number."""
    if not 0 < span < math.inf:
        return None
    target = _TARGET_SHARE * span
    mag = 10.0 ** math.floor(math.log10(target))
    best = min((s * mag for s in _STEPS), key=lambda c: abs(c - target))
    return float(f"{best:.12g}")


def resolve_scale_bar(spec: Mapping[str, Any], span: float) -> tuple[float, str] | None:
    """The bar's ``(length, text)`` over an axis ``span`` wide, or ``None`` when
    there is no usable length (no length set and a degenerate span). ``spec["unit"]``
    is the axis unit an automatic label carries."""
    length = spec.get("length")
    length = float(length) if length else nice_length(span)
    if length is None:
        return None
    label, unit = spec.get("label"), str(spec.get("unit") or "")
    auto = fmt_sig(length) + (f" {unit}" if unit else "")
    text = label if isinstance(label, str) and label else auto
    return length, text


def scale_bar_layout(
    corner: str, plot_w: float, plot_h: float, bar_px: float, text_w: float, text_h: float
) -> dict[str, float]:
    """Where the bar (``x0``..``x1`` at height ``y``, the centre of its line) and
    its label (top-left ``label_left``, ``label_top``) go in a ``plot_w`` x
    ``plot_h`` frame, for a bar ``bar_px`` long and a ``text_w`` x ``text_h`` label."""
    x0 = MARGIN_PX if corner.endswith("l") else plot_w - MARGIN_PX - bar_px
    y = MARGIN_PX if corner.startswith("t") else plot_h - MARGIN_PX - text_h - GAP_PX - BAR_PX / 2
    frame = (0.0, 0.0, plot_w, plot_h)
    left, top = fit_label_box(
        x0 + bar_px / 2 - text_w / 2, y + BAR_PX / 2 + GAP_PX, text_w, text_h, frame
    )
    return {"x0": x0, "x1": x0 + bar_px, "y": y, "label_left": left, "label_top": top}
