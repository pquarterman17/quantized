"""Publication rendering of the censored life-data probability plot (GAP_AUDIT_9 G8).

Pure layer: the ``plot`` block that ``stats_life.fit_life`` / ``stats_life_interval.
fit_life_interval`` return (points, fitted line with its band, probability ticks,
all already in linearised ``z`` coordinates) in -> image bytes out, so the exported
figure is the on-screen plot, not a recomputation. Same style presets, fonts,
formats and render lock as ``figure_statplots`` (a sibling module because that
file is at its line budget). Axes: x = time (log for the ln-time families),
y = ``z`` labelled with failure-probability ticks. Solid = fitted line, dashed =
the confidence band the fit carried.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style

__all__ = ["render_life_probability_figure"]

_FORMATS = ("pdf", "svg", "eps", "png", "tiff")


def render_life_probability_figure(
    plot: dict[str, Any],
    *,
    title: str = "",
    x_label: str = "time",
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    svg_text_as_paths: bool = False,
) -> bytes:
    """Render a life-fit ``plot`` block (see module doc) to image bytes."""
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    try:
        pts, line, ticks = plot["points"], plot["line"], plot["ticks"]
        x_log = bool(plot["x_log"])
    except (KeyError, TypeError) as exc:
        raise ValueError(
            "plot needs points, line, ticks and x_log (a life-fit plot block)"
        ) from exc
    if not line or not pts:
        raise ValueError("plot needs at least one point and a fitted line")
    px = np.array([float(p["t"]) for p in pts])
    pz = np.array([float(p["z"]) for p in pts])
    lt = np.array([float(r["t"]) for r in line])
    arrs = {k: np.array([float(r[k]) for r in line]) for k in ("z", "z_low", "z_high")}
    if not (np.all(np.isfinite(px)) and np.all(np.isfinite(pz)) and np.all(np.isfinite(lt))):
        raise ValueError("plot values must be finite")
    st = figure_style(style)
    rc: dict[str, Any] = {
        **font_family_rc(st),
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
        "xtick.top": st.box_on,
        "ytick.right": st.box_on,
    }
    with render_scope(rc):
        fig = new_figure(figsize=(width_in or st.fig_width_in, height_in or st.fig_height_in))
        ax = fig.subplots()
        if x_log:
            ax.set_xscale("log")
        ax.plot(lt, arrs["z"], color="C0", lw=1.4, label="fit")
        for k in ("z_low", "z_high"):
            ax.plot(lt, arrs[k], color="C0", lw=0.9, ls="--")
        ax.scatter(px, pz, s=14, color="k", zorder=3, label="data")
        zlo, zhi = float(pz.min()) - 0.8, float(pz.max()) + 0.8
        ax.set_ylim(zlo, zhi)
        shown = [t for t in ticks if zlo < float(t["z"]) < zhi]
        ax.set_yticks([float(t["z"]) for t in shown])
        ax.set_yticklabels([f"{float(t['p']) * 100:g}%" for t in shown])
        ax.set_xlabel(safe_mathtext_label(x_label))
        ax.set_ylabel("failure probability")
        if title:
            ax.set_title(safe_mathtext_label(title))
        if not st.box_on:
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
        fig.tight_layout()
        dpi_used = int(dpi) if dpi is not None else int(st.dpi)
        return savefig_bytes(fig, fmt, dpi=dpi_used, svg_text_as_paths=svg_text_as_paths)
