"""Publication rendering for grouped/stacked bar (categorical) plots.

ORIGIN_GAP_PLAN #20 (export half). Pure layer: a category x series matrix in
-> image bytes out — the SAME matrix shape the interactive stat stage's "bar"
mode computes locally (frontend `lib/barlayout.buildBarMatrix`: mean per
category/series, SEM for the error bar), so the exported figure matches the
on-screen bars. Shares ``render_figure``'s style presets and formats
(``figure_styles.figure_style``), matching ``figure_statplots.py``'s template.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = ["render_categorical_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")


def _draw_categorical_bars(
    ax: Any,
    groups: list[str],
    series: list[str],
    vals: Any,
    errs: Any | None,
    stacked: bool,
) -> None:
    """Draw one grouped/stacked bar panel into `ax` — shared by the flat
    single-panel path below and `figure_facets.render_categorical_facets_figure`
    (GUI_INTERACTION #12 slice 4b), so a faceted panel matches the flat
    export exactly. Caller applies title/axis-labels/spines/legend/grid —
    this function only draws the bars + category ticks + zero baseline."""
    n_groups, n_series = len(groups), len(series)
    x = np.arange(n_groups, dtype=float)
    if stacked:
        bottom = np.zeros(n_groups)
        for si in range(n_series):
            yerr = errs[:, si] if errs is not None and si == n_series - 1 else None
            ax.bar(
                x, vals[:, si], 0.68, bottom=bottom, yerr=yerr, capsize=3,
                label=series[si],
            )
            bottom = bottom + np.nan_to_num(vals[:, si])
    else:
        width = 0.8 / n_series
        for si in range(n_series):
            offset = (si - (n_series - 1) / 2) * width
            yerr = errs[:, si] if errs is not None else None
            ax.bar(
                x + offset, vals[:, si], width * 0.85, yerr=yerr, capsize=3,
                label=series[si],
            )
    ax.set_xticks(x)
    ax.set_xticklabels(groups)
    ax.axhline(0, color="0.3", linewidth=0.8)  # baseline, visible for mixed-sign data


def _to_matrix(
    values: list[list[float]], n_groups: int, n_series: int, name: str
) -> np.ndarray:
    arr = np.asarray(values, dtype=float)
    if arr.shape != (n_groups, n_series):
        raise ValueError(f"{name} must have shape ({n_groups}, {n_series}), got {arr.shape}")
    return arr


def _to_error_matrix(
    errors: list[list[float | None]] | None, n_groups: int, n_series: int
) -> np.ndarray | None:
    if errors is None:
        return None
    if len(errors) != n_groups:
        raise ValueError(f"errors must have {n_groups} rows, got {len(errors)}")
    out = np.full((n_groups, n_series), np.nan)
    for gi, row in enumerate(errors):
        if len(row) != n_series:
            raise ValueError(f"errors row {gi} must have {n_series} entries, got {len(row)}")
        for si, e in enumerate(row):
            if e is not None:
                out[gi, si] = float(e)
    return out


def render_categorical_figure(
    groups: list[str],
    series: list[str],
    values: list[list[float]],
    errors: list[list[float | None]] | None = None,
    *,
    stacked: bool = False,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int = 200,
) -> bytes:
    """Render a grouped or stacked bar chart to image bytes.

    ``values[g][s]`` is the bar height (mean) for category ``groups[g]``,
    series ``series[s]``; ``errors[g][s]`` (optional, ``None`` entries allowed
    = no whisker for that bar) is its SEM. ``stacked=False`` clusters series
    side by side within each category; ``stacked=True`` draws one bar per
    category with series stacked bottom-to-top (only the topmost segment's
    error bar is drawn, matching the interactive stat stage's convention —
    a stacked bar's lower segments' own spread isn't visually meaningful once
    summed).
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if not groups:
        raise ValueError("groups must be non-empty")
    if not series:
        raise ValueError("series must be non-empty")
    # Rich-text labels (GOTO #5): de-math INVALID $...$ so savefig never raises.
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)
    groups = [safe_mathtext_label(str(g)) for g in groups]
    series = [safe_mathtext_label(str(s)) for s in series]
    n_groups, n_series = len(groups), len(series)
    vals = _to_matrix(values, n_groups, n_series, "values")
    errs = _to_error_matrix(errors, n_groups, n_series)

    st = figure_style(style)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
    }

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=figsize)
        try:
            _draw_categorical_bars(ax, groups, series, vals, errs, stacked)
            if title:
                ax.set_title(title)
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
            if not st.box_on:
                ax.spines["top"].set_visible(False)
                ax.spines["right"].set_visible(False)
            if n_series > 1:
                ax.legend(  # type: ignore[call-overload]
                    frameon=st.legend_box, fontsize=st.legend_font_size, loc=st.legend_location,
                )
            if st.grid_alpha > 0:
                ax.grid(True, alpha=st.grid_alpha, axis="y")
            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)
