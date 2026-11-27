"""Draw the scatter overlays (``calc.figure_overlays``) into an export Axes.

Called by ``calc.figure.draw_series_axes`` with the request's ``overrides``;
``ov["overlays"]`` is the same spec the live plot posts to ``/api/plot/overlays``
and the same computation answers it, so the exported curves and legend words
match the screen. Overlays are drawn in the series' own colour in data space, so
they refuse (raise ``ValueError``, a 422) on a log or reciprocal axis (a straight
line there would mislead) and with exchanged axes. A refused overlay is named in
a "not drawn" legend line instead of being drawn. Rows excluded from a fit arrive
blank in the series, so they never enter it. Pure layer: no fastapi/pydantic.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from numpy.typing import ArrayLike

from quantized.calc.figure_excluded import EXCLUDED_SUFFIX
from quantized.calc.figure_orient import horizontal_bars
from quantized.calc.figure_overlays import (
    overlay_specs_label,
    series_overlays,
    validate_overlay_spec,
)
from quantized.heavy_import import heavy_imports

__all__ = ["apply_overlays", "validate_overlays_override"]


def validate_overlays_override(
    ov: Mapping[str, Any],
    x_scale: str,
    y_scale: str,
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
) -> dict[str, dict[str, Any]]:
    spec = validate_overlay_spec(ov.get("overlays"))
    if spec and (x_scale != "linear" or y_scale != "linear"):
        raise ValueError(
            "overlays are fitted in data space and need linear axes (not log or reciprocal)"
        )
    if spec and ov.get("exchange_xy"):
        raise ValueError("overlays are not supported together with exchange_xy")
    # Horizontal bars turn the whole layer (calc.figure_orient): the screen refuses the
    # overlays there too (lib/plotOverlays.ts overlayViewRefusal).
    if spec and horizontal_bars(series_styles):
        raise ValueError("overlays are not supported on a graph with horizontal bars")
    return spec


def _color(artist: Any, i: int) -> str:
    getter = getattr(artist, "get_color", None)
    c = getter() if callable(getter) else None
    if isinstance(c, str):
        return c
    return f"C{i % 10}"


def apply_overlays(
    ax: Any,
    xv: ArrayLike,
    series: Sequence[tuple[str, ArrayLike]],
    series_styles: Sequence[Mapping[str, Any] | None] | None,
    ov: Mapping[str, Any],
    artists: Sequence[Any],
    x_scale: str,
    y_scale: str,
) -> None:
    spec = validate_overlays_override(ov, x_scale, y_scale, series_styles)
    if not spec:
        return
    with heavy_imports(
        "matplotlib.colors", "matplotlib.legend", "matplotlib.lines", "matplotlib.patches"
    ):
        from matplotlib.colors import to_rgba
        from matplotlib.legend import Legend
        from matplotlib.lines import Line2D
        from matplotlib.patches import Patch

    # The limits are final here (drop lines and the inset were drawn against them)
    # and the screen keeps its data range: an ellipse or band reaching past the data
    # must not widen the exported view.
    xlim, ylim = ax.get_xlim(), ax.get_ylim()

    picks = []
    for i, (label, y) in enumerate(series):
        style = series_styles[i] if series_styles and i < len(series_styles) else None
        if label.endswith(EXCLUDED_SUFFIX) or (style and (style.get("bars") or style.get("stack"))):
            continue
        picks.append((i, label, y))
    results = series_overlays([(lb, y) for _, lb, y in picks], xv, spec)
    several = len(picks) > 1
    handles: list[Any] = []
    labels: list[str] = []
    for (i, _, _), res in zip(picks, results, strict=True):
        color = _color(artists[i] if i < len(artists) else None, i)
        name = res["label"]
        if (line := res.get("line")) is not None:
            band = line["band"]
            if band is not None:
                ax.fill_between(
                    line["x"], band["lo"], band["hi"], color=color, alpha=0.15, linewidth=0
                )
                handles.append(Patch(facecolor=color, alpha=0.15))
                labels.append(overlay_specs_label(name, band["label"], several))
            ax.plot(line["x"], line["y"], color=color, linewidth=1.5, linestyle="-")
            handles.append(Line2D([], [], color=color, linewidth=1.5, linestyle="-"))
            labels.append(overlay_specs_label(name, line["label"], several))
        if (sm := res.get("smoother")) is not None:
            ax.plot(sm["x"], sm["y"], color=color, linewidth=1.5, linestyle="--")
            handles.append(Line2D([], [], color=color, linewidth=1.5, linestyle="--"))
            labels.append(overlay_specs_label(name, sm["label"], several))
        if (hull := res.get("hull")) is not None:
            if hull["degenerate"]:
                ax.plot(hull["x"], hull["y"], color=color, linewidth=1.5, linestyle="-")
            else:
                ax.fill(
                    hull["x"],
                    hull["y"],
                    facecolor=to_rgba(color, 0.06),
                    edgecolor=color,
                    linewidth=1.5,
                    linestyle="-",
                )
            handles.append(Line2D([], [], color=color, linewidth=1.5, linestyle="-"))
            labels.append(overlay_specs_label(name, hull["label"], several))
        if (el := res.get("ellipse")) is not None:
            mean = el["kind"] == "mean"
            ls: Any = (0, (6, 3)) if mean else ":"
            ax.fill(
                el["x"],
                el["y"],
                facecolor=to_rgba(color, 0.12 if mean else 0.08),  # a faint fill, a solid edge
                edgecolor=color,
                linewidth=1.5 if mean else 1.0,
                linestyle=ls,
            )
            handles.append(Patch(facecolor=color, alpha=0.2, edgecolor=color, linestyle=ls))
            labels.append(overlay_specs_label(name, el["label"], several))
        if (cen := res.get("centroid")) is not None:
            ax.plot(
                cen["x"],
                cen["y"],
                linestyle="none",
                marker="P",
                markersize=9,
                markerfacecolor=color,
                markeredgecolor="black",
                markeredgewidth=0.8,
                zorder=5,
            )
            handles.append(
                Line2D(
                    [],
                    [],
                    linestyle="none",
                    marker="P",
                    markersize=8,
                    markerfacecolor=color,
                    markeredgecolor="black",
                    markeredgewidth=0.8,
                )
            )
            labels.append(overlay_specs_label(name, cen["label"], several))
        for kind, why in res["refused"].items():
            handles.append(Line2D([], [], linestyle="none"))
            labels.append(overlay_specs_label(name, f"{kind} not drawn: {why}", several))
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
    if handles:
        legend = Legend(
            ax,
            handles,
            labels,
            loc="best" if len(labels) > 4 else "lower right",
            fontsize="x-small",
            frameon=False,
        )
        ax.add_artist(legend)
