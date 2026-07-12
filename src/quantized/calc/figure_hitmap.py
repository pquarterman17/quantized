"""Figure-hitmap element collection (gap #13): draw a figure and harvest one
pixel bounding box per interactive artist (title / axis labels / legend /
series lines / annotations) + the axes rect with data limits, so the client
can hit-test a preview render and map pixels back to data coordinates.

Split out of ``calc.figure`` purely to stay under the 500-line god-module
ceiling (mirrors ``figure_break``/``figure_scale``/``figure_overrides``);
``figure.render_figure_map`` (``_render_impl(..., collect_map=True)``) is the
only caller. Pure layer: a live ``Figure``/``Axes`` in -> a plain dict out.
"""

from __future__ import annotations

import base64
from collections.abc import Sequence
from io import BytesIO
from typing import Any

__all__ = ["collect_map"]


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
