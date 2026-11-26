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

from collections.abc import Mapping
from typing import Any

from matplotlib.lines import Line2D
from matplotlib.patches import Polygon
from matplotlib.text import Annotation

from quantized.calc.annotation_measure import (
    MEASURE_KINDS,
    label_below,
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


def _label(
    ax: Any,
    text: str,
    xy: tuple[float, float],
    offset_px: tuple[float, float],
    align: tuple[str, str],
    color: str,
    size: float,
    opacity: float,
    gid: str,
) -> None:
    note = Annotation(
        text,
        xy=xy,
        xycoords="data",
        xytext=(offset_px[0] * _PX_PT, offset_px[1] * _PX_PT),
        textcoords="offset points",
        ha=align[0],
        va=align[1],
        fontsize=size,
        color=color,
        alpha=opacity,
        annotation_clip=False,
    )
    note.set_gid(gid)
    # add_artist, not ax.text/annotate: ax.texts index the figure's annotations
    # in the hit map (figure_hitmap "ann:<i>"), and a label is not one.
    ax.add_artist(note)


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
        _label(
            ax, text, (_axis_mid(ax, "x", x1, x2), _axis_mid(ax, "y", y1, y2)),
            (6, -6 if below else 6), ("left", "top" if below else "bottom"),
            stroke, font_size, opacity, label_id,
        )
    elif kind == "angle":
        x3, y3 = float(sh.get("x3", x1)), float(sh.get("y3", y1))
        line([x2, x1, x3], [y2, y1, y3])
        dot(x1, y1)
        _label(ax, text, (x1, y1), (8, 8), ("left", "bottom"), stroke, font_size, opacity, label_id)
    else:  # scalebar
        vertical = sh.get("orient") == "v"
        length = float(sh.get("length") or abs((y2 - y1) if vertical else (x2 - x1)))
        ex, ey = scalebar_end(x1, y1, "v" if vertical else "h", length)
        line([x1, ex], [y1, ey], solid_capstyle="butt")
        mid = (_axis_mid(ax, "x", x1, ex), _axis_mid(ax, "y", y1, ey))
        if vertical:
            _label(ax, text, mid, (8, 0), ("left", "center"), stroke, font_size, opacity, label_id)
        else:
            _label(ax, text, mid, (0, -6), ("center", "top"), stroke, font_size, opacity, label_id)
