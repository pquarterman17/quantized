"""Publication rendering for statistical plots: box / violin / Q-Q / histogram.

ORIGIN_GAP_PLAN #16 (export half). Pure layer: grouped/1-D data in -> image
bytes out. matplotlib's ``boxplot`` / ``violinplot`` compute the same stats as
``calc.statplots`` (linear-interp quartiles + Tukey whiskers; gaussian_kde
violins), and the Q-Q reference line + histogram binning come straight from
``calc.statplots``, so the exported figure and the interactive stage show
identical statistics. Shares ``render_figure``'s style presets and formats.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from numpy.typing import ArrayLike  # noqa: E402

from quantized.calc.figure_styles import figure_style  # noqa: E402
from quantized.calc.statplots import histogram as _histogram  # noqa: E402
from quantized.calc.statplots import qq_plot as _qq_plot  # noqa: E402

__all__ = ["STATPLOT_KINDS", "render_statplot_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")
STATPLOT_KINDS = ("box", "violin", "qq", "probability", "histogram")
_GROUPED = ("box", "violin")


def _clean_groups(groups: list[ArrayLike]) -> list[np.ndarray]:
    out = []
    for g in groups:
        v = np.asarray(g, dtype=float).ravel()
        v = v[np.isfinite(v)]
        if v.size == 0:
            raise ValueError("every group must have at least one finite value")
        out.append(v)
    return out


def render_statplot_figure(
    kind: str,
    data: list[ArrayLike] | ArrayLike,
    *,
    labels: list[str] | None = None,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    fmt: str = "pdf",
    style: str = "default",
    dist: str = "norm",
    bins: str | int = "fd",
    fit: str | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int = 200,
) -> bytes:
    """Render a statistical plot to image bytes.

    - ``box`` / ``violin`` — ``data`` is a list of groups; ``labels`` names them.
    - ``qq`` / ``probability`` — ``data`` is one sample vs ``dist`` quantiles
      with a least-squares reference line.
    - ``histogram`` — one sample with a numpy bin rule (``bins``) and an
      optional distribution-fit overlay (``fit``, e.g. ``"norm"``).
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if kind not in STATPLOT_KINDS:
        raise ValueError(f"kind must be one of {STATPLOT_KINDS}")
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
            _draw_statplot(ax, kind, data, labels, dist, bins, fit, st)
            if title:
                ax.set_title(title)
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
            if not st.box_on:
                ax.spines["top"].set_visible(False)
                ax.spines["right"].set_visible(False)
            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)


def _draw_statplot(
    ax: Any,
    kind: str,
    data: list[ArrayLike] | ArrayLike,
    labels: list[str] | None,
    dist: str,
    bins: str | int,
    fit: str | None,
    st: Any,
) -> None:
    if kind in _GROUPED:
        if not isinstance(data, list) or not data:
            raise ValueError(f"{kind} needs a non-empty list of groups")
        groups = _clean_groups(data)
        ticks = list(range(1, len(groups) + 1))
        if kind == "box":
            ax.boxplot(groups, tick_labels=labels, showmeans=True)
        else:
            parts = ax.violinplot(groups, positions=ticks, showmeans=True, showextrema=True)
            if labels:
                ax.set_xticks(ticks)
                ax.set_xticklabels(labels)
            del parts
        return

    sample = np.asarray(data, dtype=float).ravel()
    if kind in ("qq", "probability"):
        q = _qq_plot(sample, dist=dist)
        theo = np.asarray(q["theoretical_quantiles"])
        obs = np.asarray(q["sample_quantiles"])
        ax.scatter(theo, obs, s=12, color=st.accent if hasattr(st, "accent") else None)
        line = q["slope"] * theo + q["intercept"]
        ax.plot(theo, line, color="0.4", linewidth=st.line_width)
        ax.set_xlabel(ax.get_xlabel() or f"Theoretical quantiles ({dist})")
        ax.set_ylabel(ax.get_ylabel() or "Sample quantiles")
        return

    # histogram
    h = _histogram(sample, bins=bins, density=fit is not None, fit=fit)
    edges = np.asarray(h["edges"])
    ax.hist(sample, bins=edges, density=fit is not None,
            color="0.6", edgecolor="white", linewidth=0.5)
    if fit is not None and "fit" in h:
        ax.plot(h["fit"]["x"], h["fit"]["pdf"], color="0.1", linewidth=st.line_width)
