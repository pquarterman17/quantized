"""Polar publication figure: angle -> theta, value -> radius (matplotlib
``projection="polar"``).

The export twin of the Stage's polar canvas (``frontend/src/components/Stage/
PolarStageCore.tsx`` + ``lib/polar.ts``). Before this existed, "Export figure"
and "Copy figure" from the polar view sent an ordinary XY request and the
renderer drew a Cartesian figure -- silently wrong output. The canvas'
geometry is carried EXPLICITLY on the wire (``routes.export_figures_polar``)
rather than assumed here, so the two sides cannot disagree about it:

* ``theta_unit`` -- the unit the angle column is in (the canvas: degrees);
* ``direction`` -- ``"ccw"`` (the canvas: angle increases counter-clockwise)
  or ``"cw"``;
* ``zero`` -- where 0 sits: ``"E"`` (the canvas), ``"N"``, ``"W"``, ``"S"``;
* ``r_lim`` -- the radial range, CENTRE first. The canvas maps the shared
  minimum of every plotted channel to the centre and the maximum to the rim
  (``[0, 1]`` for a degenerate range) and CLAMPS values outside it
  (``radiusNorm``); ``None`` derives that same range here. Values are clamped
  to it here too, so a value below the centre never wraps through the origin
  (matplotlib's own behaviour for ``r < rmin``);
* ``r_ticks`` -- the radial grid rings (the canvas' ``niceTicks``), labelled
  along the screen-up direction as the canvas labels them. matplotlib drops
  a ring AT the centre, so that one label is drawn as text, as the canvas
  draws it -- with signed data the centre is not 0;
* spokes every 45 degrees with degree labels, as the canvas draws them.

Pure layer: ndarray in, bytes out; no fastapi/pydantic.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, cast

import numpy as np
from matplotlib.projections.polar import PolarAxes
from numpy.typing import ArrayLike, NDArray

from quantized.calc.figure import _plot_kwargs, style_rc
from quantized.calc.figure_greyscale import apply_greyscale
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style

_FORMATS = ("pdf", "svg", "png", "tiff")
THETA_UNITS = ("deg", "rad")
DIRECTIONS = ("ccw", "cw")
# matplotlib's own theta-zero vocabulary; the angle each sits at on screen,
# measured counter-clockwise from east.
_ZERO_SCREEN_DEG = {"E": 0.0, "N": 90.0, "W": 180.0, "S": 270.0}
SPOKE_STEP_DEG = 45.0
# The canvas' ring-label format (PolarStageCore's `fmt`: 4 significant digits).
CENTRE_LABEL_FMT = "{:.4g}"
# The canvas' caption under the plot (PolarStageCore's `draw`).
DEFAULT_CAPTION = "angle (\N{DEGREE SIGN})  \N{MIDDLE DOT}  radius = value"


def radial_range(series: Sequence[ArrayLike]) -> tuple[float, float]:
    """The canvas' shared radial range: min/max of every finite value across
    all series, or ``(0, 1)`` when there is none or the range is degenerate
    (``PolarStageCore``'s ``vmin``/``vmax`` rule)."""
    lo, hi = np.inf, -np.inf
    for y in series:
        v = np.asarray(y, dtype=float)
        v = v[np.isfinite(v)]
        if v.size:
            lo, hi = min(lo, float(v.min())), max(hi, float(v.max()))
    if not np.isfinite(lo) or hi <= lo:
        return 0.0, 1.0
    return float(lo), float(hi)


def label_angle_deg(direction: str, zero: str) -> float:
    """The theta (degrees, in the axes' own frame) that points screen-UP, where
    the canvas writes its ring labels."""
    sign = 1.0 if direction == "ccw" else -1.0
    return ((90.0 - _ZERO_SCREEN_DEG[zero]) * sign) % 360.0


def _validate(fmt: str, theta_unit: str, direction: str, zero: str) -> None:
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if theta_unit not in THETA_UNITS:
        raise ValueError(f"theta_unit must be one of {THETA_UNITS}")
    if direction not in DIRECTIONS:
        raise ValueError(f"direction must be one of {DIRECTIONS}")
    if zero not in _ZERO_SCREEN_DEG:
        raise ValueError(f"zero must be one of {tuple(_ZERO_SCREEN_DEG)}")


def render_polar_figure(
    theta: ArrayLike,
    series: Sequence[tuple[str, ArrayLike]],
    *,
    theta_unit: str = "deg",
    direction: str = "ccw",
    zero: str = "E",
    r_lim: tuple[float, float] | None = None,
    r_ticks: Sequence[float] | None = None,
    grid: bool = True,
    title: str = "",
    caption: str | None = None,
    r_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    transparent: bool = False,
    greyscale: bool = False,
    svg_text_as_paths: bool = False,
) -> bytes:
    """Render ``series`` (each ``(label, r)``) against the angle ``theta`` on
    polar axes and return the image bytes. See the module doc for the
    geometry fields. ``caption`` ``None`` = the canvas' own caption; ``""``
    omits it. ``r_label`` (the radial axis title) is omitted when empty.
    ``series_styles`` uses the single-figure vocabulary (``calc.figure.
    _plot_kwargs``); ``greyscale`` is the same print-safe ramp. Raises
    ``ValueError`` on an unknown format/unit/direction/zero or style, or an
    ``r_lim`` whose centre is not below its rim."""
    _validate(fmt, theta_unit, direction, zero)
    lo, hi = r_lim if r_lim is not None else radial_range([y for _, y in series])
    if not (np.isfinite(lo) and np.isfinite(hi) and hi > lo):
        raise ValueError("r_lim must be two finite numbers, centre below rim")
    if greyscale:
        series_styles = apply_greyscale(series_styles, len(series))
    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    th: NDArray[np.float64] = np.asarray(theta, dtype=float)
    if theta_unit == "deg":
        th = np.asarray(np.deg2rad(th), dtype=float)
    with render_scope(style_rc(st, {})):
        fig = new_figure(figsize=figsize)
        ax = cast(PolarAxes, fig.subplots(subplot_kw={"projection": "polar"}))
        ax.set_theta_zero_location(cast(Any, zero))  # validated against _ZERO_SCREEN_DEG
        ax.set_theta_direction(1 if direction == "ccw" else -1)
        for i, (label, y) in enumerate(series):
            spec = series_styles[i] if series_styles and i < len(series_styles) else None
            # Clamped like the canvas' radiusNorm; NaN stays NaN (a line break).
            r = np.clip(np.asarray(y, dtype=float), lo, hi)
            kw = _plot_kwargs(st.line_width, st.marker_size, spec)
            ax.plot(th, r, label=safe_mathtext_label(label), **kw)
        ax.set_rlim(lo, hi)
        up = label_angle_deg(direction, zero)
        if r_ticks is not None:
            rings = [float(t) for t in r_ticks if lo <= float(t) <= hi]
            ax.set_rticks(rings)
            # matplotlib never labels the ring AT the centre; the canvas does,
            # and with signed data the centre is not 0, so the label matters.
            if any(np.isclose(t, lo, rtol=0.0, atol=1e-12 * max(1.0, abs(lo))) for t in rings):
                ax.text(np.radians(up), lo, CENTRE_LABEL_FMT.format(lo), ha="center", va="center")
        ax.set_rlabel_position(up)
        spokes = np.arange(0.0, 360.0, SPOKE_STEP_DEG)
        ax.set_thetagrids(spokes, [f"{d:g}\N{DEGREE SIGN}" for d in spokes])
        ax.grid(grid)
        if title:
            ax.set_title(safe_mathtext_label(title))
        text = DEFAULT_CAPTION if caption is None else caption
        if text:
            ax.set_xlabel(safe_mathtext_label(text))
        if r_label:
            ax.set_ylabel(safe_mathtext_label(r_label))
        if len(series) > 1:
            ax.legend(frameon=st.legend_box, fontsize=st.legend_font_size, loc="upper left",
                      bbox_to_anchor=(1.05, 1.0))
        fig.tight_layout()
        return savefig_bytes(
            fig, fmt, dpi=resolved_dpi, transparent=transparent, svg_text_as_paths=svg_text_as_paths
        )
