"""Export side of the Stat Stage's CDF / ECDF plot (``Stage/statRenderCdf.ts``).

Draws exactly the vertices ``calc.statplots_cdf.cdf_geometry`` produces: a step
line per column, an optional DKW band (translucent polygon) and an optional
fitted-CDF curve (dashed), one palette colour per column, with a legend when
there is more than one column. Artists carry gids (``cdf-step-<k>``,
``cdf-band-<k>``, ``cdf-fit-<k>``) so tests and audits can find them.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from quantized.calc.figure_rug import draw_rug
from quantized.calc.statplots_cdf import cdf_geometry, cdf_series

__all__ = ["draw_cdf"]

_BAND_ALPHA = 0.18


def draw_cdf(
    ax: Any,
    data: Sequence[Any],
    labels: Sequence[str] | None,
    options: dict[str, Any] | None,
    fit: str | None,
    colors: Sequence[str | None] | None,
    rug: dict[str, Any] | None,
    line_width: float,
) -> None:
    opts = options or {}
    res = cdf_series(
        [list(map(float, c)) for c in data],
        y=str(opts.get("y", "proportion")), band=bool(opts.get("band", False)), fit=fit,
    )
    geo = cdf_geometry(res)
    many = len(geo["series"]) > 1
    for k, g in enumerate(geo["series"]):
        c = colors[k] if colors and k < len(colors) and colors[k] else f"C{k}"
        label = labels[k] if labels and k < len(labels) else f"column {k + 1}"
        if g["band"]:
            ax.fill(*zip(*g["band"], strict=True), color=c, alpha=_BAND_ALPHA, linewidth=0,
                    gid=f"cdf-band-{k}")
        ax.plot(*zip(*g["step"], strict=True), color=c, linewidth=line_width, label=label,
                gid=f"cdf-step-{k}")
        if g["fit"]:
            ax.plot(*zip(*g["fit"], strict=True), color=c, linewidth=line_width, linestyle="--",
                    gid=f"cdf-fit-{k}")
    ax.set_xlim(*geo["domain"])
    ax.set_ylim(0.0, geo["y_max"])
    if many:
        ax.legend()
    draw_rug(ax, data, colors, rug)
