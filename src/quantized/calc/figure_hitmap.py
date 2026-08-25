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
    (``pxToData``)."""
    fig.set_dpi(dpi)
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    width, height = fig.canvas.get_width_height()

    elements: list[dict[str, Any]] = []

    def add(el_id: str, artist: Any) -> None:
        try:
            bbox = _artist_window_extent(artist, renderer)
        except (RuntimeError, AttributeError):
            return
        if bbox.width <= 0 or bbox.height <= 0:
            return
        elements.append({"id": el_id, **_bbox_to_pixels(bbox, height)})

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
        box = _bbox_to_pixels(bbox, height)
        for lo, hi in (("x0", "x1"), ("y0", "y1")):
            if box[hi] - box[lo] < 2 * _HIT_PAD:
                mid = (box[lo] + box[hi]) / 2
                box[lo], box[hi] = mid - _HIT_PAD, mid + _HIT_PAD
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
        add(f"series:{i}", artist)
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

    axes_px = _bbox_to_pixels(ax.get_window_extent(renderer), height)
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


def collect_facet_map(
    fig: Any,
    panels: Sequence[tuple[Any, Sequence[Any]]],
    *,
    dpi: int,
    x_scale: str,
    y_scale: str,
) -> dict[str, Any]:
    """Draw at ``dpi`` and harvest EVERY panel's pixel geometry (FU-facet-
    hitmap). ``panels`` is ``(ax, series_artists)`` per panel, in panel
    order -- ``series_artists`` is ``figure_facets.draw_facet_grid``'s own
    return value (one artist per series, in that panel's order), exactly
    the ``series_artists``-not-``ax.lines`` reasoning ``collect_map`` above
    already documents (a colour-mapped series has no ``ax.lines`` entry --
    facets don't support ``color_by`` today, but this stays consistent with
    the flat collector rather than silently relying on that).

    Returns ``{"image", "width", "height", "elements", "panels"}`` --
    ``elements`` items carry an extra ``"panel"`` index (the ``panels``
    list position) alongside the flat shape's ``"id"``/pixel-box keys, and
    ``"panels"`` replaces the flat response's single ``"axes"`` dict with
    ONE entry per panel: ``{"panel", "label", "x0", "y0", "x1", "y1",
    "xlim", "ylim", "xlog", "ylog", "xscale", "yscale"}`` -- same axes-rect
    shape ``collect_map`` uses, plus ``"panel"``/``"label"``. A panel's
    ``"label"`` is its rendered title text (``ax.get_title()``, already
    ``safe_mathtext_label``-sanitized by ``draw_facet_grid``) rather than
    re-deriving it from the request, so it can never drift from what the
    image actually shows.

    Deliberately narrower than ``collect_map``'s flat-path element set: a
    faceted render never draws a legend/annotation/reference-line/shape
    INTO a panel today (``figure_facets.render_facets_figure``'s own
    ``overrides`` doc), so only each panel's title and series lines are
    real, hit-testable artists -- there is nothing to harvest for the other
    ids yet."""
    fig.set_dpi(dpi)
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    width, height = fig.canvas.get_width_height()

    elements: list[dict[str, Any]] = []
    panel_infos: list[dict[str, Any]] = []

    for panel_index, (ax, series_artists) in enumerate(panels):
        if ax.get_title():
            try:
                bbox = _artist_window_extent(ax.title, renderer)
                if bbox.width > 0 and bbox.height > 0:
                    elements.append(
                        {"id": "title", "panel": panel_index, **_bbox_to_pixels(bbox, height)}
                    )
            except (RuntimeError, AttributeError):
                pass
        for i, artist in enumerate(series_artists):
            try:
                bbox = _artist_window_extent(artist, renderer)
            except (RuntimeError, AttributeError):
                continue
            if bbox.width <= 0 or bbox.height <= 0:
                continue
            elements.append(
                {"id": f"series:{i}", "panel": panel_index, **_bbox_to_pixels(bbox, height)}
            )

        axes_px = _bbox_to_pixels(ax.get_window_extent(renderer), height)
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
