"""Figure-hitmap element collection (gap #13): draw a figure and harvest one
pixel bounding box per interactive artist (title / axis labels / legend /
series lines / annotations) + the axes rect with data limits, so the client
can hit-test a preview render and map pixels back to data coordinates.

Split out of ``calc.figure`` purely to stay under the 500-line god-module
ceiling (mirrors ``figure_break``/``figure_scale``/``figure_overrides``);
``figure.render_figure_map`` (``_render_impl(..., collect_map=True)``) is the
only caller. Pure layer: a live ``Figure``/``Axes`` in -> a plain dict out.

``collect_facet_map`` (FU-facet-hitmap) is the facet-grid analogue of
``collect_map``: instead of one ``Axes``, it harvests EVERY panel of a
small-multiples grid -- each panel's axes pixel rect + data limits + facet
label, plus per-panel hit elements tagged with that panel's index -- so
``routes.export_figures.export_figure_hitmap``'s facet branch and the
client (``lib/previewmap.ts``) can resolve a preview click to the
CONTAINING panel before converting pixels to THAT panel's data coordinates.
It also harvests the whole FIGURE's own title/x-label/y-label (fix round 3,
J2) with the SAME ids ``collect_map`` uses and no ``panel`` key -- real
artists (``fig.suptitle``/``supxlabel``/``supylabel``) that a faceted
render draws exactly like the flat one, so leaving them unharvested would
make them visible but not editable on a faceted preview alone.
``calc.figure_facets.render_facets_figure_map`` is its only caller.

Former known limitation (R1, fix round 3; closed by FU-facet-hitmap): this
collector used to only ever run against a SINGLE ``Axes`` (the flat,
non-faceted figure) -- a faceted request never reached it at all, and
``export_figure_hitmap`` returned an EMPTY element list + a synthetic
whole-image ``axes`` rect. See ``collect_facet_map`` below for the facet
path; ``collect_map`` itself is UNCHANGED, still the flat-path-only
collector.
"""

from __future__ import annotations

import base64
import math
from collections.abc import Sequence
from io import BytesIO
from typing import Any

__all__ = ["collect_map", "collect_facet_map"]

#: Half-thickness, in image pixels, of a decor object's hit box along an axis
#: it is degenerate on. 3 px each side = a 6 px target, matching the tolerance
#: the interactive canvas already uses to pick a reference line
#: (``lib/uplotOverlays.ts``'s ``pickRefLine`` default ``tol = 6``), so the
#: preview and the live plot are equally forgiving to click.
_HIT_PAD = 3.0


def _pad_degenerate(box: dict[str, float]) -> dict[str, float]:
    """Grow any axis ``box`` is thinner than ``2 * _HIT_PAD`` on to exactly
    that width, centered on its own midpoint; a no-op on an axis already
    thicker than that. Shared by ``add_decor`` below (a reference line/shape,
    legitimately zero-width or zero-height) and ``collect_facet_map``'s
    facet series-line harvest (fix round 3, J4): a facet level with a
    single data ROW, or a constant-valued channel, draws a ``Line2D`` whose
    window extent is genuinely zero-width or zero-height on one axis -- the
    exact same degenerate-bbox situation, just for a series instead of a
    decor object. Returns a NEW dict; ``box`` itself is untouched."""
    out = dict(box)
    for lo, hi in (("x0", "x1"), ("y0", "y1")):
        if out[hi] - out[lo] < 2 * _HIT_PAD:
            mid = (out[lo] + out[hi]) / 2
            out[lo], out[hi] = mid - _HIT_PAD, mid + _HIT_PAD
    return out


def _bbox_to_pixels(bbox: Any, height: float) -> dict[str, float]:
    """Window extent (origin bottom-left) -> image pixels (origin top-left)."""
    return {
        "x0": float(bbox.x0),
        "y0": float(height - bbox.y1),
        "x1": float(bbox.x1),
        "y1": float(height - bbox.y0),
    }


def _artist_window_extent(artist: Any, renderer: Any) -> Any:
    """``artist.get_window_extent(renderer)``, with a workaround for
    matplotlib's ``Collection`` (what ``ax.scatter`` -- MAIN #14's colour-
    mapped scatter -- returns): ``Collection.get_window_extent`` calls
    ``get_datalim(IdentityTransform())`` instead of transforming to display
    space, which returns a degenerate all-``inf`` bbox for a plain scatter.
    Detected via ``get_offsets``/``get_offset_transform`` (present on any
    ``Collection`` with point offsets, scatter included) -- compute the real
    screen-space bbox from the transformed offsets instead. Falls through to
    the artist's own ``get_window_extent`` for everything else (``Line2D``,
    ``Text``, ``Legend``, ...)."""
    get_offsets = getattr(artist, "get_offsets", None)
    get_offset_transform = getattr(artist, "get_offset_transform", None)
    if get_offsets is not None and get_offset_transform is not None:
        pts = get_offset_transform().transform(get_offsets())
        if len(pts):
            from matplotlib.transforms import Bbox

            return Bbox([pts.min(axis=0), pts.max(axis=0)])
    return artist.get_window_extent(renderer)


def collect_map(
    fig: Any, ax: Any, *, series_artists: Sequence[Any], dpi: int, x_scale: str, y_scale: str
) -> dict[str, Any]:
    """Draw at ``dpi`` and harvest artist extents in image-pixel coords.
    ``series_artists`` is ``figure.draw_series_axes``'s return value (one
    artist per series, in order -- a ``Line2D`` normally, a
    ``PathCollection`` for a colour-mapped-scatter series) rather than
    re-derived from ``ax.lines``: a colour-mapped series draws via
    ``ax.scatter``, so it has NO entry in ``ax.lines`` at all -- indexing
    ``ax.lines[:n_series]`` would silently misalign every series hit-box
    after it. ``x_scale``/``y_scale`` are the ALREADY-RESOLVED scale names
    (MAIN #12) -- not re-derived from ``ax.get_xscale()``, which reports a
    reciprocal axis as ``"function"`` (matplotlib's generic custom-scale
    name), not ``"reciprocal"`` -- the client's ``lib/previewmap.ts`` needs
    the real name to invert a preview pixel drag back to data coordinates
    (``pxToData``). Fix round 4 (P3): a series line's box is harvested via
    ``add_series`` (below), not the plain ``add`` every other element uses
    -- a genuinely degenerate (zero-width or zero-height) box, e.g. a
    constant-valued channel or a single-point series, is padded to
    ``_HIT_PAD`` instead of being silently dropped. Applies
    ``collect_facet_map``'s J4 fix (round 3) to the flat path too, via the
    same shared ``_pad_degenerate`` helper -- a flat figure of a constant-
    valued channel used to have a ``title`` hitbox and no clickable series
    line at all.

    Fix round 5 (V1): ``add_series`` also CLIPS to the axes rect now, via
    the same ``_clip_box`` ``collect_facet_map``'s G1 fix (round 2) uses --
    a series line's ``get_window_extent`` is the transform of its FULL data
    extent, unclipped to the axes' current view; a zoomed ``x_lim``
    override (an ordinary Stage box-zoom) put most of a line's raw data far
    outside the narrowed view, so the reported box could balloon to
    several times the IMAGE width and paint over unrelated UI outside the
    preview entirely (the sticky Export/Apply row, in the Figure Builder --
    G1 was never actually facet-specific, just first NOTICED there because
    a faceted grid has sibling panels for an oversized box to visibly
    invade). Dropped entirely (not emitted) when the clip is empty, same as
    the facet path."""
    fig.set_dpi(dpi)
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    width, height = fig.canvas.get_width_height()
    # Computed HERE (fix round 5, V1), not after the harvest loop below --
    # `add_series` needs it to clip against. Numerically identical to
    # computing it after: the renderer/canvas state this reads from doesn't
    # change while harvesting other artists' (already-drawn) extents.
    axes_px = _bbox_to_pixels(ax.get_window_extent(renderer), height)

    elements: list[dict[str, Any]] = []

    def add(el_id: str, artist: Any) -> None:
        try:
            bbox = _artist_window_extent(artist, renderer)
        except (RuntimeError, AttributeError):
            return
        if bbox.width <= 0 or bbox.height <= 0:
            return
        elements.append({"id": el_id, **_bbox_to_pixels(bbox, height)})

    def add_series(el_id: str, artist: Any) -> None:
        """``add`` for a SERIES line specifically: a genuinely degenerate
        (zero-width or zero-height) box is padded to ``_HIT_PAD``, not
        dropped (fix round 4, P3) -- the exact gap ``collect_facet_map``'s
        J4 fix closed for facets (a constant-valued channel, or a single-
        point series, drew a real line the user could see but had NO
        series hit target at all -- only ``title``/``legend``/etc., if
        present). Then CLIPPED to the axes rect (fix round 5, V1), same as
        the facet path's own series clip -- see :func:`_clip_box`'s and
        this function's own module-level doc for why an unclipped box can
        balloon under a zoomed ``x_lim``; dropped entirely when the clip is
        empty. Only a genuinely INVALID (non-finite) extent is skipped
        before either step; padding/clipping a NaN/inf box would
        manufacture a meaningless hit target. Title/x-label/y-label/
        legend/annotations stay on plain ``add`` above -- they don't
        degenerate OR balloon the way a series line does (see
        ``add_decor``'s own doc for the ONE exception that already
        degenerates: reference lines/shapes, which are decor, not
        series)."""
        try:
            bbox = _artist_window_extent(artist, renderer)
        except (RuntimeError, AttributeError):
            return
        if not all(math.isfinite(v) for v in (bbox.x0, bbox.y0, bbox.x1, bbox.y1)):
            return
        padded = _pad_degenerate(_bbox_to_pixels(bbox, height))
        clipped = _clip_box(padded, axes_px)
        if clipped is None:
            return
        elements.append({"id": el_id, **clipped})

    def add_decor(el_id: str, artist: Any) -> None:
        """``add`` for a decor object, whose bbox is legitimately degenerate.

        A reference line drawn by ``axvline`` is exactly zero pixels WIDE (an
        ``axhline`` zero pixels TALL), and a flattened rect/line shape is the
        same -- so the emptiness guard in ``add`` above, which is correct for
        an absent title or an unlabelled axis, would silently drop every one
        of them. They are still perfectly visible in the render and the user
        will click them, so each thin axis is grown to ``_HIT_PAD`` on either
        side of the artist instead.
        """
        try:
            bbox = _artist_window_extent(artist, renderer)
        except (RuntimeError, AttributeError):
            return
        box = _pad_degenerate(_bbox_to_pixels(bbox, height))
        elements.append({"id": el_id, **box})

    if ax.get_title():
        add("title", ax.title)
    if ax.get_xlabel():
        add("xlabel", ax.xaxis.label)
    if ax.get_ylabel():
        add("ylabel", ax.yaxis.label)
    if ax.get_legend() is not None:
        add("legend", ax.get_legend())
    for i, artist in enumerate(series_artists):
        add_series(f"series:{i}", artist)
    for i, txt in enumerate(ax.texts):
        add(f"ann:{i}", txt)
    # Decor objects identify themselves by matplotlib ``gid`` rather than by
    # position: reference lines share ``ax.lines`` with the series (and a
    # colour-mapped series is not in ``ax.lines`` at all -- see the
    # ``series_artists`` note above), and shapes share ``ax.patches`` with
    # nothing today but need not stay alone there. ``gid`` is matplotlib's own
    # identity slot, set by ``figure_decor._apply_ref_lines`` and
    # ``figure_shapes._apply_shapes``; anything else keeps a ``None`` gid and
    # is skipped. Without these the client can render a reference line or a
    # shape into the preview and have no hit target to open its property
    # panel from.
    for artist in [*ax.lines, *ax.patches]:
        gid = artist.get_gid()
        if isinstance(gid, str) and gid.startswith(("refline:", "shape:")):
            add_decor(gid, artist)

    # `axes_px` was already computed above (fix round 5, V1) so `add_series`
    # could clip against it -- reused here verbatim, not recomputed.
    buf = BytesIO()
    fig.savefig(buf, format="png")
    return {
        "image": base64.b64encode(buf.getvalue()).decode("ascii"),
        "width": int(width),
        "height": int(height),
        "elements": elements,
        "axes": {
            **axes_px,
            "xlim": [float(v) for v in ax.get_xlim()],
            "ylim": [float(v) for v in ax.get_ylim()],
            "xlog": x_scale == "log",
            "ylog": y_scale == "log",
            "xscale": x_scale,
            "yscale": y_scale,
        },
    }


def _clip_box(box: dict[str, float], to: dict[str, float]) -> dict[str, float] | None:
    """``box`` intersected with ``to`` (both ``{"x0","y0","x1","y1"}`` image-
    pixel rects); ``None`` when the intersection is empty. Fix round 2
    (G1): a facet series line's ``get_window_extent`` is the transform of
    its FULL data extent, unclipped to the axes' current view limits -- a
    zoomed ``x_lim`` override (a box-zoom on Stage, or this route's own
    ``overrides``) can put most of a line's raw data far outside the
    narrowed view, so the reported pixel box balloons to several times the
    image width and spills across every sibling panel's own hit-region.
    Clipping the reported box to the panel's own bounds is the fix -- see
    ``collect_facet_map``'s call sites for which bounds each element kind
    clips against."""
    x0 = max(box["x0"], to["x0"])
    y0 = max(box["y0"], to["y0"])
    x1 = min(box["x1"], to["x1"])
    y1 = min(box["y1"], to["y1"])
    if x1 <= x0 or y1 <= y0:
        return None
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}


def collect_facet_map(
    fig: Any,
    panels: Sequence[tuple[Any, Sequence[Any]]],
    *,
    dpi: int,
    x_scale: str,
    y_scale: str,
    title_artist: Any | None = None,
    xlabel_artist: Any | None = None,
    ylabel_artist: Any | None = None,
) -> dict[str, Any]:
    """Draw at ``dpi`` and harvest EVERY panel's pixel geometry (FU-facet-
    hitmap). ``panels`` is ``(ax, series_artists)`` per panel, in panel
    order -- ``series_artists`` is ``figure_facets.draw_facet_grid``'s own
    return value (one artist per series, in that panel's order), exactly
    the ``series_artists``-not-``ax.lines`` reasoning ``collect_map`` above
    already documents (a colour-mapped series has no ``ax.lines`` entry --
    facets don't support ``color_by`` today, but this stays consistent with
    the flat collector rather than silently relying on that).
    ``title_artist``/``xlabel_artist``/``ylabel_artist`` (fix round 3, J2)
    are the whole-FIGURE'S OWN ``fig.suptitle``/``supxlabel``/``supylabel``
    ``Text`` instances (``calc.figure_facets_map._BuiltFacetGrid``'s own
    fields) -- ``None`` when that string was empty and nothing was drawn.

    Returns ``{"image", "width", "height", "elements", "panels"}`` --
    ``elements`` items carry an extra ``"panel"`` index (the ``panels``
    list position) alongside the flat shape's ``"id"``/pixel-box keys
    EXCEPT for the whole-figure title/x-label/y-label elements below, which
    carry NO ``"panel"`` key at all -- exactly the flat path's own shape,
    so the client's existing "``panel`` absent means the flat/whole-figure
    element" handling (``lib/previewmap.ts``) applies to them for free.
    ``"panels"`` replaces the flat response's single ``"axes"`` dict with
    ONE entry per panel: ``{"panel", "label", "x0", "y0", "x1", "y1",
    "xlim", "ylim", "xlog", "ylog", "xscale", "yscale"}`` -- same axes-rect
    shape ``collect_map`` uses, plus ``"panel"``/``"label"``. A panel's
    ``"label"`` is its rendered title text (``ax.get_title()``, already
    ``safe_mathtext_label``-sanitized by ``draw_facet_grid``) rather than
    re-deriving it from the request, so it can never drift from what the
    image actually shows.

    Fix round 2 (G1): EVERY per-panel element box is clipped so it can
    never extend past this panel into a sibling's -- a click that lands
    inside two panels' boxes at once is exactly the mistargeting this whole
    lane exists to prevent. A series line clips to this panel's own axes
    rect (``axes_px`` -- see :func:`_clip_box`'s own doc for why an
    unclipped box can balloon under a zoomed ``x_lim``); fix round 3 (J4)
    pads a genuinely degenerate (zero-width or zero-height) series box to
    ``_HIT_PAD`` FIRST, same as ``add_decor``'s own decor objects, so a
    facet level with a single data row or a constant-valued channel still
    gets a real hit target instead of silently having none while its
    siblings do -- dropped entirely only when the clip is empty (the
    panel's current view shows none of that line at all) or the extent is
    non-finite (no data / a transform failure). A per-panel title is
    DIFFERENT from a series line: it lives in the title margin ABOVE the
    axes rect by construction (a rendered text glyph's bbox, never a
    data-space transform, so it never overshoots the way a line does) --
    clipping it to ``axes_px`` the same way would clip away its entire
    vertical extent and wrongly drop every one. Its horizontal span is
    still clipped to ``axes_px``'s x-range (guards an unusually wide facet
    label from bleeding into a neighbouring COLUMN's title) while its own
    vertical span is left untouched.

    Deliberately narrower than ``collect_map``'s flat-path element set in
    two respects, for TWO DIFFERENT reasons -- fix round 4 (P1) drew the
    line precisely because the previous wording conflated them: a faceted
    render never draws an annotation/reference-line/shape INTO a panel at
    all (``figure_facets.render_facets_figure``'s own ``overrides`` doc),
    so those ids genuinely don't exist to harvest, the same as ANN/refline/
    shape always have. The per-panel LEGEND is different -- ``draw_facet_
    grid`` DOES draw a real ``ax.legend(...)`` whenever a panel has more
    than one series, so it IS harvested here (clipped to the panel's axes
    rect like a series line), just with no per-panel position/title
    override to commit a drag/edit into yet -- the client gates it INERT
    (``PreviewOverlay.tsx``'s ``hasSoundTarget``, same treatment as a
    per-panel title) rather than leaving it unharvested and undiscoverable.
    Whole-FIGURE title/labels went through the identical correction one
    round earlier (J2, fix round 3) -- an unharvested-but-real artist is a
    docs bug, not a scope decision, and gets fixed the same way every
    time it's found."""
    fig.set_dpi(dpi)
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    width, height = fig.canvas.get_width_height()

    elements: list[dict[str, Any]] = []
    panel_infos: list[dict[str, Any]] = []

    def _add_whole_figure(el_id: str, artist: Any | None) -> None:
        """Harvest a whole-FIGURE text artist (J2) with the SAME id the
        flat path uses and NO ``panel`` key. ``None`` (the string was
        empty, nothing drawn) is a silent no-op; a genuinely empty/zero-
        size rendered bbox is dropped, mirroring ``collect_map``'s own
        ``add()`` guard -- unlike J4's series-line fix, a real title/label
        string never renders degenerate in practice, so there is no
        padding case to handle here."""
        if artist is None:
            return
        try:
            bbox = _artist_window_extent(artist, renderer)
        except (RuntimeError, AttributeError):
            return
        if bbox.width <= 0 or bbox.height <= 0:
            return
        elements.append({"id": el_id, **_bbox_to_pixels(bbox, height)})

    _add_whole_figure("title", title_artist)
    _add_whole_figure("xlabel", xlabel_artist)
    _add_whole_figure("ylabel", ylabel_artist)

    for panel_index, (ax, series_artists) in enumerate(panels):
        axes_px = _bbox_to_pixels(ax.get_window_extent(renderer), height)

        if ax.get_title():
            try:
                bbox = _artist_window_extent(ax.title, renderer)
                if bbox.width > 0 and bbox.height > 0:
                    title_box = _bbox_to_pixels(bbox, height)
                    # Horizontal-only clip -- see the docstring above for why
                    # the vertical span is deliberately left alone.
                    clipped_x0 = max(title_box["x0"], axes_px["x0"])
                    clipped_x1 = min(title_box["x1"], axes_px["x1"])
                    if clipped_x1 > clipped_x0:
                        elements.append({
                            "id": "title", "panel": panel_index,
                            "x0": clipped_x0, "y0": title_box["y0"],
                            "x1": clipped_x1, "y1": title_box["y1"],
                        })
            except (RuntimeError, AttributeError):
                pass
        # Fix round 4 (P1): draw_facet_grid draws a REAL per-panel legend
        # (`ax.legend(...)`) whenever a panel has more than one series --
        # harvest it, clipped to this panel's own axes rect exactly like a
        # series line (a legend is placed WITHIN the axes by matplotlib's
        # own "best"-location layout, not the title's above-axes margin, so
        # the same full x+y clip applies, not the title's x-only one).
        # Inert by design (P1's own ruling): facets support no per-panel
        # legend position/title override at all (`render_facets_figure`'s
        # `overrides` doc), so there is nothing to commit a drag/edit INTO
        # yet -- the client gates it the same way it gates a per-panel
        # title (`PreviewOverlay.tsx`'s `hasSoundTarget`), not by leaving
        # it unharvested and pretending it isn't there.
        legend = ax.get_legend()
        if legend is not None:
            try:
                bbox = _artist_window_extent(legend, renderer)
                if bbox.width > 0 and bbox.height > 0:
                    clipped = _clip_box(_bbox_to_pixels(bbox, height), axes_px)
                    if clipped is not None:
                        elements.append({"id": "legend", "panel": panel_index, **clipped})
            except (RuntimeError, AttributeError):
                pass
        for i, artist in enumerate(series_artists):
            try:
                bbox = _artist_window_extent(artist, renderer)
            except (RuntimeError, AttributeError):
                continue
            # Fix round 3 (J4): a genuinely degenerate box (a facet level
            # with a single data ROW, or a constant-valued channel -- zero
            # WIDTH or zero HEIGHT, same situation `add_decor` above already
            # solves) is padded to `_HIT_PAD`, not dropped -- that sibling
            # panels' series stay clickable while this one silently has no
            # hit target at all is exactly the kind of per-panel gap this
            # lane exists to close. Only a genuinely INVALID extent (a
            # non-finite bbox -- no data at all, or a transform failure)
            # is skipped; `_pad_degenerate` on a non-finite box would just
            # manufacture a meaningless hit target.
            if not all(math.isfinite(v) for v in (bbox.x0, bbox.y0, bbox.x1, bbox.y1)):
                continue
            padded = _pad_degenerate(_bbox_to_pixels(bbox, height))
            clipped = _clip_box(padded, axes_px)
            if clipped is None:
                continue
            elements.append({"id": f"series:{i}", "panel": panel_index, **clipped})

        panel_infos.append({
            "panel": panel_index,
            "label": ax.get_title(),
            **axes_px,
            "xlim": [float(v) for v in ax.get_xlim()],
            "ylim": [float(v) for v in ax.get_ylim()],
            "xlog": x_scale == "log",
            "ylog": y_scale == "log",
            "xscale": x_scale,
            "yscale": y_scale,
        })

    buf = BytesIO()
    fig.savefig(buf, format="png")
    return {
        "image": base64.b64encode(buf.getvalue()).decode("ascii"),
        "width": int(width),
        "height": int(height),
        "elements": elements,
        "panels": panel_infos,
    }
