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

__all__ = ["TransposedAxes", "horizontal_bars", "oriented"]

# Attribute names that address one axis: the "x"/"y" in them is swapped.
_AXIS_NAME = re.compile(
    r"^(set_|get_|invert_|secondary_)?([xy])(label|lim|scale|ticks|ticklabels|axis|bound|margin"
    r"|axis_inverted|axis_transform)$"
)
_PAIRS = {"axvline": "axhline", "axhline": "axvline", "axvspan": "axhspan",
          "axhspan": "axvspan"}  # fmt: skip
# The spine that carries an axis moves with it: the Y axis sits at the bottom.
_SPINE = {"left": "bottom", "bottom": "left", "right": "top", "top": "right"}
_OTHER = {"x": "y", "y": "x"}


def horizontal_bars(series_styles: Sequence[Mapping[str, Any] | None] | None) -> bool:
    """True when any series is drawn as horizontal bars."""
    return any(s is not None and s.get("bars") == "horizontal" for s in series_styles or ())


def _swap_name(name: str) -> str:
    if name in _PAIRS:
        return _PAIRS[name]
    m = _AXIS_NAME.match(name)
    if m is None:
        return name
    return f"{m.group(1) or ''}{_OTHER[m.group(2)]}{m.group(3) or ''}"


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

    def text(self, x: float, y: float, s: str, *args: Any, **kw: Any) -> Any:
        if kw.get("transform") is not None:
            return self.real.text(x, y, s, *args, **kw)  # axes/figure fractions
        return self.real.text(y, x, s, *args, **kw)

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
