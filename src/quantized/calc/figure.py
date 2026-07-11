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

from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_overrides import _apply_overrides, _validate_overrides  # noqa: E402
from quantized.calc.figure_styles import FigureStyle, figure_style  # noqa: E402

__all__ = ["draw_series_axes", "render_figure", "style_rc"]

_FORMATS = ("pdf", "svg", "png", "tiff")
_LINESTYLE = {"solid": "-", "dashed": "--", "dotted": ":"}
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
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
) -> None:
    """Plot ``series`` into an EXISTING Axes: lines, scales, labels, spines,
    legend, grid, and the per-figure override sweep (:func:`_apply_overrides`).

    The single per-axes rendering body, shared by the single-figure renderer
    (``_render_impl``) and the multi-panel page composer
    (``figure_page.render_figure_page``) so a panel on a page looks exactly
    like its single-figure export. Callers own the figure lifecycle (rc
    context, layout, savefig, close) and must have sanitized every
    user-supplied string through ``safe_mathtext_label`` already.

    Per-series ``series_styles`` (MAIN #13, resolved against the raw
    ``DataStruct`` by ``calc.plotting.resolve_style_channels`` -- this
    function only ever sees resolved values): ``fill: "under"`` or
    ``{"vs": <display index>}`` draws a translucent fill derived from the
    series' own colour (:func:`_apply_fill`).
    """
    for i, (label, y) in enumerate(series):
        spec = series_styles[i] if series_styles and i < len(series_styles) else None
        yv = np.asarray(y, dtype=float)
        kw = _plot_kwargs(st.line_width, st.marker_size, spec)
        (line,) = ax.plot(xv, yv, label=label, **kw)
        _apply_fill(ax, xv, yv, series, i, spec, line.get_color())
    if x_log:
        ax.set_xscale("log")
    if y_log:
        ax.set_yscale("log")
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
        ax.grid(True, alpha=st.grid_alpha)
    else:
        ax.grid(False)
    _apply_overrides(fig, ax, st, ov, n_series=len(series))


def _render_impl(
    x: ArrayLike,
    series: Sequence[tuple[str, ArrayLike]],
    *,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    x_log: bool = False,
    y_log: bool = False,
    fmt: str = "pdf",
    style: str = "default",
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    overrides: Mapping[str, Any] | None = None,
    collect_map: bool = False,
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
    see :func:`_apply_fill`), expecting values already resolved by
    ``calc.plotting.resolve_style_channels`` (a raw channel index never
    reaches this function). A legend is drawn only for multiple series, at
    the preset's ``legend_location``. ``overrides`` (gap #11 — every property
    UI-reachable) patches the preset per-figure: see :func:`_apply_overrides`;
    unknown keys are ignored, invalid values raise ``ValueError``. Raises
    ``ValueError`` on an unknown format or style.
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
    series = [(safe_mathtext_label(label), y) for label, y in series]
    st = figure_style(style)
    ov = dict(overrides or {})
    _validate_overrides(ov)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)

    # rc_context scopes typography to this render (see style_rc). (matplotlib's
    # RcParams Literal-key type is impractical with the dynamic font.<generic>
    # key, hence the targeted ignore at the context below.)
    rc = style_rc(st, ov)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)

    xv: NDArray[np.float64] = np.asarray(x, dtype=float)
    x_breaks = ov.get("x_breaks")
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
                title=title,
                x_label=x_label,
                y_label=y_label,
                fmt=fmt,
                st=st,
                ov=ov,
                dpi=resolved_dpi,
                figsize=figsize,
                series_styles=series_styles,
            )
        fig, ax = plt.subplots(figsize=figsize)
        try:
            draw_series_axes(
                fig,
                ax,
                xv,
                series,
                st=st,
                ov=ov,
                x_log=x_log,
                y_log=y_log,
                title=title,
                x_label=x_label,
                y_label=y_label,
                series_styles=series_styles,
            )
            if not ov.get("margins"):
                fig.tight_layout()
            if collect_map:
                return _collect_map(fig, ax, n_series=len(series), dpi=resolved_dpi)
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


def _bbox_to_pixels(bbox: Any, height: float) -> dict[str, float]:
    """Window extent (origin bottom-left) -> image pixels (origin top-left)."""
    return {
        "x0": float(bbox.x0),
        "y0": float(height - bbox.y1),
        "x1": float(bbox.x1),
        "y1": float(height - bbox.y0),
    }


def _collect_map(fig: Any, ax: Any, *, n_series: int, dpi: int) -> dict[str, Any]:
    """Draw at ``dpi`` and harvest artist extents in image-pixel coords."""
    import base64

    fig.set_dpi(dpi)
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    width, height = fig.canvas.get_width_height()

    elements: list[dict[str, Any]] = []

    def add(el_id: str, artist: Any) -> None:
        try:
            bbox = artist.get_window_extent(renderer)
        except (RuntimeError, AttributeError):
            return
        if bbox.width <= 0 or bbox.height <= 0:
            return
        elements.append({"id": el_id, **_bbox_to_pixels(bbox, height)})

    if ax.get_title():
        add("title", ax.title)
    if ax.get_xlabel():
        add("xlabel", ax.xaxis.label)
    if ax.get_ylabel():
        add("ylabel", ax.yaxis.label)
    if ax.get_legend() is not None:
        add("legend", ax.get_legend())
    for i, line in enumerate(ax.lines[:n_series]):
        add(f"series:{i}", line)
    for i, txt in enumerate(ax.texts):
        add(f"ann:{i}", txt)

    axes_px = _bbox_to_pixels(ax.get_window_extent(renderer), height)
    buf = BytesIO()
    fig.savefig(buf, format="png")
    return {
        "image": base64.b64encode(buf.getvalue()).decode("ascii"),
        "width": int(width),
        "height": int(height),
        "elements": elements,
        "axes": {
            **axes_px,
            "xlim": [float(v) for v in ax.get_xlim()],
            "ylim": [float(v) for v in ax.get_ylim()],
            "xlog": ax.get_xscale() == "log",
            "ylog": ax.get_yscale() == "log",
        },
    }
