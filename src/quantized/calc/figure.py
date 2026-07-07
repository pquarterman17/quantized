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


def _plot_kwargs(default_lw: float, spec: Mapping[str, Any] | None) -> dict[str, Any]:
    """Translate a per-series style spec (color/width/line/marker[/marker_size])
    into matplotlib ``plot`` kwargs, so the export matches the on-screen styling."""
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
        kw["markersize"] = spec.get("marker_size") or 5
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
    dpi: int = 200,
    overrides: Mapping[str, Any] | None = None,
) -> bytes:
    """Render ``series`` (each ``(label, y)``) against ``x`` to image bytes.

    ``fmt`` is ``pdf`` / ``svg`` (vector) or ``png`` / ``tiff`` (raster, sized by
    ``dpi``). ``style`` names a publication preset (``aps`` / ``report`` / ``web``
    / …) that sets font, line width, figure geometry, grid, and legend; pass
    ``width_in`` / ``height_in`` to override the preset's size. ``title`` /
    ``x_label`` / ``y_label`` are optional (empty = omit). ``series_styles``
    (aligned 1:1 with ``series``) carries per-series color/width/line/marker so
    the export matches the on-screen plot. A legend is drawn only for multiple
    series. ``overrides`` (gap #11 — every property UI-reachable) patches the
    preset per-figure: see :func:`_apply_overrides`; unknown keys are ignored,
    invalid values raise ``ValueError``. Raises ``ValueError`` on an unknown
    format or style.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    st = figure_style(style)
    ov = dict(overrides or {})
    _validate_overrides(ov)

    # rc_context scopes typography to this render; the named font is given a
    # generic fallback so matplotlib stays silent when Helvetica/Arial/Times
    # aren't installed on the host. (matplotlib's RcParams Literal-key type is
    # impractical with the dynamic font.<generic> key, hence the targeted ignore.)
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
    }
    tick_len = ov.get("ticks", {}).get("len")
    if tick_len is not None:
        rc["xtick.major.size"] = float(tick_len)
        rc["ytick.major.size"] = float(tick_len)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)

    xv: NDArray[np.float64] = np.asarray(x, dtype=float)
    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=figsize)
        try:
            for i, (label, y) in enumerate(series):
                spec = series_styles[i] if series_styles and i < len(series_styles) else None
                kw = _plot_kwargs(st.line_width, spec)
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
            if len(series) > 1 and "legend" not in ov:
                # All presets place the legend at "best" (matplotlib's default loc).
                ax.legend(frameon=st.legend_box, fontsize=st.legend_font_size)
            if st.grid_alpha > 0:
                ax.grid(True, alpha=st.grid_alpha)
            else:
                ax.grid(False)
            _apply_overrides(fig, ax, st, ov, n_series=len(series))
            if not ov.get("margins"):
                fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)

# ── Figure property overrides (gap #11) ─────────────────────────────────────
# The one config object behind the property panels: every export property the
# UI exposes lands here, patching the preset per-figure. Plain dict (calc stays
# pydantic-free); unknown keys are ignored so old clients keep working.

_LEGEND_LOCS = frozenset({
    "best", "upper right", "upper left", "lower left", "lower right",
    "right", "center left", "center right", "lower center", "upper center",
    "center", "outside right", "outside top",
})


def _validate_overrides(ov: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` on invalid override values (bad keys are ignored)."""
    legend = ov.get("legend")
    if legend is not None:
        loc = legend.get("loc")
        if loc is not None and loc not in _LEGEND_LOCS:
            raise ValueError(f"legend loc must be one of {sorted(_LEGEND_LOCS)}")
    ticks = ov.get("ticks")
    if ticks is not None:
        tdir = ticks.get("dir")
        if tdir is not None and tdir not in ("in", "out"):
            raise ValueError("ticks dir must be 'in' or 'out'")
    for key in ("x_lim", "y_lim"):
        lim = ov.get(key)
        if lim is not None and (not isinstance(lim, (list, tuple)) or len(lim) != 2):
            raise ValueError(f"{key} must be a [lo, hi] pair (null member = auto)")
    margins = ov.get("margins")
    if margins is not None:
        for side in ("left", "right", "top", "bottom"):
            v = margins.get(side)
            if v is not None and not 0.0 <= float(v) <= 1.0:
                raise ValueError("margins are figure fractions in [0, 1]")


def _apply_overrides(
    fig: Any, ax: Any, st: Any, ov: Mapping[str, Any], *, n_series: int
) -> None:
    """Apply the post-plot override properties (legend / ticks / spines /
    limits / margins / grid / annotations). rc-level properties (fonts, tick
    direction/length) are folded into the rc context by the caller."""
    legend = ov.get("legend")
    if legend is not None:
        show = legend.get("show")
        if (show is None and n_series > 1) or show:
            frame = bool(legend.get("frame", st.legend_box))
            loc = str(legend.get("loc", "best"))
            kw: dict[str, Any] = {"frameon": frame, "fontsize": st.legend_font_size}
            if loc == "outside right":
                kw.update(loc="center left", bbox_to_anchor=(1.02, 0.5))
            elif loc == "outside top":
                kw.update(loc="lower center", bbox_to_anchor=(0.5, 1.02), ncols=max(1, n_series))
            else:
                kw["loc"] = loc
            ax.legend(**kw)
        elif ax.get_legend() is not None:
            ax.get_legend().remove()

    ticks = ov.get("ticks")
    if ticks is not None and ticks.get("minor"):
        ax.minorticks_on()

    spines = ov.get("spines")
    if spines is not None:
        for side in ("top", "right", "left", "bottom"):
            if side in spines:
                ax.spines[side].set_visible(bool(spines[side]))

    for key, setter in (("x_lim", ax.set_xlim), ("y_lim", ax.set_ylim)):
        lim = ov.get(key)
        if lim is not None:
            lo, hi = lim
            setter(
                None if lo is None else float(lo),
                None if hi is None else float(hi),
            )

    if "grid" in ov:
        ax.grid(bool(ov["grid"]), alpha=st.grid_alpha or 0.3)

    for ann in ov.get("annotations", []):
        ax.annotate(
            str(ann.get("text", "")),
            xy=(float(ann.get("x", 0.0)), float(ann.get("y", 0.0))),
            fontsize=float(ov.get("font_size", st.font_size)),
        )

    margins = ov.get("margins")
    if margins is not None:
        fig.subplots_adjust(
            left=margins.get("left"),
            right=None if margins.get("right") is None else 1.0 - float(margins["right"]),
            top=None if margins.get("top") is None else 1.0 - float(margins["top"]),
            bottom=margins.get("bottom"),
        )
