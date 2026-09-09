"""The ``/figure`` facet (small-multiples) branch: request -> panel dicts ->
image bytes.

Split out of ``routes.export_figures`` when that module reached its 500-line
ceiling, and split HERE specifically because these two functions are the whole
facet branch and nothing else touches them: ``export_figure`` and
``export_figure_hitmap`` call ``render_facet_bytes``, ``routes.export_page``
calls ``facet_panels`` for its per-panel sub-grids. Keeping them together also
keeps the facet STYLE-ALIGNMENT rule (see ``render_facet_bytes``) next to the
reshape it constrains, instead of buried among the flat path's helpers.

Takes its collaborators as ARGUMENTS rather than importing them back from
``routes.export_figures`` -- that would be a circular import, and passing the
already-resolved labels in is also honest about the fact that this branch
derives nothing itself.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    from quantized.routes.export_figures import FigureRequest


def facet_panels(req: FigureRequest) -> list[dict[str, Any]]:
    """Reshape ``req.facets`` into ``calc.figure_facets``' panel-dict shape
    (``{"label": str, "x": [...], "series": [{"label": str, "y": [...]}]}``)
    -- the ONE reshape, shared by ``render_facet_bytes`` (the standalone
    ``/figure``/``/figure-hitmap`` facet branches) and ``routes.export_page``
    (a faceted page panel -- F4.4 follow-up, a real vector sub-grid instead
    of the earlier pre-rendered raster embed), so the two routes can never
    drift on how a facet-bound panel's wire payload turns into the
    renderer's input. Kept here (not calc/) because it moves ``req.facets``'
    pydantic model instances into plain dicts -- exactly the route-layer job
    the calc/routes split reserves for routes/."""
    assert req.facets
    return [
        {
            "label": f.label,
            "x": f.x,
            "series": [{"label": s.label, "y": s.y} for s in f.series],
        }
        for f in req.facets
    ]


def render_facet_bytes(
    req: FigureRequest,
    *,
    dpi: int,
    x_label: str,
    y_label: str,
    x_fmt: dict[str, Any] | None,
    y_fmt: dict[str, Any] | None,
    fmt: str | None = None,
) -> bytes:
    """Render ``req.facets`` to image bytes -- the standalone facet-branch
    renderer used by ``export_figure``/``export_figure_hitmap`` (R2, fix
    round 3). Axis labels and tick formats are RESOLVED BY THE CALLER and
    passed in (``routes.export_figures`` runs ``_figure_series``/``_tick_fmt``
    and hands the results over -- see this module's header for why), so the
    "explicit override, else derive from the dataset" rule still applies
    exactly once, upstream. Forwards scale/tick-
    format/transparent/overrides the SAME way the flat branch does
    (C1/C3/R3). ``fmt`` overrides ``req.fmt`` when given -- ``export_figure_
    hitmap`` forces ``fmt="png"`` (the preview render is always a raster
    PNG). (``title``/``style`` override params were dropped in fix round 3,
    W2 -- dead since ``routes.export_page`` stopped calling this function
    at all in fix round 1, and neither remaining caller ever passed them.)
    Styles come from ``req.facet_series_styles``, NOT ``req.series_styles``.
    The latter is indexed by ``req.y_keys`` == the frontend's hidden-filtered,
    ``seriesOrder``-reordered ``plotted`` list, while ``req.facets`` is built
    from the RAW, unfiltered/unreordered ``st.yKeys`` (``buildFacetSpecs`` ->
    ``facetPayloads`` -> ``buildColumns``, which does no filtering itself).
    One hidden or reordered channel makes the two diverge in length AND
    order, so forwarding the flat list would put a chosen dash on the WRONG
    curve -- worse than none. The frontend's all-hidden facet case
    (``figureSpec.test.ts``) pins the divergence: ``y_keys`` comes back ``[]``
    while ``facets`` still carries every series. ``facet_series_styles`` is
    built from the facet's own channel order instead, so it is aligned by
    construction; absent (older client, or nothing styled) degrades to the
    style preset's defaults."""
    from quantized.calc.figure_facets import render_facets_figure

    return render_facets_figure(
        facet_panels(req),
        x_log=req.x_log,
        y_log=req.y_log,
        x_scale=req.x_scale,
        y_scale=req.y_scale,
        title=req.title,
        x_label=x_label,
        y_label=y_label,
        fmt=fmt or req.fmt,
        style=req.style,
        width_in=req.width_in,
        height_in=req.height_in,
        dpi=dpi,
        transparent=req.transparent,
        x_fmt=x_fmt,
        y_fmt=y_fmt,
        overrides=req.overrides,
        series_styles=req.facet_series_styles,
    )
