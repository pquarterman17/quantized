"""Print-safe greyscale export mode (PRIMARY_SOFTWARE_AUDIT_PLAN P3.3).

Pure layer: a series count in -> grey ``#rrggbb`` hex strings out, plus a
style-list transform built on top of it. No matplotlib/fastapi/pydantic
import — a plain colour-space computation, unit-testable without a
renderer, and importable from ``calc.figure``/``calc.figure_y2``/
``calc.figure_break`` (every place a per-series style spec reaches
``calc.figure._plot_kwargs``) without pulling anything heavy in.

Why not just convert each series' OWN colour to a grey via an ordinary
relative-luminance conversion (the "obvious" approach every image editor's
"desaturate" filter uses)? Because two series that differ only in HUE, not
lightness — exactly the case a categorical colour palette is built to keep
visually distinct — can have nearly identical relative luminance (a
saturated red and a saturated green both sit near the middle of the
luminance range). A per-colour conversion then collapses them to
indistinguishable greys, defeating the entire point of a "print-safe" mode:
a reader photocopying the figure would see one curve where the screen showed
two. So every series instead gets an EVENLY SPACED grey by its DISPLAY
POSITION alone — independent of whatever colour it would otherwise draw —
spanning CIE L* (perceptual lightness, not raw sRGB value, so the steps
LOOK evenly spaced rather than merely being evenly spaced numbers) from
`L_MIN` to `L_MAX`. That guarantees a minimum perceptual step between any
two adjacent series regardless of how close their original hues were.

Grey alone still runs out of room past a handful of series (L* has far less
usable range than hue does), so :func:`apply_greyscale` also forces the
dash cycle (and, for a series that already draws a marker, the marker-shape
cycle) by the SAME display position — the export-side half of the P3.3 auto
dash/marker cycle the frontend already ships
(``frontend/src/lib/seriesStyleCycle.ts``). `LINE_CYCLE`/`MARKER_SHAPES`
below are that module's `AUTO_DASH_CYCLE`/`AUTO_MARKER_CYCLE`, copied
verbatim — KEEP IN SYNC WITH `frontend/src/lib/seriesStyleCycle.ts`; a test
(`tests/test_calc_figure_greyscale.py`) pins the two lists equal by reading
that file's source, so drift between them fails the suite rather than
silently disagreeing.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

__all__ = ["L_MIN", "L_MAX", "LINE_CYCLE", "MARKER_SHAPES", "greyscale_ramp", "apply_greyscale"]

# CIE L* target range for the grey ramp. Kept well inside [0, 100]: L*=0 is
# true black (indistinguishable from a heavy grid line or the axis box) and
# L*=100 is true white (invisible against the figure's own white background),
# so both ends are pulled in to stay legible against the preset's own
# spines/grid/background, which greyscale mode leaves untouched.
L_MIN = 15.0
L_MAX = 70.0

# The CIE L*/Y* piecewise-linear threshold (6/29), used by both directions
# of the standard CIE L* <-> relative-luminance conversion below.
_DELTA = 6.0 / 29.0

# Dash cycle for LINES, by series display position — verbatim copy of
# frontend/src/lib/seriesStyleCycle.ts's `AUTO_DASH_CYCLE` (three entries:
# every `LineStyle` value, which is also every value
# `calc.figure._LINESTYLE` accepts). "solid" first so a single-series figure
# (or a series with an explicit line already) is unaffected.
LINE_CYCLE: tuple[str, ...] = ("solid", "dashed", "dotted")

# Marker-glyph cycle for series that already draw a marker, by display
# position — verbatim copy of `AUTO_MARKER_CYCLE` (all eight `MarkerShape`
# members, closed glyphs first, matching `calc.figure._MARKER`'s own table).
MARKER_SHAPES: tuple[str, ...] = (
    "circle", "square", "triangle", "diamond",
    "downtriangle", "plus", "cross", "star",
)


def _y_from_lstar(lstar: float) -> float:
    """Inverse CIE L* -> relative luminance Y (D65 white point, Y=1)."""
    fy = (lstar + 16.0) / 116.0
    if fy > _DELTA:
        return fy**3
    return 3.0 * _DELTA**2 * (fy - 4.0 / 29.0)


def _srgb_channel_from_linear(y: float) -> int:
    """Inverse sRGB gamma: a linear relative luminance -> an 8-bit channel
    (0-255). Used with r=g=b=this value, since an achromatic pixel's three
    channels are identical and therefore each equal to the whole triple's
    relative luminance."""
    y = min(1.0, max(0.0, y))
    s = y * 12.92 if y <= 0.0031308 else 1.055 * (y ** (1.0 / 2.4)) - 0.055
    return round(min(1.0, max(0.0, s)) * 255)


def _hex_from_lstar(lstar: float) -> str:
    v = _srgb_channel_from_linear(_y_from_lstar(lstar))
    return f"#{v:02x}{v:02x}{v:02x}"


def greyscale_ramp(n: int, *, l_min: float = L_MIN, l_max: float = L_MAX) -> list[str]:
    """``n`` evenly spaced greys (``#rrggbb``), one per series DISPLAY
    POSITION (index ``0..n-1``), spanning CIE L* ``l_min..l_max`` ascending —
    position 0 is the darkest, position ``n-1`` the lightest. Guarantees a
    minimum step of ``(l_max - l_min) / (n - 1)`` in L* between any two
    positions (every pair, not just adjacent ones, since the ramp is
    monotonic) — independent of any actual series colour; see the module
    header for why. ``n <= 0`` returns ``[]``; ``n == 1`` returns the ramp's
    midpoint (there is no "adjacent series" to separate from)."""
    if n <= 0:
        return []
    if n == 1:
        return [_hex_from_lstar((l_min + l_max) / 2.0)]
    step = (l_max - l_min) / (n - 1)
    return [_hex_from_lstar(l_min + step * i) for i in range(n)]


def apply_greyscale(
    styles: Sequence[Mapping[str, Any] | None] | None,
    n: int,
) -> list[dict[str, Any]]:
    """Return a NEW list of ``n`` style specs (never mutates ``styles``) with
    every series' colour overridden to :func:`greyscale_ramp`'s grey at its
    display position, and the dash/marker cycle FORCED by that same
    position — a grey ramp alone runs out of separable steps well before
    ``n`` gets large, so greyscale mode does not rely on it alone. Explicit
    per-series choices still win, matching the frontend cycle's own
    contract (`seriesStyleCycle.resolveSeriesStyle`'s doc): a series with an
    explicit ``line`` keeps it, and a series with an explicit
    ``marker_shape`` keeps that too. The marker SHAPE is cycled only for a
    series that already draws a marker (``spec["marker"]`` true) — greyscale
    does not turn markers on for a series that did not request one, the same
    restraint the frontend cycle applies (a plot with no markers at all
    should not suddenly grow eight circles/squares/triangles).

    A ``color_by`` (MAIN #14 colour-mapped scatter) series is passed through
    UNCHANGED, colourmap included: greyscale here targets the CATEGORICAL
    series-to-series distinction a palette exists for, not a scatter whose
    colour is itself the plotted quantity — forcing that to grey would
    delete the information the plot exists to show, not print-safe it. A
    ``fill``/``vs`` reference is preserved verbatim; the fill it produces
    inherits the (now grey) line colour automatically, same as before this
    function existed.

    ``styles`` entries beyond ``n`` are ignored; a missing/short list is
    treated as an all-``None`` list of length ``n`` (matching every other
    caller's ``series_styles[i] if series_styles and i < len(series_styles)
    else None`` convention)."""
    ramp = greyscale_ramp(n)
    out: list[dict[str, Any]] = []
    for i in range(n):
        raw = styles[i] if styles and i < len(styles) else None
        spec: dict[str, Any] = dict(raw) if raw else {}
        if spec.get("color_by") is not None:
            out.append(spec)  # untouched -- see the doc above
            continue
        spec["color"] = ramp[i]
        if not spec.get("line"):
            spec["line"] = LINE_CYCLE[i % len(LINE_CYCLE)]
        if spec.get("marker") and not spec.get("marker_shape"):
            spec["marker_shape"] = MARKER_SHAPES[i % len(MARKER_SHAPES)]
        out.append(spec)
    return out
