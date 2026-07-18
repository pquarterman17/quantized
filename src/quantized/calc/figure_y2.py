"""Secondary (right) Y-axis rendering for figure export (twinx).

Split out of ``calc.figure`` purely to stay under the 500-line god-module
ceiling (mirrors ``figure_break``/``figure_overrides``/``figure_scale``) --
the behavioural contract is still ``calc.figure``'s: ``_render_impl`` lazily
imports :func:`render_with_secondary_axis` exactly once, when its
``y2_mask`` has at least one ``True`` entry (the same lazy-import pattern
``figure_break`` already uses there). Pure layer: no fastapi/pydantic
imports.

``calc.plotting.PlotState.y2_keys``/``PlotSeries.axis`` already carry the
primary-vs-secondary split through the INTERACTIVE series builder (uPlot
draws both scales on one shared canvas); this module is the matplotlib
EXPORT counterpart, which has no such shared-canvas concept -- a real
``Axes.twinx()`` is required instead. That is the whole reason this module
exists: before it, the export route sent every plotted channel (primary
+ y2) to a SINGLE axes, silently flattening the secondary-axis curves onto
the primary scale.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.figure import _apply_fill, _plot_kwargs, draw_series_axes
from quantized.calc.figure_scale import apply_axis_scale, resolve_axis_scale
from quantized.calc.figure_styles import FigureStyle
from quantized.calc.figure_ticks import apply_tick_formats, apply_tick_steps

__all__ = ["draw_secondary_axes", "render_with_secondary_axis"]


def _remap_fill_vs(
    styles: Sequence[Mapping[str, Any] | None] | None,
    keep_map: Mapping[int, int],
) -> list[Mapping[str, Any] | None] | None:
    """Rewrite each style's ``fill: {"vs": <old full-request position>}`` to
    its NEW position within THIS subset (``keep_map``); a fill partner that
    crossed into the OTHER axis group (not in ``keep_map``) is dropped --
    filling between two curves on different scales has no sensible meaning,
    and leaving a stale ``vs`` would otherwise risk it silently resolving to
    the WRONG series post-split (a different series can land at the same
    local index the old one had). Mirrors ``_apply_fill``'s existing
    "unresolvable vs -> no fill" contract rather than introducing a new
    failure mode."""
    if styles is None:
        return None
    out: list[Mapping[str, Any] | None] = []
    for spec in styles:
        fill = spec.get("fill") if spec else None
        if spec and isinstance(fill, Mapping) and isinstance(fill.get("vs"), int):
            new_vs = keep_map.get(fill["vs"])
            spec = (
                {**spec, "fill": {**fill, "vs": new_vs}}
                if new_vs is not None
                else {k: v for k, v in spec.items() if k != "fill"}
            )
        out.append(spec)
    return out


def _split_by_mask(
    series: Sequence[tuple[str, ArrayLike]],
    series_styles: Sequence[Mapping[str, Any] | None] | None,
    y2_mask: Sequence[bool],
) -> tuple[
    list[tuple[str, ArrayLike]],
    list[Mapping[str, Any] | None] | None,
    list[tuple[str, ArrayLike]],
    list[Mapping[str, Any] | None] | None,
]:
    """Split ``series``/``series_styles`` into (primary, y2) subsets by
    ``y2_mask`` (parallel booleans), preserving each group's own relative
    request order -- every series stays bonded to ITS OWN style entry
    across the split (the off-by-one class this function exists to rule
    out)."""
    aligned: list[Mapping[str, Any] | None] | None = None
    if series_styles is not None:
        aligned = [
            series_styles[i] if i < len(series_styles) else None
            for i in range(len(series))
        ]
    primary_map: dict[int, int] = {}
    secondary_map: dict[int, int] = {}
    pi = si = 0
    for old, is_y2 in enumerate(y2_mask):
        if is_y2:
            secondary_map[old] = si
            si += 1
        else:
            primary_map[old] = pi
            pi += 1

    primary = [s for old, s in enumerate(series) if old in primary_map]
    secondary = [s for old, s in enumerate(series) if old in secondary_map]
    primary_styles = None
    secondary_styles = None
    if aligned is not None:
        primary_styles = _remap_fill_vs([aligned[old] for old in primary_map], primary_map)
        secondary_styles = _remap_fill_vs([aligned[old] for old in secondary_map], secondary_map)
    return primary, primary_styles, secondary, secondary_styles


def draw_secondary_axes(
    fig: Any,
    ax2: Any,
    xv: NDArray[np.float64],
    series: Sequence[tuple[str, ArrayLike]],
    *,
    st: FigureStyle,
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
    y_scale: str | None = None,
    y_label: str = "",
    y_fmt: Mapping[str, Any] | None = None,
    y_step: float | None = None,
    color_offset: int = 0,
) -> list[Any]:
    """Plot ``series`` (the y2 subset, in request order) onto an EXISTING
    ``twinx()`` axes: lines, y-axis scale/label/tick-format/step. NO
    overrides sweep, NO legend, NO grid, NO title -- the primary axes owns
    all of those (:func:`render_with_secondary_axis` rebuilds one combined
    legend after both axes are drawn).

    COLOR STABILITY: a fresh ``twinx()`` axes gets its OWN matplotlib prop
    cycle, restarting at C0 -- colliding with whatever the primary axes'
    own auto-cycle already used. Any series here WITHOUT an explicit style
    color is assigned ``C{(color_offset + i) % 10}`` (``i`` = its position
    within THIS y2 subset), continuing the sequence as if it were drawn
    right after the primary series on one shared cycle. ``color_offset`` is
    normally ``len(primary_series)``; the primary axes'
    (:func:`quantized.calc.figure.draw_series_axes`) own auto-cycle is
    never itself touched by this module.

    Returns the per-series drawn artist, in ``series`` order.
    """
    artists: list[Any] = []
    for i, (label, y) in enumerate(series):
        spec = series_styles[i] if series_styles and i < len(series_styles) else None
        yv = np.asarray(y, dtype=float)
        kw = _plot_kwargs(st.line_width, st.marker_size, spec)
        if "color" not in kw:
            kw["color"] = f"C{(color_offset + i) % 10}"
        (line,) = ax2.plot(xv, yv, label=label, **kw)
        _apply_fill(ax2, xv, yv, series, i, spec, line.get_color())
        artists.append(line)
    resolved_y_scale = resolve_axis_scale(y_scale, False)
    apply_axis_scale(ax2, "y", resolved_y_scale)
    apply_tick_steps(ax2, None, y_step, "linear", resolved_y_scale)
    apply_tick_formats(ax2, None, y_fmt)
    if y_label:
        ax2.set_ylabel(y_label)
    return artists


def render_with_secondary_axis(
    fig: Any,
    ax: Any,
    xv: NDArray[np.float64],
    series: Sequence[tuple[str, ArrayLike]],
    series_styles: Sequence[Mapping[str, Any] | None] | None,
    y2_mask: Sequence[bool],
    *,
    st: FigureStyle,
    ov: Mapping[str, Any],
    x_log: bool,
    y_log: bool,
    x_scale: str | None,
    y_scale: str | None,
    title: str,
    x_label: str,
    y_label: str,
    x_fmt: Mapping[str, Any] | None,
    y_fmt: Mapping[str, Any] | None,
    x_step: float | None,
    y_step: float | None,
    y2_label: str,
    y2_scale: str | None,
    y2_fmt: Mapping[str, Any] | None,
    y2_step: float | None,
) -> list[Any]:
    """The twinx orchestration ``calc.figure._render_impl`` dispatches to
    when ``y2_mask`` has at least one ``True`` entry: split ``series`` by
    axis, draw the primary subset via the UNCHANGED
    :func:`quantized.calc.figure.draw_series_axes` (byte-identical to a
    primary-only request for its own subset -- title/labels/spines/grid/
    the override sweep/x_lim/y_lim all still apply to it there), draw the
    y2 subset via :func:`draw_secondary_axes` on a fresh ``ax.twinx()``,
    then -- when a legend is warranted (more than one series total and no
    explicit ``legend`` override, the SAME condition ``draw_series_axes``
    uses for its own subset) -- REBUILD one combined legend on the primary
    axes from both axes' handles+labels, in request order (primary artists
    first, then y2's -- matching today's single-axes draw order).

    ``ov["y2_lim"]`` (fail-soft: absent = autoscale), when present, fixes
    the secondary axis range the SAME way ``x_lim``/``y_lim`` fix the
    primary one (see ``calc.figure_overrides``) -- applied directly here
    rather than through ``_apply_overrides``, since that function only
    ever targets a single axes.

    A ``twinx()`` axes re-adds its own right spine; kept visible even when
    the primary axes hid its own (``draw_series_axes``'s ``box_on``
    branch), or a real secondary axis would read as absent.

    Returns the combined artist list (primary artists, then y2 artists) --
    the figure-hitmap collector (``figure_hitmap.collect_map``) appends y2
    boxes after the primary ones, so a y2 series' ``series:N`` hitmap index
    is its position AFTER all primary series, not its original ``y_keys``
    display position. Accepted as-is: the client (``lib/previewmap.ts``)
    already treats every ``series:*`` id as a plain, non-draggable hit box
    ("per-series styles live on the plot side"), so the index doesn't drive
    any interaction -- only whether SOMETHING is hit-testable there.
    """
    primary, primary_styles, y2_series, y2_styles = _split_by_mask(
        series, series_styles, y2_mask
    )
    artists = draw_series_axes(
        fig, ax, xv, primary,
        st=st, ov=ov, x_log=x_log, y_log=y_log, x_scale=x_scale, y_scale=y_scale,
        title=title, x_label=x_label, y_label=y_label,
        series_styles=primary_styles,
        x_fmt=x_fmt, y_fmt=y_fmt, x_step=x_step, y_step=y_step,
    )
    ax2 = ax.twinx()
    y2_artists = draw_secondary_axes(
        fig, ax2, xv, y2_series,
        st=st, series_styles=y2_styles, y_scale=y2_scale, y_label=y2_label,
        y_fmt=y2_fmt, y_step=y2_step, color_offset=len(primary),
    )
    ax2.spines["right"].set_visible(True)
    y2_lim = ov.get("y2_lim")
    if y2_lim is not None:
        lo, hi = y2_lim
        ax2.set_ylim(None if lo is None else float(lo), None if hi is None else float(hi))
    if len(series) > 1 and "legend" not in ov:
        h1, l1 = ax.get_legend_handles_labels()
        h2, l2 = ax2.get_legend_handles_labels()
        existing = ax.get_legend()
        if existing is not None:
            existing.remove()
        ax.legend(
            h1 + h2, l1 + l2,
            frameon=st.legend_box, fontsize=st.legend_font_size, loc=st.legend_location,
        )
    return artists + y2_artists
