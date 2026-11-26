"""The measurement annotations' shared rules: slope (with the power-law
exponent on log axes), distance, three-point angle and scale bar.

These are pure functions of the shape's data coordinates and the axis scales,
and the screen (``frontend/src/lib/annotationMeasure.ts``) implements the very
same rules, so a label reads identically on the canvas and in the exported
figure. ``tests/fixtures/wire/annotation_measures.json`` is the one table both
sides assert (``tests/test_annotation_measure.py`` and
``frontend/src/lib/annotationMeasure.test.ts``).

Everything here is in DATA units: a distance is ``hypot(dx, dy)`` of the data
coordinates and an angle is measured between the data-space arms, whatever the
axis scales or the plot's aspect ratio. Only the slope looks at the scales: on a
log-log plot it is the exponent ``d log10 y / d log10 x``, the number a
power-law line has.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

__all__ = [
    "MEASURE_KINDS",
    "angle_degrees",
    "distance_parts",
    "fmt_fixed",
    "fmt_sig",
    "label_below",
    "scalebar_end",
    "shape_label",
    "slope_measure",
    "slope_triangle",
]

MEASURE_KINDS = frozenset({"slope", "distance", "angle", "scalebar"})
INFINITY = "\u221e"
NOT_AVAILABLE = "n/a"


def fmt_sig(v: float, digits: int = 3) -> str:
    """``v`` to ``digits`` significant digits, trailing zeros dropped, and
    scientific (``1.23e+4``, no exponent padding) outside ``1e-4 <= |v| <
    10**digits``. The same text the screen's ``fmtSig`` prints."""
    if math.isnan(v):
        return NOT_AVAILABLE
    if math.isinf(v):
        return INFINITY if v > 0 else "-" + INFINITY
    if v == 0:
        return "0"
    mant, _, exp_s = f"{v:.{digits - 1}e}".partition("e")
    exp = int(exp_s)
    if exp < -4 or exp >= digits:
        mant = mant.rstrip("0").rstrip(".") if "." in mant else mant
        return f"{mant}e{'+' if exp >= 0 else '-'}{abs(exp)}"
    text = f"{v:.{max(0, digits - 1 - exp)}f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def fmt_fixed(v: float, decimals: int) -> str:
    """``v`` with ``decimals`` places; a value that rounds to zero is ``0``
    without a sign."""
    text = f"{v:.{decimals}f}"
    return text[1:] if text.startswith("-") and float(text) == 0 else text


def _log10(v: float) -> float | None:
    return math.log10(v) if v > 0 else None


def slope_measure(
    x1: float, y1: float, x2: float, y2: float, xlog: bool, ylog: bool
) -> dict[str, Any]:
    """The slope of the segment (x1, y1)-(x2, y2) in data units.

    ``mode`` is ``linear`` (dy/dx), ``exponent`` (both axes log: d log10 y /
    d log10 x), ``semilog_x`` (x log: dy / d log10 x) or ``semilog_y`` (y log:
    d log10 y / dx). ``value`` is ``None`` for a vertical segment or a log axis
    that sees a non-positive coordinate; ``label`` is the text drawn."""
    mode = (
        "exponent" if xlog and ylog else "semilog_x" if xlog else "semilog_y" if ylog else "linear"
    )
    xs = (_log10(x1), _log10(x2)) if xlog else (x1, x2)
    ys = (_log10(y1), _log10(y2)) if ylog else (y1, y2)
    prefix = {
        "linear": "slope = ",
        "exponent": "n = ",
        "semilog_x": "dy/dlog10(x) = ",
        "semilog_y": "dlog10(y)/dx = ",
    }[mode]
    if None in xs or None in ys:
        return {"mode": mode, "value": None, "label": prefix + NOT_AVAILABLE}
    dx = xs[1] - xs[0]  # type: ignore[operator]
    dy = ys[1] - ys[0]  # type: ignore[operator]
    if dx == 0:
        return {"mode": mode, "value": None, "label": prefix + INFINITY}
    value = dy / dx
    return {"mode": mode, "value": value, "label": prefix + fmt_sig(value)}


def distance_parts(x1: float, y1: float, x2: float, y2: float) -> dict[str, Any]:
    """``d`` and its X and Y components, in data units, plus the label."""
    dx, dy = x2 - x1, y2 - y1
    d = math.hypot(dx, dy)
    label = f"d = {fmt_sig(d)} (\u0394x = {fmt_sig(dx)}, \u0394y = {fmt_sig(dy)})"
    return {"d": d, "dx": dx, "dy": dy, "label": label}


def angle_degrees(
    vertex: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> float | None:
    """The angle at ``vertex`` between the arms to ``a`` and ``b``, in degrees
    (0..180), in data coordinates; ``None`` when an arm has zero length."""
    ux, uy = a[0] - vertex[0], a[1] - vertex[1]
    vx, vy = b[0] - vertex[0], b[1] - vertex[1]
    nu, nv = math.hypot(ux, uy), math.hypot(vx, vy)
    if nu == 0 or nv == 0:
        return None
    cos = max(-1.0, min(1.0, (ux * vx + uy * vy) / (nu * nv)))
    return math.degrees(math.acos(cos))


def scalebar_end(
    x1: float, y1: float, orient: str, length: float
) -> tuple[float, float]:
    """The far end of a scale bar: ``length`` data units from (x1, y1) along X
    (``h``) or Y (``v``)."""
    return (x1 + length, y1) if orient != "v" else (x1, y1 + length)


def slope_triangle(
    x1: float, y1: float, x2: float, y2: float
) -> list[tuple[float, float]]:
    """The slope marker's right triangle: the segment's two ends and the
    corner at (x2, y1), so both legs are axis-aligned on any axis scale."""
    return [(x1, y1), (x2, y1), (x2, y2)]


def label_below(x1: float, y1: float, x2: float, y2: float) -> bool:
    """Whether a segment's label sits below-right of its midpoint (a rising
    segment, whose upper-right is crowded by the line) rather than above."""
    return (x2 - x1) * (y2 - y1) > 0


def shape_label(sh: Mapping[str, Any], xlog: bool, ylog: bool) -> str | None:
    """The text a measurement shape prints, or ``None`` for any other kind.
    ``sh`` is a wire shape (``overrides.shapes``)."""
    kind = sh.get("kind")
    x1, y1, x2, y2 = (float(sh[k]) for k in ("x1", "y1", "x2", "y2"))
    if kind == "slope":
        return str(slope_measure(x1, y1, x2, y2, xlog, ylog)["label"])
    if kind == "distance":
        return str(distance_parts(x1, y1, x2, y2)["label"])
    if kind == "angle":
        third = (float(sh.get("x3", x1)), float(sh.get("y3", y1)))
        deg = angle_degrees((x1, y1), (x2, y2), third)
        return "\u03b8 = " + (NOT_AVAILABLE if deg is None else fmt_fixed(deg, 1) + "\u00b0")
    if kind == "scalebar":
        text = sh.get("text")
        if isinstance(text, str) and text:
            return text
        return fmt_sig(float(sh.get("length", abs(x2 - x1) or abs(y2 - y1))))
    return None
