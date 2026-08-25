"""Facet-grid figure building + per-panel hit-map rendering (FU-facet-hitmap).

Split out of ``calc.figure_facets`` purely to stay under the 500-line
god-module ceiling (mirrors ``figure_break``/``figure_scale``/
``figure_hitmap`` themselves being split out of ``calc.figure``) --
``_facet_grid`` is the SAME figure-building core ``figure_facets
.render_facets_figure`` uses (imported back into that module, lazily, to
avoid a top-level import cycle -- this module imports ``draw_facet_grid``
FROM ``figure_facets`` at its own top level), so a faceted preview's
geometry always describes the identical figure the plain bytes-only export
renders: there is no second, divergent render path.

``render_facets_figure_map`` is the facet-grid analogue of
``calc.figure.render_figure_map``, closing the gap
``routes.export_figures.export_figure_hitmap``'s facet branch used to carry
(``elements: []`` + a synthetic whole-image ``axes`` rect, an honest
click-through preview chosen over hit-boxes that would mis-target a drag at
the wrong panel's data coordinates) -- see that route and
``calc.figure_hitmap.collect_facet_map``'s own docs for the response shape
this produces. Pure layer: panel dicts in -> a plain dict out, same as
every other ``calc.figure_facets`` renderer.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless (defensive -- figure_facets already sets this)

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from quantized.calc.figure_facets import draw_facet_grid  # noqa: E402
from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_overrides import _validate_overrides  # noqa: E402
from quantized.calc.figure_scale import resolve_axis_scale  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = ["render_facets_figure_map"]


@dataclass(frozen=True)
class _BuiltFacetGrid:
    """``_facet_grid``'s yield: the live figure plus, per panel (in
    ``panels`` order, NOT padded to the grid), its Axes and drawn series
    artists -- everything a caller needs either to ``savefig`` directly
    (``figure_facets.render_facets_figure``) or to harvest pixel geometry
    before saving (``render_facets_figure_map`` below, via
    ``figure_hitmap.collect_facet_map``)."""

    fig: Any
    axes: list[Any]
    panel_artists: list[list[Any]]


@contextmanager
def _facet_grid(
    panels: list[dict[str, Any]],
    *,
    x_log: bool,
    y_log: bool,
    x_scale: str | None,
    y_scale: str | None,
    title: str,
    x_label: str,
    y_label: str,
    style: str,
    width_in: float | None,
    height_in: float | None,
    x_fmt: Mapping[str, Any] | None,
    y_fmt: Mapping[str, Any] | None,
    overrides: Mapping[str, Any] | None,
) -> Iterator[_BuiltFacetGrid]:
    """The figure-building core shared by ``figure_facets
    .render_facets_figure`` (savefig only) and ``render_facets_figure_map``
    below (savefig + pixel geometry) -- factored out verbatim from
    ``render_facets_figure`` (FU-facet-hitmap) so the two ALWAYS build the
    identical figure; nothing here changes what either public function
    renders. Yields once, with the rc-context/figure still open (matching
    ``figure_hitmap.collect_map``'s own pattern of drawing and harvesting
    BEFORE ``savefig``, inside the same ``matplotlib.rc_context`` -- text
    created by ``fig.suptitle``/``supxlabel``/``supylabel`` without an
    explicit ``fontsize`` resolves ``rcParams`` at DRAW time, so harvesting
    or saving after this context exits would silently drop the style's font
    size); closes the figure on the way out either way, panels-empty
    raising included.
    """
    if not panels:
        raise ValueError("panels must be non-empty")
    ov = dict(overrides or {})
    _validate_overrides(ov)
    # Rich-text labels (GOTO #5): de-math INVALID $...$ so savefig never raises.
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)

    st = figure_style(style)
    n = len(panels)
    cols = int(np.ceil(np.sqrt(n)))
    rows = int(np.ceil(n / cols))
    figsize = (
        width_in or st.fig_width_in * cols * 0.8,
        height_in or st.fig_height_in * rows * 0.8,
    )
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.font_size,
    }

    resolved_x_scale = resolve_axis_scale(x_scale, x_log)
    resolved_y_scale = resolve_axis_scale(y_scale, y_log)

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, axes_grid = plt.subplots(
            rows, cols, figsize=figsize, sharex=True, sharey=False, squeeze=False,
        )
        try:
            flat = [ax for row in axes_grid for ax in row]
            panel_artists = draw_facet_grid(
                flat, panels, st=st,
                resolved_x_scale=resolved_x_scale, resolved_y_scale=resolved_y_scale,
                x_fmt=x_fmt, y_fmt=y_fmt, overrides=ov,
            )

            if title:
                fig.suptitle(title)
            if x_label:
                fig.supxlabel(x_label)
            if y_label:
                fig.supylabel(y_label)
            fig.tight_layout()
            yield _BuiltFacetGrid(fig=fig, axes=flat[:n], panel_artists=panel_artists)
        finally:
            plt.close(fig)


def render_facets_figure_map(
    panels: list[dict[str, Any]],
    *,
    x_log: bool = False,
    y_log: bool = False,
    x_scale: str | None = None,
    y_scale: str | None = None,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int = 200,
    x_fmt: Mapping[str, Any] | None = None,
    y_fmt: Mapping[str, Any] | None = None,
    overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Render the facet grid AND its per-panel element hit-map
    (FU-facet-hitmap): base64 PNG + one axes entry per panel (pixel rect +
    data limits + facet label) + per-panel hit elements (facet title, each
    series line), tagged with their panel index -- the facet-grid analogue
    of :func:`quantized.calc.figure.render_figure_map`. Always an opaque PNG
    at ``dpi`` (no ``fmt``/``transparent`` -- the preview render is never
    anything else, mirroring ``render_figure_map``'s own contract); every
    other parameter mirrors :func:`quantized.calc.figure_facets
    .render_facets_figure`'s own doc.

    The client (``lib/previewmap.ts``) resolves a click/drag to the
    CONTAINING panel from its axes rect FIRST, then maps that panel's pixels
    to ITS OWN data coordinates -- panel 0's axes must never be used to
    interpret a click that landed in panel 3. Deliberately narrower than the
    flat path's element set: a faceted render never draws a legend/
    annotation/reference-line/shape INTO a panel today (see
    ``figure_facets.render_facets_figure``'s own ``overrides`` doc -- the
    interactive facet grid doesn't offer them either), so there is nothing
    to harvest for those ids yet; wiring per-panel drag-edit for them is
    future work, not silently faked here.
    """
    from quantized.calc.figure_hitmap import collect_facet_map

    with _facet_grid(
        panels, x_log=x_log, y_log=y_log, x_scale=x_scale, y_scale=y_scale,
        title=title, x_label=x_label, y_label=y_label, style=style,
        width_in=width_in, height_in=height_in, x_fmt=x_fmt, y_fmt=y_fmt,
        overrides=overrides,
    ) as built:
        resolved_x_scale = resolve_axis_scale(x_scale, x_log)
        resolved_y_scale = resolve_axis_scale(y_scale, y_log)
        return collect_facet_map(
            built.fig,
            list(zip(built.axes, built.panel_artists, strict=True)),
            dpi=dpi, x_scale=resolved_x_scale, y_scale=resolved_y_scale,
        )
