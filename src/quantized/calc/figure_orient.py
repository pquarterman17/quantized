"""Horizontal bars on export (``SeriesStyle.bars == "horizontal"`` — an
Origin bar graph, plot type 215): the figure turns on its side.

Origin draws such a layer with its X axis vertical and Y along the bottom;
the screen does the same through uPlot's scale orientation
(``frontend/src/lib/uplotOrient.ts``), so X keeps its limits, scale, format
and title and only the geometry rotates. matplotlib has no rotation, so
:class:`TransposedAxes` stands in for the real ``Axes`` inside
``figure.draw_series_axes``: every call that names an axis is sent to the
other one (``set_xlim`` -> ``set_ylim``, ``xaxis`` -> ``yaxis``,
``axvline`` -> ``axhline``, ``tick_params(axis="x")`` -> ``"y"``) and the
drawing calls swap their coordinates (``plot(x, y)`` -> ``plot(y, x)``,
``bar`` -> ``barh``, ``fill_between`` -> ``fill_betweenx``, ``errorbar``
with its ``xerr``/``yerr`` exchanged). Anything else is passed through
unchanged — axes-fraction placement (``transAxes``), legends. ``spines``
are addressed by side, so the Y axis's spine is the bottom one, and
``twinx`` gives the secondary Y axis along the top.

Applied when any series asks for horizontal bars, as on screen: Origin
rotates the whole layer, not one curve.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle

__all__ = ["TransposedAxes", "horizontal_bars", "oriented"]

# Attribute names that address one axis: the "x"/"y" in them is swapped.
_AXIS_NAME = re.compile(
    r"^(set_|get_|invert_|secondary_)?([xy])(label|lim|scale|ticks|ticklabels|axis|bound|margin"
    r"|axis_inverted|axis_transform)$"
)
# The spine that carries an axis moves with it: the Y axis sits at the bottom.
_SPINE = {"left": "bottom", "bottom": "left", "right": "top", "top": "right"}
_OTHER = {"x": "y", "y": "x"}


def horizontal_bars(series_styles: Sequence[Mapping[str, Any] | None] | None) -> bool:
    """True when any series is drawn as horizontal bars."""
    return any(s is not None and s.get("bars") == "horizontal" for s in series_styles or ())


def _swap_name(name: str) -> str:
    m = _AXIS_NAME.match(name)
    if m is None:
        return name
    return f"{m.group(1) or ''}{_OTHER[m.group(2)]}{m.group(3) or ''}"


# An axis-spanning line or band's extent along the OTHER axis (axes fraction).
_SPAN_KW = {"xmin": "ymin", "xmax": "ymax", "ymin": "xmin", "ymax": "xmax"}


def _swap_span_kw(kw: dict[str, Any]) -> dict[str, Any]:
    return {_SPAN_KW.get(k, k): v for k, v in kw.items()}


def _swap_axis_kw(kw: dict[str, Any]) -> dict[str, Any]:
    if kw.get("axis") in _OTHER:
        kw["axis"] = _OTHER[kw["axis"]]
    return kw


class _Spines:
    """``Axes.spines`` addressed by the turned plot's sides."""

    def __init__(self, spines: Any) -> None:
        self._spines = spines

    def __getitem__(self, side: str) -> Any:
        return self._spines[_SPINE.get(side, side)]

    def __getattr__(self, name: str) -> Any:
        return getattr(self._spines, name)


class TransposedAxes:
    """A real ``Axes`` seen with x and y exchanged (module doc)."""

    def __init__(self, ax: Any) -> None:
        self.real = ax

    def __getattr__(self, name: str) -> Any:
        return getattr(self.real, _swap_name(name))

    @property
    def spines(self) -> _Spines:
        return _Spines(self.real.spines)

    def twinx(self) -> TransposedAxes:
        """The secondary Y axis, along the top (a ``twiny`` turned back)."""
        return TransposedAxes(self.real.twiny())

    def plot(self, x: Any, y: Any, *args: Any, **kw: Any) -> Any:
        return self.real.plot(y, x, *args, **kw)

    def scatter(self, x: Any, y: Any, *args: Any, **kw: Any) -> Any:
        return self.real.scatter(y, x, *args, **kw)

    def bar(self, x: Any, height: Any, width: float = 0.8, **kw: Any) -> Any:
        return self.real.barh(x, height, height=width, **kw)

    def fill_between(self, x: Any, y1: Any, y2: Any = 0, **kw: Any) -> Any:
        return self.real.fill_betweenx(x, y1, y2, **kw)

    def errorbar(self, x: Any, y: Any, yerr: Any = None, xerr: Any = None, **kw: Any) -> Any:
        return self.real.errorbar(y, x, yerr=xerr, xerr=yerr, **kw)

    def _fraction(self, transform: Any) -> bool:
        """True for axes / figure fractions, which do not turn."""
        figure = getattr(self.real, "figure", None)
        return transform is not None and transform in (
            self.real.transAxes, getattr(figure, "transFigure", None)
        )

    def text(self, x: float, y: float, s: str, *args: Any, **kw: Any) -> Any:
        if self._fraction(kw.get("transform")):
            return self.real.text(x, y, s, *args, **kw)
        # data, or an axis-blended transform (got through this view, so
        # already the other axis's): the coordinates swap with it
        return self.real.text(y, x, s, *args, **kw)

    def annotate(self, text: str, xy: Any, *args: Any, **kw: Any) -> Any:
        if kw.get("xycoords", "data") == "data":
            xy = (xy[1], xy[0])
        return self.real.annotate(text, xy, *args, **kw)

    def axvline(self, x: float = 0, *args: Any, **kw: Any) -> Any:
        return self.real.axhline(x, *args, **_swap_span_kw(kw))

    def axhline(self, y: float = 0, *args: Any, **kw: Any) -> Any:
        return self.real.axvline(y, *args, **_swap_span_kw(kw))

    def axvspan(self, x0: float, x1: float, *args: Any, **kw: Any) -> Any:
        return self.real.axhspan(x0, x1, *args, **_swap_span_kw(kw))

    def axhspan(self, y0: float, y1: float, *args: Any, **kw: Any) -> Any:
        return self.real.axvspan(y0, y1, *args, **_swap_span_kw(kw))

    def add_patch(self, patch: Any) -> Any:
        if isinstance(patch, Rectangle) and not patch.is_transform_set():
            (x, y), w, h = patch.get_xy(), patch.get_width(), patch.get_height()
            patch.set_xy((y, x))
            patch.set_width(h)
            patch.set_height(w)
        return self.real.add_patch(patch)

    def add_artist(self, artist: Any) -> Any:
        if isinstance(artist, Line2D) and (
            not artist.is_transform_set() or artist.get_transform() is self.real.transData
        ):
            x, y = artist.get_xdata(), artist.get_ydata()
            artist.set_data(y, x)
        return self.real.add_artist(artist)

    def tick_params(self, *args: Any, **kw: Any) -> Any:
        return self.real.tick_params(*args, **_swap_axis_kw(kw))

    def grid(self, *args: Any, **kw: Any) -> Any:
        return self.real.grid(*args, **_swap_axis_kw(kw))

    def margins(self, *args: Any, **kw: Any) -> Any:
        if "x" in kw or "y" in kw:
            kw["x"], kw["y"] = kw.pop("y", None), kw.pop("x", None)
            kw = {k: v for k, v in kw.items() if v is not None}
        return self.real.margins(*args[::-1], **kw)


def oriented(ax: Any, series_styles: Sequence[Mapping[str, Any] | None] | None) -> Any:
    """``ax`` itself, or its :class:`TransposedAxes` for horizontal bars (an
    already turned ``ax`` is returned as is)."""
    if isinstance(ax, TransposedAxes) or not horizontal_bars(series_styles):
        return ax
    return TransposedAxes(ax)
