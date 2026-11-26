"""Measurement annotations in the vector export: slope (with the power-law
exponent on log axes and an optional slope triangle), distance, three-point
angle and scale bar.

The screen's ``lib/uplotMeasureShapes.ts`` draws the same marks and
``calc.annotation_measure`` is the one source of their labels, so both sides
print identical text (``tests/fixtures/wire/annotation_measures.json``). Called
by ``figure_shapes._apply_shapes`` for the four kinds below, which are always
anchored to the data: their labels read data units.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from matplotlib.lines import Line2D
from matplotlib.patches import Polygon
from matplotlib.text import Annotation, Text

from quantized.calc.annotation_measure import (
    MEASURE_KINDS,
    angle_label_centre,
    fit_label_box,
    label_below,
    label_origin,
    scalebar_end,
    shape_label,
    slope_triangle,
)

__all__ = ["MEASURE_KINDS", "apply_measure_shape", "default_measure_width", "validate_measure"]

_PX_PT = 0.75  # one CSS pixel in points: the screen's pixel offsets, as the annotations use
_DOT_PT = 4.5  # a 3 px radius dot is 6 px across
_TRIANGLE_FILL = 0.15  # the slope triangle's fill, as a share of the shape's opacity
_TRIANGLE_EDGE = 0.7  # ... and its edge width, as a share of the shape's width


def default_measure_width(kind: str) -> float:
    """A scale bar reads as a bar: twice the hairline width."""
    return 3.0 if kind == "scalebar" else 1.5


def validate_measure(sh: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` on a malformed measurement shape."""
    kind = sh.get("kind")
    if kind == "angle":
        for key in ("x3", "y3"):
            v = sh.get(key)
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                raise ValueError(f"angle shape {key} must be a number")
    if kind == "scalebar":
        length = sh.get("length")
        if length is not None and (
            not isinstance(length, (int, float)) or isinstance(length, bool) or not length > 0
        ):
            raise ValueError("scalebar length must be a positive number")
        if sh.get("orient") not in (None, "h", "v"):
            raise ValueError("scalebar orient must be 'h' or 'v'")


def _axis_mid(ax: Any, axis: str, a: float, b: float) -> float:
    """The data value halfway between ``a`` and ``b`` ON SCREEN: the midpoint
    in the axis' own transform, so a log axis gives the geometric mean."""
    t = (ax.xaxis if axis == "x" else ax.yaxis).get_transform()
    pa, pb = t.transform([a]), t.transform([b])
    return float(t.inverted().transform((pa + pb) / 2.0)[0])


_ARC_PX, _PAD_PX, _STEP_PX = 24.0, 3.0, 2.0  # the angle label's clearance, in screen pixels


class _Frame:
    """The axes box at DRAW time, as the screen's plot area: a plane with y
    growing downward, origin at the box's top-left, in display pixels. ``k`` is
    display pixels per screen pixel (the label offsets are given in the latter)."""

    def __init__(self, ax: Any, renderer: Any) -> None:
        self.ax = ax
        self.box = ax.get_window_extent(renderer)
        self.k = renderer.points_to_pixels(_PX_PT)

    def pos(self, x: float, y: float) -> tuple[float, float]:
        dx, dy = self.ax.transData.transform((x, y))
        return float(dx - self.box.x0), float(self.box.y1 - dy)

    @property
    def plot(self) -> tuple[float, float, float, float]:
        return 0.0, 0.0, float(self.box.width), float(self.box.height)


Place = Callable[[_Frame, float, float], tuple[float, float]]


class _FittedLabel(Annotation):
    """A measurement label that is positioned when it is DRAWN, once the final
    axes box and the text's own size are known: ``place`` gives its top-left
    corner in the frame and it is then shifted inside the plot area, the same
    rules as the canvas (``annotation_measure.fit_label_box``)."""

    def __init__(self, *args: Any, place: Place, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._place = place

    def draw(self, renderer: Any) -> None:
        if renderer is not None and self.get_visible():
            frame = _Frame(self.axes, renderer)
            ext = Text.get_window_extent(self, renderer)
            left, top = self._place(frame, ext.width, ext.height)
            left, top = fit_label_box(left, top, ext.width, ext.height, frame.plot)
            ax_x, ax_y = frame.pos(*self.xy)
            self.xyann = (left - ax_x, ax_y - top)  # top-left corner, from the anchor
        super().draw(renderer)


def _label(
    ax: Any,
    text: str,
    xy: tuple[float, float],
    place: Place,
    color: str,
    size: float,
    opacity: float,
    gid: str,
) -> None:
    note = _FittedLabel(
        text,
        xy=xy,
        xycoords="data",
        xytext=(0, 0),
        textcoords="offset pixels",
        ha="left",
        va="top",
        fontsize=size,
        color=color,
        alpha=opacity,
        annotation_clip=False,
        place=place,
    )
    note.set_gid(gid)
    # add_artist, not ax.text/annotate: ax.texts index the figure's annotations
    # in the hit map (figure_hitmap "ann:<i>"), and a label is not one.
    ax.add_artist(note)


def _anchored(
    anchor: tuple[float, float], offset: tuple[float, float], align: tuple[str, str]
) -> Place:
    """A label ``offset`` screen pixels from the data point ``anchor``, aligned."""

    def place(f: _Frame, w: float, h: float) -> tuple[float, float]:
        px, py = f.pos(*anchor)
        return label_origin(px + offset[0] * f.k, py + offset[1] * f.k, w, h, *align)

    return place


def _beside_angle(v: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> Place:
    """The angle label: on the bisector, clear of both arms."""

    def place(f: _Frame, w: float, h: float) -> tuple[float, float]:
        cx, cy = angle_label_centre(
            f.pos(*v), f.pos(*a), f.pos(*b), w, h, _ARC_PX * f.k, _PAD_PX * f.k, _STEP_PX * f.k
        )
        return cx - w / 2, cy - h / 2

    return place


def apply_measure_shape(
    ax: Any,
    sh: Mapping[str, Any],
    gid: str,
    *,
    stroke: str,
    width: float,
    dash: str,
    opacity: float,
    font_size: float,
) -> None:
    """Draw one measurement shape (``kind`` in :data:`MEASURE_KINDS`)."""
    kind = str(sh["kind"])
    x1, y1, x2, y2 = (float(sh[k]) for k in ("x1", "y1", "x2", "y2"))
    xlog, ylog = ax.get_xscale() == "log", ax.get_yscale() == "log"
    text = shape_label(sh, xlog, ylog) or ""
    style: dict[str, Any] = {
        "color": stroke,
        "linewidth": width,
        "linestyle": dash,
        "alpha": opacity,
    }

    def line(xs: list[float], ys: list[float], **kw: Any) -> None:
        artist = Line2D(xs, ys, **{**style, **kw})
        artist.set_gid(gid)
        ax.add_line(artist)

    def dot(x: float, y: float) -> None:
        ax.add_line(
            Line2D(
                [x], [y], marker="o", markersize=_DOT_PT, linestyle="none",
                color=stroke, alpha=opacity,
            )
        )

    label_id = f"{gid}:label"
    if kind in ("slope", "distance"):
        if kind == "slope" and sh.get("triangle"):
            tri = slope_triangle(x1, y1, x2, y2)
            ax.add_patch(
                Polygon(tri, closed=True, facecolor=stroke, linewidth=0,
                        alpha=opacity * _TRIANGLE_FILL)
            )
            ax.add_patch(
                Polygon(tri, closed=True, fill=False, edgecolor=stroke,
                        linewidth=width * _TRIANGLE_EDGE, alpha=opacity)
            )
        line([x1, x2], [y1, y2])
        if kind == "distance":
            dot(x1, y1)
            dot(x2, y2)
        below = label_below(x1, y1, x2, y2)
        mid = (_axis_mid(ax, "x", x1, x2), _axis_mid(ax, "y", y1, y2))
        place = _anchored(mid, (6, 6 if below else -6), ("left", "top" if below else "bottom"))
        _label(ax, text, mid, place, stroke, font_size, opacity, label_id)
    elif kind == "angle":
        x3, y3 = float(sh.get("x3", x1)), float(sh.get("y3", y1))
        line([x2, x1, x3], [y2, y1, y3])
        dot(x1, y1)
        place = _beside_angle((x1, y1), (x2, y2), (x3, y3))
        _label(ax, text, (x1, y1), place, stroke, font_size, opacity, label_id)
    else:  # scalebar
        vertical = sh.get("orient") == "v"
        length = float(sh.get("length") or abs((y2 - y1) if vertical else (x2 - x1)))
        ex, ey = scalebar_end(x1, y1, "v" if vertical else "h", length)
        line([x1, ex], [y1, ey], solid_capstyle="butt")
        mid = (_axis_mid(ax, "x", x1, ex), _axis_mid(ax, "y", y1, ey))
        offset, align = ((8, 0), ("left", "middle")) if vertical else ((0, 6), ("center", "top"))
        _label(ax, text, mid, _anchored(mid, offset, align), stroke, font_size, opacity, label_id)
