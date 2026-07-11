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
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from numpy.typing import ArrayLike, NDArray  # noqa: E402

from quantized.calc.figure import _plot_kwargs  # noqa: E402

__all__ = ["render_breaks_impl"]


def render_breaks_impl(
    x: NDArray[np.float64],
    series: Sequence[tuple[str, ArrayLike]],
    *,
    breaks: list[tuple[float, float]],
    x_log: bool,
    y_log: bool,
    title: str,
    x_label: str,
    y_label: str,
    fmt: str,
    st: Any,
    ov: Mapping[str, Any],
    dpi: int,
    figsize: tuple[float, float],
    series_styles: Sequence[Mapping[str, Any] | None] | None,
) -> bytes:
    """Render ``series`` against ``x`` with the x-axis elided over each
    ``[lo, hi]`` pair in ``breaks`` (already sorted/validated non-overlapping
    by ``calc.figure._validate_overrides``)."""
    finite = x[np.isfinite(x)]
    xlo = float(finite.min()) if finite.size else 0.0
    xhi = float(finite.max()) if finite.size else 1.0
    bounds: list[tuple[float, float]] = []
    lo = xlo
    for b0, b1 in breaks:
        bounds.append((lo, b0))
        lo = b1
    bounds.append((lo, xhi))
    n = len(bounds)
    widths = [max(hi - lo, 1e-9) for lo, hi in bounds]

    fig, axes_obj = plt.subplots(
        1, n, sharey=True, figsize=figsize, gridspec_kw={"width_ratios": widths, "wspace": 0.06}
    )
    axes = [axes_obj] if n == 1 else list(axes_obj)
    try:
        handles: list[Any] = []
        labels_out: list[str] = []
        for i, ax in enumerate(axes):
            for si, (label, y) in enumerate(series):
                spec = series_styles[si] if series_styles and si < len(series_styles) else None
                kw = _plot_kwargs(st.line_width, st.marker_size, spec)
                ax.plot(x, np.asarray(y, dtype=float), label=label, **kw)
            lo, hi = bounds[i]
            ax.set_xlim(lo, hi)
            if x_log:
                ax.set_xscale("log")
            if y_log:
                ax.set_yscale("log")
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
                ax.grid(True, alpha=st.grid_alpha)

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
        buf = BytesIO()
        fig.savefig(buf, format=fmt, dpi=dpi)
        return buf.getvalue()
    finally:
        plt.close(fig)
