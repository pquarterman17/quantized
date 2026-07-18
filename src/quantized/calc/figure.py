"""Publication figure rendering via matplotlib. Pure layer: data in -> bytes.

Renders a clean publication-style figure (white background, vector by default)
to PDF / SVG (vector) or PNG / TIFF (raster, at a chosen DPI). Server-side so the
browser gets a real vector file — the architecture's vector-by-default export
preference; raster formats are available for journals that demand them. TIFF
output goes through Pillow (a matplotlib dependency). matplotlib is imported here
only (the heavy import is lazy at the route boundary).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless: render to a buffer, never to a display

import matplotlib.pyplot as plt  # noqa: E402  (must follow matplotlib.use)
import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.figure_hitmap import collect_map as _collect_map_impl  # noqa: E402
from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_overrides import _apply_overrides, _validate_overrides  # noqa: E402
from quantized.calc.figure_scale import apply_axis_scale, resolve_axis_scale  # noqa: E402
from quantized.calc.figure_styles import FigureStyle, figure_style  # noqa: E402
from quantized.calc.figure_ticks import apply_tick_formats, apply_tick_steps  # noqa: E402

__all__ = ["draw_series_axes", "render_figure", "style_rc"]

_FORMATS = ("pdf", "svg", "png", "tiff")
_LINESTYLE = {"solid": "-", "dashed": "--", "dotted": ":", "none": "none"}
# Fixed fill translucency for MAIN #13 (fill under/between curves) — matches
# the screen side's `uplotFill.ts` FILL_ALPHA_PCT (25%) so an exported figure
# reads the same as its on-screen counterpart.
_FILL_ALPHA = 0.25


def _plot_kwargs(
    default_lw: float, default_marker_size: float, spec: Mapping[str, Any] | None
) -> dict[str, Any]:
    """Translate a per-series style spec (color/width/line/marker[/marker_size])
    into matplotlib ``plot`` kwargs, so the export matches the on-screen styling.
    ``default_marker_size`` is the active preset's calibrated marker size,
    used only when a marker is requested without an explicit per-series size."""
    kw: dict[str, Any] = {"linewidth": default_lw}
    if not spec:
        return kw
    color = spec.get("color")
    if color:
        kw["color"] = color
    width = spec.get("width")
    if width is not None:
        kw["linewidth"] = width
    line = spec.get("line")
    if line in _LINESTYLE:
        kw["linestyle"] = _LINESTYLE[line]
    if spec.get("marker"):
        kw["marker"] = "o"
        kw["markersize"] = spec.get("marker_size") or default_marker_size
    return kw


def _apply_fill(
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    series: Sequence[tuple[str, ArrayLike]],
    idx: int,
    spec: Mapping[str, Any] | None,
    color: Any,
) -> None:
    """Fill under (to a zero baseline) or between this series and another
    plotted one (MAIN #13), via matplotlib ``fill_between`` -- the export
    counterpart of the screen's native uPlot fill/band mechanism. ``color``
    is the series' OWN drawn line colour (whatever ``ax.plot`` resolved to,
    explicit or matplotlib's auto cycle) -- a fill is always derived from it,
    never a separately stored colour. ``spec["fill"]["vs"]`` is already
    resolved to a DISPLAY POSITION within ``series`` by
    ``calc.plotting.resolve_style_channels`` -- this function never sees a
    raw channel index."""
    if not spec:
        return
    fill = spec.get("fill")
    if fill == "under":
        ax.fill_between(xv, yv, 0.0, color=color, alpha=_FILL_ALPHA)
    elif isinstance(fill, Mapping):
        vs = fill.get("vs")
        if isinstance(vs, int) and 0 <= vs < len(series) and vs != idx:
            other = np.asarray(series[vs][1], dtype=float)
            n = min(len(xv), len(yv), len(other))
            if n > 0:
                ax.fill_between(xv[:n], yv[:n], other[:n], color=color, alpha=_FILL_ALPHA)


def _draw_color_scatter(
    fig: Any,
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    label: str,
    spec: Mapping[str, Any],
    st: FigureStyle,
) -> Any:
    """Colour-mapped scatter (MAIN #14): each point coloured by a THIRD
    channel's value -- ``spec["color_by"]``, already resolved by
    ``calc.plotting.resolve_style_channels`` to a concrete per-row array (this
    module never sees a raw channel index). Replaces the normal line draw
    entirely for this series -- screen-side parity: ``uplotOpts.ts`` hides the
    native line/points the same way whenever a series' ``colorBy`` is set.
    Adds a colourbar so the mapping is legible. Returns the ``PathCollection``
    artist (for the figure-hitmap element collector)."""
    z = np.asarray(spec["color_by"], dtype=float)
    n = min(len(xv), len(yv), len(z))
    size = float(spec.get("marker_size") or st.marker_size) ** 2
    sc = ax.scatter(
        xv[:n], yv[:n], c=z[:n], cmap=str(spec.get("colormap") or "viridis"), s=size, label=label
    )
    fig.colorbar(sc, ax=ax)
    return sc


def style_rc(st: FigureStyle, ov: Mapping[str, Any]) -> dict[str, Any]:
    """The rc-param dict a preset (+ optional font/tick overrides) resolves to.

    Scoped to one render via ``matplotlib.rc_context`` by the callers (the
    single-figure renderer below and the page composer in ``figure_page``).
    The named font is given a generic fallback so matplotlib stays silent when
    Helvetica/Arial/Times aren't installed on the host.
    """
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    font_size = float(ov.get("font_size", st.font_size))
    font_name = str(ov.get("font_name", st.font_name))
    tick_dir = str(ov.get("ticks", {}).get("dir", st.tick_dir))
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [font_name, fallback],
        "font.size": font_size,
        "axes.labelsize": font_size,
        "axes.titlesize": float(ov.get("title_size", st.title_font_size)),
        "xtick.labelsize": font_size,
        "ytick.labelsize": font_size,
        "xtick.direction": tick_dir,
        "ytick.direction": tick_dir,
        # Mirror ticks onto the top/right spines whenever the box is drawn
        # (the journal "closed box, inward ticks on all four sides" look) --
        # matplotlib's own default leaves top/right bare even with the full
        # rectangular border, which reads as an unfinished box.
        "xtick.top": st.box_on,
        "ytick.right": st.box_on,
    }
    tick_len = ov.get("ticks", {}).get("len")
    if tick_len is not None:
        rc["xtick.major.size"] = float(tick_len)
        rc["ytick.major.size"] = float(tick_len)
    return rc


def draw_series_axes(
    fig: Any,
    ax: Any,
    xv: NDArray[np.float64],
    series: Sequence[tuple[str, ArrayLike]],
    *,
    st: FigureStyle,
    ov: Mapping[str, Any],
    x_log: bool = False,
    y_log: bool = False,
    x_scale: str | None = None,
    y_scale: str | None = None,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
    x_fmt: Mapping[str, Any] | None = None,
    y_fmt: Mapping[str, Any] | None = None,
    x_step: float | None = None,
    y_step: float | None = None,
) -> list[Any]:
    """Plot ``series`` into an EXISTING Axes: lines, scales, labels, spines,
    legend, grid, and the per-figure override sweep (:func:`_apply_overrides`).
    Returns the per-series drawn artist (a ``Line2D`` normally, or a
    ``PathCollection`` for a colour-mapped-scatter series -- MAIN #14), in
    ``series`` order, for the figure-hitmap element collector
    (:func:`quantized.calc.figure_hitmap.collect_map`).

    The single per-axes rendering body, shared by the single-figure renderer
    (``_render_impl``) and the multi-panel page composer
    (``figure_page.render_figure_page``) so a panel on a page looks exactly
    like its single-figure export. Callers own the figure lifecycle (rc
    context, layout, savefig, close) and must have sanitized every
    user-supplied string through ``safe_mathtext_label`` already.

    ``x_scale``/``y_scale`` (MAIN #12: "linear"/"log"/"reciprocal") are the
    axis-scale source of truth when given; ``x_log``/``y_log`` are the
    back-compat fallback for a caller that only sets the boolean (see
    :func:`quantized.calc.figure_scale.resolve_axis_scale`).

    Per-series ``series_styles`` (MAIN #13/#14, resolved against the raw
    ``DataStruct`` by ``calc.plotting.resolve_style_channels`` -- this
    function only ever sees resolved values): ``fill: "under"`` or
    ``{"vs": <display index>}`` draws a translucent fill derived from the
    series' own colour (:func:`_apply_fill`); ``color_by: <array>`` replaces
    the normal line draw with a colour-mapped scatter + colourbar
    (:func:`_draw_color_scatter`) instead.

    ``x_fmt``/``y_fmt`` (MAIN #24: ``{"mode": "auto"|"fixed"|"sci"|"eng",
    "digits": n}``) are the tick-label number format, mirroring the screen's
    ``AxisFormat`` (see :func:`quantized.calc.figure_ticks.apply_tick_formats`);
    ``None``/``"auto"`` leaves matplotlib's own default formatter untouched.
    """
    artists: list[Any] = []
    for i, (label, y) in enumerate(series):
        spec = series_styles[i] if series_styles and i < len(series_styles) else None
        yv = np.asarray(y, dtype=float)
        if spec and spec.get("color_by") is not None:
            artists.append(_draw_color_scatter(fig, ax, xv, yv, label, spec, st))
            continue
        kw = _plot_kwargs(st.line_width, st.marker_size, spec)
        (line,) = ax.plot(xv, yv, label=label, **kw)
        _apply_fill(ax, xv, yv, series, i, spec, line.get_color())
        artists.append(line)
    resolved_x_scale = resolve_axis_scale(x_scale, x_log)
    resolved_y_scale = resolve_axis_scale(y_scale, y_log)
    apply_axis_scale(ax, "x", resolved_x_scale)
    apply_axis_scale(ax, "y", resolved_y_scale)
    apply_tick_steps(ax, x_step, y_step, resolved_x_scale, resolved_y_scale)
    apply_tick_formats(ax, x_fmt, y_fmt)
    if title:
        ax.set_title(title)
    if x_label:
        ax.set_xlabel(x_label)
    if y_label:
        ax.set_ylabel(y_label)
    if not st.box_on:
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
    if len(series) > 1 and "legend" not in ov:
        # legend_location is a plain str (FigureStyle field); every preset's
        # value is one of matplotlib's accepted location strings.
        ax.legend(
            frameon=st.legend_box,
            fontsize=st.legend_font_size,
            loc=st.legend_location,
        )
    if st.grid_alpha > 0:
        ax.grid(True, which="major", alpha=st.grid_alpha)
        ax.grid(True, which="minor", alpha=st.grid_alpha * 0.4)
    else:
        ax.grid(False, which="both")
    _apply_overrides(fig, ax, st, ov, n_series=len(series))
    return artists


def _render_impl(
    x: ArrayLike,
    series: Sequence[tuple[str, ArrayLike]],
    *,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    x_log: bool = False,
    y_log: bool = False,
    x_scale: str | None = None,
    y_scale: str | None = None,
    fmt: str = "pdf",
    style: str = "default",
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    overrides: Mapping[str, Any] | None = None,
    collect_map: bool = False,
    x_fmt: Mapping[str, Any] | None = None,
    y_fmt: Mapping[str, Any] | None = None,
    x_step: float | None = None,
    y_step: float | None = None,
    y2_mask: Sequence[bool] | None = None,
    y2_label: str = "",
    y2_scale: str | None = None,
    y2_fmt: Mapping[str, Any] | None = None,
    y2_step: float | None = None,
) -> bytes | dict[str, Any]:
    """Render ``series`` (each ``(label, y)``) against ``x`` to image bytes.

    ``fmt`` is ``pdf`` / ``svg`` (vector) or ``png`` / ``tiff`` (raster, sized by
    ``dpi``). ``style`` names a publication preset (``aps`` / ``report`` / ``web``
    / …) that sets font, line width, figure geometry, grid, and legend; pass
    ``width_in`` / ``height_in`` to override the preset's size. ``dpi`` defaults
    to the preset's own calibrated resolution (e.g. ``aps`` / ``nature`` -> 600,
    matching journal raster requirements) when not given explicitly; pass a
    value to override it. ``title`` / ``x_label`` / ``y_label`` are optional
    (empty = omit). ``series_styles`` (aligned 1:1 with ``series``) carries
    per-series color/width/line/marker so the export matches the on-screen
    plot, plus MAIN #13's ``fill`` (translucent fill under/between curves —
    see :func:`_apply_fill`) and MAIN #14's ``color_by`` (colour-mapped
    scatter + colourbar, replacing the line entirely for that series — see
    :func:`_draw_color_scatter`); both expect values already resolved by
    ``calc.plotting.resolve_style_channels`` (a raw channel index never
    reaches this function). A legend is drawn only for multiple series, at
    the preset's ``legend_location``. ``overrides`` (gap #11 — every property
    UI-reachable) patches the preset per-figure: see :func:`_apply_overrides`;
    unknown keys are ignored, invalid values raise ``ValueError``. Raises
    ``ValueError`` on an unknown format or style. ``x_scale``/``y_scale``
    (MAIN #12) select linear/log/reciprocal; ``x_log``/``y_log`` are the
    back-compat boolean fallback (see :func:`draw_series_axes`'s doc).
    ``x_fmt``/``y_fmt`` (MAIN #24) are the tick-label number format -- see
    :func:`draw_series_axes`'s doc. ``y2_mask`` (parallel to ``series``,
    ``True`` marks a channel drawn on a secondary/right Y axis) dispatches to
    :func:`quantized.calc.figure_y2.render_with_secondary_axis` -- a real
    ``Axes.twinx()`` -- instead of ``draw_series_axes``'s single axes;
    ``None``/all-``False`` (the default) is today's single-axis behaviour,
    byte-identical. ``y2_label``/``y2_scale``/``y2_fmt``/``y2_step`` mirror
    their primary-axis counterparts but apply only to the secondary axis;
    a fixed secondary range rides ``overrides["y2_lim"]`` (see
    ``figure_y2.render_with_secondary_axis``'s doc). Not compatible with
    ``x_breaks`` (raises ``ValueError``) -- a broken figure has several
    axes already and gains no coherent secondary-axis meaning.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    # Rich-text labels (GOTO #5): valid $...$ mathtext passes through to
    # matplotlib untouched; INVALID mathtext is de-mathed here so it renders
    # literally instead of raising inside savefig (an export must never 500).
    # Sanitizing at entry also covers the figure_break branch below, which
    # receives these same strings.
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)
    y2_label = safe_mathtext_label(y2_label)
    series = [(safe_mathtext_label(label), y) for label, y in series]
    st = figure_style(style)
    ov = dict(overrides or {})
    _validate_overrides(ov)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    y2_mask_list = list(y2_mask) if y2_mask is not None else [False] * len(series)
    if len(y2_mask_list) != len(series):
        raise ValueError("y2_mask must have the same length as series")
    has_y2 = any(y2_mask_list)

    # rc_context scopes typography to this render (see style_rc). (matplotlib's
    # RcParams Literal-key type is impractical with the dynamic font.<generic>
    # key, hence the targeted ignore at the context below.)
    rc = style_rc(st, ov)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)

    xv: NDArray[np.float64] = np.asarray(x, dtype=float)
    x_breaks = ov.get("x_breaks")
    if has_y2 and x_breaks:
        raise ValueError("y2_keys is not supported together with x_breaks")
    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        # Manual axis breaks (gap #21): a distinct, twinned-panel rendering
        # path — not compatible with the hit-map collector (collect_map is
        # figure-hitmap's single-axes pixel harvesting) or the full
        # `_apply_overrides` sweep (legend/spines/limits/margins apply to a
        # SINGLE axes; a broken figure has several). Breaks render the plot +
        # title/labels/basic legend/grid honestly; other overrides are simply
        # not applied together with x_breaks in this pass.
        if x_breaks and not collect_map:
            # Lazy import: split out purely to stay under the 500-line ceiling.
            from quantized.calc.figure_break import render_breaks_impl

            return render_breaks_impl(
                xv,
                series,
                breaks=[(float(b[0]), float(b[1])) for b in x_breaks],
                x_log=x_log,
                y_log=y_log,
                x_scale=x_scale,
                y_scale=y_scale,
                title=title,
                x_label=x_label,
                y_label=y_label,
                fmt=fmt,
                st=st,
                ov=ov,
                dpi=resolved_dpi,
                figsize=figsize,
                series_styles=series_styles,
                x_fmt=x_fmt,
                y_fmt=y_fmt,
                x_step=x_step,
                y_step=y_step,
            )
        fig, ax = plt.subplots(figsize=figsize)
        try:
            if has_y2:
                # Lazy import: mirrors figure_break's own lazy import above —
                # keeps this module's own top-level import list light, and
                # the twinx orchestration out of the 500-line ceiling here.
                from quantized.calc.figure_y2 import render_with_secondary_axis

                artists = render_with_secondary_axis(
                    fig, ax, xv, series, series_styles, y2_mask_list,
                    st=st, ov=ov, x_log=x_log, y_log=y_log,
                    x_scale=x_scale, y_scale=y_scale,
                    title=title, x_label=x_label, y_label=y_label,
                    x_fmt=x_fmt, y_fmt=y_fmt, x_step=x_step, y_step=y_step,
                    y2_label=y2_label, y2_scale=y2_scale,
                    y2_fmt=y2_fmt, y2_step=y2_step,
                )
            else:
                artists = draw_series_axes(
                    fig,
                    ax,
                    xv,
                    series,
                    st=st,
                    ov=ov,
                    x_log=x_log,
                    y_log=y_log,
                    x_scale=x_scale,
                    y_scale=y_scale,
                    title=title,
                    x_label=x_label,
                    y_label=y_label,
                    series_styles=series_styles,
                    x_fmt=x_fmt,
                    y_fmt=y_fmt,
                    x_step=x_step,
                    y_step=y_step,
                )
            if not ov.get("margins"):
                fig.tight_layout()
            if collect_map:
                return _collect_map_impl(
                    fig,
                    ax,
                    series_artists=artists,
                    dpi=resolved_dpi,
                    x_scale=resolve_axis_scale(x_scale, x_log),
                    y_scale=resolve_axis_scale(y_scale, y_log),
                )
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)


def render_figure(
    x: ArrayLike,
    series: Sequence[tuple[str, ArrayLike]],
    **kwargs: Any,
) -> bytes:
    """Render ``series`` against ``x`` to image bytes (see ``_render_impl``)."""
    out = _render_impl(x, series, **kwargs)
    assert isinstance(out, bytes)
    return out


def render_figure_map(
    x: ArrayLike,
    series: Sequence[tuple[str, ArrayLike]],
    **kwargs: Any,
) -> dict[str, Any]:
    """Render a PNG AND its element hit-map (gap #13): base64 image + one
    pixel bounding box per interactive artist (title / axis labels / legend /
    series lines / annotations) + the axes rect with data limits, so the
    client can hit-test the preview and map pixels back to data coords."""
    kwargs.pop("fmt", None)
    out = _render_impl(x, series, fmt="png", collect_map=True, **kwargs)
    assert isinstance(out, dict)
    return out
