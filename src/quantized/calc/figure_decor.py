"""Reference-line and region-shade overrides (export-fidelity gap, 2026-08-11)
-- export parity for the screen's ``lib/uplotOverlays.ts`` refLinePlugin /
regionShadePlugin. `PlotView` has carried `refLines`/`regionShades` since
before publication export existed (both persist in `.dwk` and are canonical
`decor.referenceLines`/`decor.regionShades` document fields -- see
`lib/figureContract.ts`), but `viewOverrides` never flattened them onto the
export request, so a PDF/SVG/PNG/clipboard copy silently dropped Hc/Tc
markers and Origin-decoded film-stack shading that the screen showed. This
module is the render side of the fix.

Split out of ``figure_overrides.py`` purely to stay under each module's
line-count discipline (same reasoning as ``figure_shapes.py``/
``figure_labels.py``) -- the behavioural contract is still
``figure_overrides``'s for PRIMARY-axis ref lines and region shades:
``_apply_overrides`` calls ``_apply_ref_lines``/``_apply_region_shades`` as
part of its own sweep, on the single ``ax`` it receives.

``RegionShade.axis`` (unlike a shape or annotation) can tag a shade for the
SECONDARY (y2) scale -- but ``ax2`` does not exist yet when
``_apply_overrides`` runs (``figure_y2.render_with_secondary_axis`` creates
it via ``ax.twinx()`` only AFTER the primary ``draw_series_axes`` call, of
which ``_apply_overrides`` is the last step). Rather than thread a new
"is a y2 axes about to exist" flag through ``draw_series_axes`` (whose
signature ``figure_page.py`` also depends on), this mirrors the EXISTING
``y2_lim`` precedent exactly: ``render_with_secondary_axis`` pre-strips
axis-1 shades out of the ``ov`` dict it hands to the primary
``draw_series_axes`` call, then applies them directly to ``ax2`` itself once
it exists, via the SAME ``_apply_region_shades`` this module exports (see
``_split_region_shades_by_axis`` below). A single-axes render (no y2 at all)
never performs this split, so ``_apply_overrides`` sees the FULL
`region_shades` list including any axis-1 entries -- which is the correct
fallback: the screen's own plugin does the same (`u.scales.y2 != null`
gates the y2 lookup; absent a y2 scale, an axis-1 shade still draws, just on
the primary scale, matching `annotationLayout`'s identical axis-1 fallback).

``RefLine`` has no secondary-axis concept at all (`axis: "x" | "y"` only --
the screen never offers a y2 reference line), so ``_apply_ref_lines`` only
ever targets the primary ``ax``.

Pure layer: mapping in -> mutates the passed matplotlib Axes, no return
value. No fastapi/pydantic/starlette/routes imports.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

from matplotlib.patches import Rectangle

from quantized.calc.figure_warnings import note_figure_warning

__all__ = [
    "REGION_SHADE_ALPHA",
    "_apply_ref_lines",
    "_apply_region_shades",
    "_split_region_shades_by_axis",
    "_validate_ref_lines",
    "_validate_region_shades",
]

# Mirrors lib/uplotOverlays.ts's REGION_SHADE_ALPHA exactly: Origin's own
# fill-transparency field is undecoded (decode-plan #41 -- no byte could be
# isolated across the corpus), so this is a documented presentation choice,
# not a decoded value -- pale enough that data drawn over the band stays
# legible, matching Origin's pastel render.
REGION_SHADE_ALPHA = 0.25

# `zorder=0` is BELOW matplotlib's own Patch default (1) and Line2D default
# (2) -- with the codebase's untouched `axes.axisbelow` rcParam default
# ("line": gridlines paint above patches but below data lines), a shade at
# zorder 0 lands behind the grid AND the data regardless of add order
# (matplotlib composites by zorder, not call order) -- matching the screen,
# where `regionShadePlugin` draws in uPlot's `drawClear` hook, which fires
# immediately after the canvas clears, before the grid/axes/series paint
# over it (see that plugin's own doc in lib/uplotOverlays.ts).
_REGION_SHADE_ZORDER = 0

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

# Reference lines mirror the screen's dashed `inkDimColor` stroke in SPIRIT,
# not pixel-for-pixel: `inkDimColor` is a themed CSS custom property
# (`--ink-dim-on-light`/`--ink-dim-on-dark`) with no export equivalent --
# publication export always targets a fixed white/print background, so a
# plain neutral ink reads correctly regardless of the screen's current
# theme, the same "Origin-parity-in-spirit" caveat `_apply_overrides`'s
# page-anchor y-flip and `figure_shapes.py`'s `_DEFAULT_STROKE` already
# document for comparable screen<->print gaps.
_REF_LINE_COLOR = "black"
_REF_LINE_WIDTH = 1.0
# Matches refLinePlugin's `ctx.setLineDash([5, 4])` numerically; canvas CSS
# px and matplotlib's dash points are not the same physical unit, so this is
# an approximate visual match (same dash RHYTHM), not an exact conversion.
_REF_LINE_DASH = (5.0, 4.0)


def _validate_ref_lines(ref_lines: Sequence[Mapping[str, Any]] | None) -> None:
    """Raise ``ValueError`` on a malformed reference line (bad axis,
    non-finite value); an unknown/missing key inside is otherwise tolerant,
    mirroring ``figure_shapes._validate_shapes``."""
    if not ref_lines:
        return
    for rl in ref_lines:
        axis = rl.get("axis")
        if axis not in ("x", "y"):
            raise ValueError("ref_lines axis must be 'x' or 'y'")
        value = rl.get("value")
        bad_value = (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
        )
        if bad_value:
            raise ValueError("ref_lines value must be a finite number")
        stick = rl.get("stick")
        if stick is not None:
            if axis != "x" or not isinstance(stick, Mapping):
                raise ValueError("ref_lines stick must be an object on the x axis")
            for key in ("intensity", "baseline", "height"):
                number = stick.get(key)
                if (
                    not isinstance(number, (int, float))
                    or isinstance(number, bool)
                    or not math.isfinite(number)
                ):
                    raise ValueError(f"ref_lines stick {key} must be a finite number")
            intensity = float(stick["intensity"])
            baseline = float(stick["baseline"])
            height = float(stick["height"])
            if not 0 <= intensity <= 1:
                raise ValueError("ref_lines stick intensity must be between 0 and 1")
            if not 0 <= baseline < 1:
                raise ValueError("ref_lines stick baseline must be between 0 and 1")
            if height <= 0 or baseline + height > 1:
                raise ValueError("ref_lines stick height must fit inside the plot")
            color = stick.get("color")
            if not isinstance(color, str) or not _HEX_COLOR_RE.match(color):
                raise ValueError("ref_lines stick color must be a '#RRGGBB' color string")
            for key in ("visible", "show_label"):
                if not isinstance(stick.get(key), bool):
                    raise ValueError(f"ref_lines stick {key} must be boolean")


def _validate_region_shades(shades: Sequence[Mapping[str, Any]] | None) -> None:
    """Raise ``ValueError`` on a malformed region shade (non-finite
    coordinate, malformed fill color, bad axis tag)."""
    if not shades:
        return
    for sh in shades:
        full = sh.get("full_height")
        if full is not None and not isinstance(full, bool):
            raise ValueError("region_shades full_height must be a boolean")
        # A full-height shade spans the axes (axes fraction), so its y1/y2
        # are not needed -- the screen still sends them, harmlessly.
        for key in ("x1", "x2") if full else ("x1", "x2", "y1", "y2"):
            v = sh.get(key)
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
                raise ValueError(f"region_shades {key} must be a finite number")
        fill = sh.get("fill")
        if not isinstance(fill, str) or not _HEX_COLOR_RE.match(fill):
            raise ValueError("region_shades fill must be a '#RRGGBB' color string")
        axis = sh.get("axis")
        if axis is not None and axis not in (0, 1):
            raise ValueError("region_shades axis must be 0 or 1")


@contextmanager
def _outside_autoscale(ax: Any) -> Iterator[None]:
    """Keep artists added inside out of ``ax``'s data limits. The screen
    ranges its scales from the series alone and paints decor in uPlot hooks;
    matplotlib's ``axvline``/``axhline``/``add_patch`` would otherwise widen
    the exported autoscale to reach a reference line or shade off the data."""
    lim = ax.dataLim.frozen()
    ignore = ax.ignore_existing_data_limits
    try:
        yield
    finally:
        ax.dataLim.set(lim)
        ax.ignore_existing_data_limits = ignore


def _apply_ref_lines(ax: Any, ref_lines: Sequence[Mapping[str, Any]] | None) -> None:
    """Draw dashed reference lines at fixed X/Y DATA values on ``ax`` -- the
    export counterpart of ``refLinePlugin``. Always the PRIMARY axes (see
    this module's header). Called from ``_apply_overrides``, itself
    ``draw_series_axes``'s LAST step -- the series are already plotted on
    ``ax`` by the time this runs, so a tied default Line2D zorder (2, same
    as ``axvline``/``axhline``'s own default) keeps these lines ON TOP of
    the data via matplotlib's add-order tiebreak, matching the screen: the
    screen's `refLinePlugin` draws in uPlot's `draw` hook, which fires AFTER
    every series is painted (unlike `regionShadePlugin`'s `drawClear`) --
    verified against the plugin source, not assumed."""
    if not ref_lines:
        return
    for index, rl in enumerate(ref_lines):
        value = float(rl["value"])
        stick = rl.get("stick")
        if isinstance(stick, Mapping):
            if not stick["visible"]:
                continue
            bottom = float(stick["baseline"])
            top = bottom + float(stick["height"]) * float(stick["intensity"])
            with _outside_autoscale(ax):
                ax.axvline(
                    value,
                    ymin=bottom,
                    ymax=top,
                    color=str(stick["color"]),
                    linewidth=1.2,
                    linestyle="-",
                    gid=f"refline:{index}",
                )
                label = rl.get("label")
                if stick["show_label"] and isinstance(label, str) and label:
                    ax.text(
                        value,
                        top,
                        label,
                        transform=ax.get_xaxis_transform(),
                        rotation=90,
                        ha="center",
                        va="bottom",
                        fontsize="x-small",
                        color=str(stick["color"]),
                        clip_on=True,
                    )
            continue
        # ``gid`` is matplotlib's own artist-identity slot and is the ONLY
        # thing ``figure_hitmap.collect_map`` uses to tell a reference line
        # apart from a series ``Line2D`` -- both land in ``ax.lines``, and
        # colour-mapped series are not in ``ax.lines`` at all, so a positional
        # rule would misalign (see collect_map's own ``series_artists`` doc).
        # The index is this SEQUENCE's index; the client re-derives which of
        # its own reference lines that is by applying the same finite filter
        # ``viewOverrides`` used to build the sequence.
        line_kw = dict(
            color=_REF_LINE_COLOR,
            linewidth=_REF_LINE_WIDTH,
            dashes=_REF_LINE_DASH,
            gid=f"refline:{index}",
        )
        with _outside_autoscale(ax):
            if rl["axis"] == "x":
                ax.axvline(value, **line_kw)
            else:
                ax.axhline(value, **line_kw)
        # An off-scale line draws nothing; say so (audit #11) rather than
        # export a figure silently missing the marker the user added.
        label = rl.get("label")
        name = (
            f"Reference line '{label}'" if label else f"Reference line {rl['axis']} = {_fmt(value)}"
        )
        _warn_if_outside(ax, str(rl["axis"]), value, value, name, named=not label)


def _apply_region_shades(ax: Any, shades: Sequence[Mapping[str, Any]] | None) -> None:
    """Draw translucent filled rectangles on ``ax`` at DATA coordinates --
    the export counterpart of ``regionShadePlugin``. Axis routing (which
    shades belong on THIS axes) is entirely the CALLER's job -- see this
    module's header and ``_split_region_shades_by_axis`` below; this
    function draws whatever list it is given, unconditionally, onto
    whichever ``ax`` it is given.

    ``full_height`` (the default for a newly inserted shade, publication-
    figures audit #11) spans the whole axes height -- y in axes fraction, so
    it reads the same on a linear or a log axis and never depends on the y
    data. A data-coordinate shade on a log axis with a side <= 0 (y1 = 0,
    the old default) runs from the axis floor instead of vanishing; one that
    still cannot be seen is reported (``calc.figure_warnings``), never
    dropped silently."""
    if not shades:
        return
    for index, sh in enumerate(shades):
        x0, x1 = sorted((float(sh["x1"]), float(sh["x2"])))
        what = f"Region shade {index + 1}"
        style: dict[str, Any] = {
            "facecolor": str(sh["fill"]),
            "edgecolor": "none",
            "alpha": REGION_SHADE_ALPHA,
            "zorder": _REGION_SHADE_ZORDER,
        }
        with _outside_autoscale(ax):
            if sh.get("full_height"):
                ax.axvspan(x0, x1, ymin=0.0, ymax=1.0, **style)
                _warn_if_outside(ax, "x", x0, x1, what)
                continue
            y0, y1 = sorted((float(sh["y1"]), float(sh["y2"])))
            if ax.get_yscale() == "log" and y0 <= 0:
                y0 = min(ax.get_ylim())  # the axis floor: <= 0 has no position
            if y1 <= y0:
                note_figure_warning(
                    f"{what} lies at or below zero on a log axis and cannot be "
                    "drawn; use a full-height shade or positive y values."
                )
                continue
            ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, **style))
            _warn_if_outside(ax, "x", x0, x1, what)
            _warn_if_outside(ax, "y", y0, y1, what)


def _warn_if_outside(
    ax: Any, axis: str, lo: float, hi: float, what: str, *, named: bool = False
) -> None:
    """Note a render warning when ``[lo, hi]`` misses ``ax``'s ``axis`` view
    entirely -- an object the user placed that the figure will not show.
    ``named``: ``what`` already states the position (an unlabelled reference
    line's "x = 8000"), so it is not repeated."""
    a, b = sorted(ax.get_xlim() if axis == "x" else ax.get_ylim())
    if hi < a or lo > b:
        span = _fmt(lo) if lo == hi else f"{_fmt(lo)} to {_fmt(hi)}"
        where = "" if named else f" ({axis} {span})"
        note_figure_warning(
            f"{what}{where} is outside the {axis} axis range "
            f"({_fmt(a)} to {_fmt(b)}) and is not visible."
        )


def _fmt(v: float) -> str:
    return f"{v:.4g}"


def _split_region_shades_by_axis(
    shades: Sequence[Mapping[str, Any]] | None,
) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
    """(primary, secondary) subsets of ``shades`` by their ``axis`` tag (0/
    absent vs 1) -- the ONE place the axis-1 predicate is evaluated, so
    ``figure_y2.render_with_secondary_axis`` (the only caller) can pre-strip
    axis-1 entries from the ``ov`` it hands to the primary
    ``draw_series_axes`` call and apply them to ``ax2`` itself once it
    exists, mirroring the existing ``y2_lim`` precedent (see this module's
    header)."""
    if not shades:
        return [], []
    primary = [s for s in shades if s.get("axis") != 1]
    secondary = [s for s in shades if s.get("axis") == 1]
    return primary, secondary
