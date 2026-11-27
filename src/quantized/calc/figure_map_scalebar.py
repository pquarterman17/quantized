"""The 2-D map's scale bar in the vector export: a bar in the map's X data
units in one corner of the axes, labelled under it.

The canvas draws the same bar (``Stage/mapScaleBarDraw.ts``); length, label and
placement come from :mod:`quantized.calc.map_scalebar`, pinned against the
screen by ``tests/fixtures/wire/map_scalebar.json``. The bar is laid out when it
is DRAWN, from the final axes box and the label's own size (as
``figure_measure_shapes`` does), so a tight layout or an equal-aspect box has
already settled; placement is in screen pixels (0.75 pt each) so it matches.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from matplotlib.artist import Artist
from matplotlib.lines import Line2D
from matplotlib.text import Text
from matplotlib.transforms import IdentityTransform

from quantized.calc.map_scalebar import (
    BAR_PX,
    DEFAULT_COLOR,
    check_scale_bar,
    resolve_scale_bar,
    scale_bar_layout,
)

__all__ = ["check_scale_bar", "draw_scale_bar"]

_PX_PT = 0.75  # one CSS pixel in points, as the measurement shapes use


class _MapScaleBar(Artist):
    """The bar and its label, positioned per draw in display coordinates."""

    def __init__(self, spec: Mapping[str, Any], font_size: float) -> None:
        super().__init__()
        self._spec = spec
        color = str(spec.get("color") or DEFAULT_COLOR)
        self._bar = Line2D(
            [], [], transform=IdentityTransform(), color=color,
            linewidth=BAR_PX * _PX_PT, solid_capstyle="butt",
        )
        self._text = Text(
            0, 0, "", transform=IdentityTransform(), ha="left", va="top",
            fontsize=font_size, color=color,
        )

    def draw(self, renderer: Any) -> None:
        ax = self.axes
        if renderer is None or ax is None or not self.get_visible():
            return
        x0, x1 = ax.get_xlim()
        box = ax.get_window_extent(renderer)
        k = renderer.points_to_pixels(_PX_PT)  # display pixels per screen pixel
        span = abs(x1 - x0)
        resolved = resolve_scale_bar(self._spec, span)
        if resolved is None or span == 0:
            return
        length, text = resolved
        self._bar.set_figure(self.figure)
        self._text.set_figure(self.figure)
        self._text.set_text(text)
        ext = self._text.get_window_extent(renderer)
        plot_w, plot_h = box.width / k, box.height / k
        lay = scale_bar_layout(
            str(self._spec.get("corner", "br")), plot_w, plot_h,
            length / span * plot_w, ext.width / k, ext.height / k,
        )

        def display(px: float, py: float) -> tuple[float, float]:
            return float(box.x0 + px * k), float(box.y1 - py * k)

        self._bar.set_data(
            [display(lay["x0"], lay["y"])[0], display(lay["x1"], lay["y"])[0]],
            [display(0, lay["y"])[1]] * 2,
        )
        self._text.set_position(display(lay["label_left"], lay["label_top"]))
        self._bar.draw(renderer)
        self._text.draw(renderer)


def draw_scale_bar(ax: Any, spec: Mapping[str, Any] | None, *, font_size: float) -> None:
    """Add the scale bar to a 2-D map's axes (nothing for ``None``); ``spec["unit"]``
    is the X axis' unit, which an automatic label carries."""
    if not spec:
        return
    check_scale_bar(spec)
    artist = _MapScaleBar(spec, font_size)
    artist.set_gid("map-scalebar")
    artist._bar.set_gid("map-scalebar:bar")
    artist._text.set_gid("map-scalebar:label")
    ax.add_artist(artist)
