"""Print-safe greyscale export mode (PRIMARY_SOFTWARE_AUDIT_PLAN P3.3).

Pure layer: a series count in -> grey ``#rrggbb`` hex strings out, plus a
style-list transform built on top of it (and its facet-grid form,
:func:`greyscale_facet_panels`). No matplotlib/fastapi/pydantic
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

__all__ = [
    "L_MIN",
    "L_MAX",
    "LINE_CYCLE",
    "MARKER_SHAPES",
    "GREY_SLOT_KEY",
    "greyscale_ramp",
    "apply_greyscale",
    "greyscale_facet_panels",
]

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


# Per-series style key naming the series' GREY SLOT (an ``int``): series that
# share a slot share one grey, dash and glyph. Set only server-side, by
# ``calc.plotting_encoded.encoded_series_styles`` for a P1.4 colour factor (the
# slot is the colour LEVEL, so one level greys alike on every Y channel, as it
# colours alike on screen); :func:`apply_greyscale` consumes and removes it.
# ``calc.plotting_encoded_facets`` also sets it on each encoded facet SERIES
# dict (beside its ``style``, U2), read by :func:`greyscale_facet_panels`.
GREY_SLOT_KEY = "grey_slot"


def _grey_keys(
    styles: Sequence[Mapping[str, Any] | None] | None, n: int
) -> tuple[list[int], int]:
    """Each series' index into the ramp, and the ramp's length: the RANK of its
    grey slot among the distinct slots present when every ramped series (all
    but ``color_by``) names one, else its display position over ``n`` -- P3.3's
    own rule, and the fallback for any request that mixes slotted and
    unslotted series. A ``color_by`` series' entry is never read."""
    raw = [styles[i] if styles and i < len(styles) else None for i in range(n)]
    ramped = [s for s in raw if not (s and s.get("color_by") is not None)]
    slots = [s.get(GREY_SLOT_KEY) if s else None for s in ramped]
    ints = [k for k in slots if isinstance(k, int) and not isinstance(k, bool)]
    if not slots or len(ints) != len(slots):
        return list(range(n)), n
    rank = {k: r for r, k in enumerate(sorted(set(ints)))}
    keys = [rank[s[GREY_SLOT_KEY]] if s and s.get("color_by") is None else 0 for s in raw]
    return keys, len(rank)


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
    else None`` convention).

    GREY SLOTS (P1.4): when every ramped series carries :data:`GREY_SLOT_KEY`,
    the ramp spans the distinct slots instead of the series, and grey, dash and
    glyph are all picked by the slot's rank -- an encoded figure's colour LEVEL,
    so a level that shares one colour across Y channels on screen shares one
    grey (and one dash/glyph) here too. The key never leaves this function."""
    keys, n_ramp = _grey_keys(styles, n)
    ramp = greyscale_ramp(n_ramp)
    out: list[dict[str, Any]] = []
    for i in range(n):
        raw = styles[i] if styles and i < len(styles) else None
        spec: dict[str, Any] = dict(raw) if raw else {}
        spec.pop(GREY_SLOT_KEY, None)
        if spec.get("color_by") is not None:
            out.append(spec)  # untouched -- see the doc above
            continue
        k = keys[i]
        spec["color"] = ramp[k]
        if not spec.get("line"):
            spec["line"] = LINE_CYCLE[k % len(LINE_CYCLE)]
        if spec.get("marker") and not spec.get("marker_shape"):
            spec["marker_shape"] = MARKER_SHAPES[k % len(MARKER_SHAPES)]
        out.append(spec)
    return out


def _is_mapped(style: Mapping[str, Any] | None) -> bool:
    """A ``color_by`` series: its colour is the plotted quantity, never greyed."""
    return style is not None and style.get("color_by") is not None


def greyscale_facet_panels(panels: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """:func:`apply_greyscale` over an xy FACET grid (U2): NEW panel dicts
    (``panels`` is never mutated) whose series styles are greyed ONCE over the
    whole grid, so a series keeps one grey, dash and glyph in every panel, as
    it keeps one colour on screen.

    A series' grid-wide key is the series-level :data:`GREY_SLOT_KEY` when
    every series carries one (an encoded grid, ``calc.plotting_encoded_facets``:
    its colour level, else its place in the grid's split). Otherwise it is the
    series' ``label`` plus that label's repeat count inside its panel: an
    unencoded grid's series are its channels, and a panel can resolve a
    different channel list than its neighbours (FEATURE-001), so position
    within a panel is not a key. The series-level key is dropped from the
    output."""
    rows = [list(p.get("series") or []) for p in panels]
    flat = [s for r in rows for s in r]
    slotted = bool(flat) and all(
        isinstance(k := s.get(GREY_SLOT_KEY), int) and not isinstance(k, bool) for s in flat
    )
    keys: list[Any] = []
    ids: dict[tuple[str, int], int] = {}
    for r in rows:
        seen: dict[str, int] = {}
        for s in r:
            label = str(s.get("label", ""))
            seen[label] = seen.get(label, 0) + 1
            ident = ids.setdefault((label, seen[label]), len(ids))
            keys.append(s[GREY_SLOT_KEY] if slotted else ident)
    styles: list[Mapping[str, Any] | None] = []
    for s, k in zip(flat, keys, strict=True):
        st = s.get("style") if isinstance(s.get("style"), Mapping) else None
        styles.append(st if _is_mapped(st) else {**(st or {}), GREY_SLOT_KEY: k})
    greyed = iter(apply_greyscale(styles, len(styles)))
    return [
        {
            **p,
            "series": [
                {**{k: v for k, v in s.items() if k != GREY_SLOT_KEY}, "style": next(greyed)}
                for s in r
            ],
        }
        for p, r in zip(panels, rows, strict=True)
    ]
