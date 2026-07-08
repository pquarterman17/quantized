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

from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = ["render_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")
_LINESTYLE = {"solid": "-", "dashed": "--", "dotted": ":"}


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


def render_figure(
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
) -> bytes:
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
    plot. A legend is drawn only for multiple series, at the preset's
    ``legend_location``. Raises ``ValueError`` on an unknown format or style.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    st = figure_style(style)
    resolved_dpi = dpi if dpi is not None else st.dpi

    # rc_context scopes typography to this render; the named font is given a
    # generic fallback so matplotlib stays silent when Helvetica/Arial/Times
    # aren't installed on the host. (matplotlib's RcParams Literal-key type is
    # impractical with the dynamic font.<generic> key, hence the targeted ignore.)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
        "xtick.labelsize": st.font_size,
        "ytick.labelsize": st.font_size,
        "xtick.direction": st.tick_dir,
        "ytick.direction": st.tick_dir,
        # Mirror ticks onto the top/right spines whenever the box is drawn
        # (the journal "closed box, inward ticks on all four sides" look) --
        # matplotlib's own default leaves top/right bare even with the full
        # rectangular border, which reads as an unfinished box.
        "xtick.top": st.box_on,
        "ytick.right": st.box_on,
    }
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)

    xv: NDArray[np.float64] = np.asarray(x, dtype=float)
    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=figsize)
        try:
            for i, (label, y) in enumerate(series):
                spec = series_styles[i] if series_styles and i < len(series_styles) else None
                kw = _plot_kwargs(st.line_width, st.marker_size, spec)
                ax.plot(xv, np.asarray(y, dtype=float), label=label, **kw)
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
            if len(series) > 1:
                # legend_location is a plain str (FigureStyle field), not matplotlib's
                # Literal[...] loc union -- mypy can't narrow it; every preset's value
                # is one of matplotlib's accepted location strings.
                ax.legend(  # type: ignore[call-overload]
                    frameon=st.legend_box,
                    fontsize=st.legend_font_size,
                    loc=st.legend_location,
                )
            if st.grid_alpha > 0:
                ax.grid(True, alpha=st.grid_alpha)
            else:
                ax.grid(False)
            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)
