"""Publication rendering for a manually-broken x-axis (ORIGIN_GAP_PLAN #21).

Split out of ``calc.figure`` purely to stay under the 500-line god-module
ceiling (`_render_impl` calls ``render_breaks_impl`` when its ``overrides``
carry ``x_breaks``); the behavioural contract is still
``calc.figure``'s — see ``_validate_overrides``'s ``x_breaks`` checks and
``_render_impl``'s dispatch. Pure layer: data in -> image bytes out.

Renders one matplotlib panel per contiguous x-range between the (sorted,
validated) break pairs, sharing the y scale (``sharey``), with a diagonal
break glyph at each seam and the touching inner spines hidden — the paneled
representation the plan's RESOLVED decision calls for (never a
discontinuous-tick trick that lies about slope). Each panel plots the FULL
series and clips its own view via ``set_xlim``, so no data slicing is needed.

Scoped deliberately smaller than ``_render_impl``'s single-axes path: the
full ``_apply_overrides`` sweep (legend/spines/limits/margins) targets ONE
axes and a broken figure has several, so breaks combine with the plot itself
+ title/labels/basic legend/grid only — not the rest of gap #11's property
panel. Also not compatible with the figure-hitmap collector (`collect_map`),
which harvests pixel boxes off a single axes. Same scope limit for MAIN
#13/#14: a `series_styles` entry's `fill`/`color_by` keys are silently
ignored here (each panel draws a plain line) -- fill-under/-between and
colour-mapped scatter are single-axes features, like the rest of gap #11.
The axis-title Format + drag (``ov["axis_titles"]``, ``calc.figure_axis_titles``)
is skipped on purpose: the canvas' break panels build without that bridge and
draw plain titles (``tests/fixtures/wire/axis_titles.json``' break case).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.figure import _plot_kwargs
from quantized.calc.figure_render import in_render_scope, new_figure, savefig_bytes
from quantized.calc.figure_scale import apply_axis_scale, resolve_axis_scale
from quantized.calc.figure_ticks import apply_tick_formats, apply_tick_steps

__all__ = ["render_breaks_impl"]


def _visible_bounds(
    x: NDArray[np.float64], breaks: Sequence[tuple[float, float]]
) -> list[tuple[float, float]]:
    """Use the same non-empty, data-clamped panels as the interactive plot."""
    finite = x[np.isfinite(x)]
    if not finite.size:
        return [(0.0, 1.0)]
    xlo, xhi = float(finite.min()), float(finite.max())
    segments: list[tuple[float, float]] = []
    lo = float("-inf")
    for b0, b1 in breaks:
        segments.append((lo, b0))
        lo = b1
    segments.append((lo, float("inf")))
    bounds = [
        (max(lo, xlo), min(hi, xhi))
        for lo, hi in segments
        if np.any((finite >= lo) & (finite <= hi))
    ]
    # The interactive view declines a break if fewer than two panels survive.
    # A fully covered dataset must still export as an ordinary single panel.
    return bounds or [(xlo, xhi)]


def _in_view_ticks(ax: Any) -> list[float]:
    lo, hi = sorted(ax.get_xlim())
    return [float(t) for t in ax.get_xticks() if lo <= t <= hi]


def _fig_x(ax: Any, t: float) -> float:
    """Figure-fraction x of data value ``t`` on ``ax`` (any x scale)."""
    ax_frac = ax.transAxes.inverted().transform(ax.transData.transform((t, 0.0)))[0]
    pos = ax.get_position()
    return float(pos.x0 + pos.width * ax_frac)


def clear_seam_labels(fig: Any, axes: Sequence[Any]) -> None:
    """Drop an incoming panel's first x tick when its label would run into
    the outgoing panel's last one across a seam (plot audit round 2: "1.5" and
    "2.5" printed as "1.52.5"). Label widths are estimated at 0.6 em per
    character -- no renderer pass -- and the outgoing label is the one kept."""
    fig_w_pt = fig.get_figwidth() * 72.0
    for left, right in zip(axes, axes[1:], strict=False):
        lt, rt = _in_view_ticks(left), _in_view_ticks(right)
        if not lt or not rt:
            continue
        fmt_l = left.xaxis.get_major_formatter().format_ticks(lt)[-1]
        fmt_r = right.xaxis.get_major_formatter().format_ticks(rt)[0]
        size = float(right.xaxis.get_major_ticks()[0].label1.get_fontsize())
        gap = (_fig_x(right, rt[0]) - _fig_x(left, lt[-1])) * fig_w_pt
        if gap < (len(fmt_l) + len(fmt_r)) * 0.3 * size + 0.5 * size:
            lim = right.get_xlim()
            right.set_xticks(rt[1:])
            right.set_xlim(lim)


@in_render_scope  # normally nested in calc.figure's scope; direct calls stay safe
def render_breaks_impl(
    x: NDArray[np.float64],
    series: Sequence[tuple[str, ArrayLike]],
    *,
    breaks: list[tuple[float, float]],
    x_log: bool,
    y_log: bool,
    x_scale: str | None = None,
    y_scale: str | None = None,
    title: str,
    x_label: str,
    y_label: str,
    fmt: str,
    st: Any,
    ov: Mapping[str, Any],
    dpi: int,
    transparent: bool = False,
    figsize: tuple[float, float],
    series_styles: Sequence[Mapping[str, Any] | None] | None,
    x_fmt: Mapping[str, Any] | None = None,
    y_fmt: Mapping[str, Any] | None = None,
    x_step: float | None = None,
    y_step: float | None = None,
) -> bytes:
    """Render ``series`` against ``x`` with the x-axis elided over each
    ``[lo, hi]`` pair in ``breaks`` (already sorted/validated non-overlapping
    by ``calc.figure._validate_overrides``). ``x_fmt``/``y_fmt`` (MAIN #24)
    are applied to EVERY panel's axes (see ``figure_ticks.apply_tick_formats``);
    a shared y-axis (``sharey``) still draws tick labels only on panel 0
    (matplotlib's own ``sharey`` + this module's ``tick_params(left=False)``
    on the rest), so ``y_fmt`` only visibly affects that panel, but is
    applied uniformly for simplicity/consistency."""
    bounds = _visible_bounds(x, breaks)
    n = len(bounds)
    widths = [max(hi - lo, 1e-9) for lo, hi in bounds]

    fig = new_figure(figsize=figsize)
    axes_obj = fig.subplots(
        1, n, sharey=True, gridspec_kw={"width_ratios": widths, "wspace": 0.06}
    )
    axes = [axes_obj] if n == 1 else list(axes_obj)
    handles: list[Any] = []
    labels_out: list[str] = []
    for i, ax in enumerate(axes):
        for si, (label, y) in enumerate(series):
            spec = series_styles[si] if series_styles and si < len(series_styles) else None
            kw = _plot_kwargs(st.line_width, st.marker_size, spec)
            ax.plot(x, np.asarray(y, dtype=float), label=label, **kw)
        lo, hi = bounds[i]
        ax.set_xlim(lo, hi)
        resolved_x_scale = resolve_axis_scale(x_scale, x_log)
        resolved_y_scale = resolve_axis_scale(y_scale, y_log)
        apply_axis_scale(ax, "x", resolved_x_scale)
        apply_axis_scale(ax, "y", resolved_y_scale)
        apply_tick_steps(ax, x_step, y_step, resolved_x_scale, resolved_y_scale)
        apply_tick_formats(ax, x_fmt, y_fmt)
        if i == 0:
            handles, labels_out = ax.get_legend_handles_labels()
        if i > 0:
            ax.spines["left"].set_visible(False)
            ax.tick_params(left=False)
        if i < n - 1:
            ax.spines["right"].set_visible(False)
        if not st.box_on:
            ax.spines["top"].set_visible(False)
        if st.grid_alpha > 0:
            ax.grid(True, which="major", alpha=st.grid_alpha)
            ax.grid(True, which="minor", alpha=st.grid_alpha * 0.4)

    clear_seam_labels(fig, axes)

    # Diagonal break glyphs (matplotlib's standard broken-axis recipe):
    # short strokes angled across each seam, on both the outgoing panel's
    # right edge and the incoming panel's left edge.
    d = 0.4
    glyph_kw = {
        "marker": [(-1, -d), (1, d)],
        "markersize": 8,
        "linestyle": "none",
        "color": "k",
        "mec": "k",
        "mew": 1,
        "clip_on": False,
    }
    for i in range(n - 1):
        axes[i].plot([1], [0], transform=axes[i].transAxes, **glyph_kw)
        axes[i].plot([1], [1], transform=axes[i].transAxes, **glyph_kw)
        axes[i + 1].plot([0], [0], transform=axes[i + 1].transAxes, **glyph_kw)
        axes[i + 1].plot([0], [1], transform=axes[i + 1].transAxes, **glyph_kw)

    if title:
        fig.suptitle(title)
    if x_label:
        fig.supxlabel(x_label)
    if y_label:
        axes[0].set_ylabel(y_label)
    if len(series) > 1 and "legend" not in ov and handles:
        axes[-1].legend(
            handles, labels_out, frameon=st.legend_box, fontsize=st.legend_font_size,
            loc=st.legend_location,
        )
    return savefig_bytes(fig, fmt, dpi=dpi, transparent=transparent)
