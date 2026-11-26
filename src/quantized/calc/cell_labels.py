"""Heatmap cell labels: how a cell's value is printed, which ink reads against
the cell's colour, and when a cell is too small to label.

The map canvas (``frontend/src/lib/cellLabels.ts``) applies the same three
rules, pinned by ``tests/fixtures/wire/annotation_measures.json``
(``tests/test_cell_labels.py`` and ``frontend/src/lib/cellLabels.test.ts``).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from quantized.calc.annotation_measure import NOT_AVAILABLE, fmt_fixed, fmt_sig

__all__ = [
    "CELL_FORMATS",
    "DEFAULT_PRECISION",
    "cell_label_fits",
    "contrast_text_color",
    "format_cell_value",
    "native_cell_spots",
]

CELL_FORMATS = ("general", "fixed", "scientific")
DEFAULT_PRECISION = 3
MAX_PRECISION = 8
# A label is as wide as its characters at this fraction of the font size and
# needs this much clear room around it (both fractions of the font size).
_CHAR_WIDTH_EM = 0.6
_PAD_EM = 0.4
_LINE_EM = 1.2


def _scientific(v: float, decimals: int) -> str:
    if v == 0:
        return "0"
    mant, _, exp_s = f"{v:.{decimals}e}".partition("e")
    exp = int(exp_s)
    return f"{mant}e{'+' if exp >= 0 else '-'}{abs(exp)}"


def format_cell_value(v: float, fmt: str = "general", precision: int = DEFAULT_PRECISION) -> str:
    """``v`` as a cell label. ``general`` keeps ``precision`` significant digits
    (trailing zeros dropped), ``fixed`` keeps ``precision`` decimals and
    ``scientific`` keeps ``precision`` decimals of the mantissa. A non-finite
    value has no label (``n/a``)."""
    if not math.isfinite(v):
        return NOT_AVAILABLE
    p = max(0, min(MAX_PRECISION, int(precision)))
    if fmt == "fixed":
        return fmt_fixed(v, p)
    if fmt == "scientific":
        return _scientific(v, p)
    return fmt_sig(v, max(1, p))


def _linear(channel: float) -> float:
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def contrast_text_color(r: float, g: float, b: float) -> str:
    """Black or white, whichever has the higher WCAG contrast ratio against an
    sRGB colour (channels 0..255): white on a relative luminance of 0.179 or
    less, the point where the two ratios are equal."""
    lum = 0.2126 * _linear(r) + 0.7152 * _linear(g) + 0.0722 * _linear(b)
    return "#ffffff" if lum <= 0.179 else "#000000"


def cell_label_fits(cell_w: float, cell_h: float, text: str, font_size: float) -> bool:
    """Whether ``text`` at ``font_size`` fits inside a ``cell_w`` x ``cell_h``
    cell (all in the same unit, pixels or points)."""
    if not text or font_size <= 0:
        return False
    need_w = len(text) * font_size * _CHAR_WIDTH_EM + font_size * _PAD_EM
    return cell_w >= need_w and cell_h >= font_size * _LINE_EM


def _cell_bounds(axis: Sequence[float], k: int, lo: float, hi: float) -> tuple[float, float]:
    """The part of cell ``k`` (centred on ``axis[k]``, edges halfway to its
    neighbours) that lies inside the frame ``[lo, hi]``: the first and last
    cells are cut in half by the frame, exactly as the heatmap draws them."""
    left = (axis[k - 1] + axis[k]) / 2 if k > 0 else axis[0]
    right = (axis[k] + axis[k + 1]) / 2 if k < len(axis) - 1 else axis[-1]
    return max(min(lo, hi), left), min(max(lo, hi), right)


def native_cell_spots(
    x: Sequence[float],
    y: Sequence[float],
    values: Sequence[Sequence[float | None]],
    frame: tuple[float, float, float, float],
    size: tuple[float, float],
    fmt: str = "general",
    precision: int = DEFAULT_PRECISION,
    font: float = 10.0,
) -> list[dict[str, Any]]:
    """The labels for the MEASURED cells of a map: one per finite value of the
    ``(ny, nx)`` native lattice ``values`` over the ascending axes ``x`` / ``y``,
    whatever grid the heatmap is displayed on (a 6 x 6 scan shown on a 100 x 100
    display grid is still 36 cells, not 10,000 slivers).

    ``frame`` is the plot frame ``(x0, x1, y0, y1)`` in data units and ``size``
    its ``(width, height)`` in the unit of ``font`` (pixels on screen, points in
    the export). A cell spans halfway to its neighbours, clipped to the frame; its
    label sits at the centre of that visible part and is dropped when the text does
    not fit it (:func:`cell_label_fits`). Each spot is ``{i, j, text, x, y}`` with
    ``(x, y)`` in data units and the text of the RAW value. The screen
    (``lib/cellLabelsNative.ts``) applies the same rules, pinned by
    ``tests/fixtures/wire/annotation_measures.json`` (``cell_native``)."""
    x0, x1, y0, y1 = frame
    span_x, span_y = abs(x1 - x0), abs(y1 - y0)
    if len(x) < 2 or len(y) < 2 or span_x == 0 or span_y == 0:
        return []
    spots: list[dict[str, Any]] = []
    for j in range(len(y)):
        bottom, top = _cell_bounds(y, j, y0, y1)
        cell_h = size[1] * (top - bottom) / span_y
        for i in range(len(x)):
            v = values[j][i]
            if v is None or not math.isfinite(v):
                continue
            left, right = _cell_bounds(x, i, x0, x1)
            text = format_cell_value(float(v), fmt, precision)
            if not cell_label_fits(size[0] * (right - left) / span_x, cell_h, text, font):
                continue
            spots.append(
                {"i": i, "j": j, "text": text, "x": (left + right) / 2, "y": (bottom + top) / 2}
            )
    return spots
