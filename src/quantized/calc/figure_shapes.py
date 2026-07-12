"""Drawn-shape overrides (MAIN #27) -- export parity for the screen's
``lib/uplotShapes.ts``. Split out of ``figure_overrides.py`` purely to stay
under each module's line-count discipline (same reasoning as
``figure_labels.py`` / ``figure_break.py``) -- the behavioural contract is
still ``figure_overrides``'s; ``_apply_overrides`` calls ``_apply_shapes``
as its last step, AFTER the annotation sweep, so shapes paint on TOP of
everything else the override sweep drew (annotations included) -- matching
export intent: shapes mark up the finished figure. Pure layer: mapping in ->
mutates the passed matplotlib Figure/Axes, no return value.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Literal

from matplotlib.lines import Line2D
from matplotlib.patches import Ellipse, FancyArrowPatch, Rectangle

__all__ = ["_apply_shapes", "_validate_shapes"]

_SHAPE_KINDS = frozenset({"arrow", "line", "rect", "ellipse"})

# Default whole-shape opacity (fill AND stroke, ONE knob) mirroring the
# screen's `defaultShapeOpacity` (lib/uplotShapes.ts): 1 for line/arrow, 0.35
# for rect/ellipse (a freshly drawn box reads as visibly translucent OVER
# the data it marks).
_DEFAULT_OPACITY = {"arrow": 1.0, "line": 1.0, "rect": 0.35, "ellipse": 0.35}
_DEFAULT_WIDTH = 1.5
_DEFAULT_STROKE = "black"


def _validate_shapes(shapes: Sequence[Mapping[str, Any]] | None) -> None:
    """Raise ``ValueError`` on a malformed shape (bad kind, non-finite
    coords); a shape with an unknown/missing key inside is otherwise
    tolerant (unknown keys ignored), mirroring ``_validate_overrides``."""
    if not shapes:
        return
    for sh in shapes:
        kind = sh.get("kind")
        if kind not in _SHAPE_KINDS:
            raise ValueError(f"shape kind must be one of {sorted(_SHAPE_KINDS)}")
        for key in ("x1", "y1", "x2", "y2"):
            v = sh.get(key)
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                raise ValueError(f"shape {key} must be a number")


def _shape_endpoints(
    sh: Mapping[str, Any], ax: Any, fig: Any
) -> tuple[tuple[float, float], tuple[float, float], Any]:
    """(p1, p2, transform) for one shape, resolving its anchor -- DATA (the
    default: ``ax.transData``, applied implicitly by omitting ``transform``
    and adding via ``ax.add_patch``/``ax.add_line``) or PAGE (explicit
    ``fig.transFigure``, Y FLIPPED -- canvas y grows downward, matplotlib
    figure fraction grows upward -- the SAME convention
    ``_apply_overrides``'s page-anchored annotation uses)."""
    x1, y1 = float(sh["x1"]), float(sh["y1"])
    x2, y2 = float(sh["x2"]), float(sh["y2"])
    if sh.get("anchor") == "page":
        return (x1, 1.0 - y1), (x2, 1.0 - y2), fig.transFigure
    return (x1, y1), (x2, y2), ax.transData


def _apply_shapes(fig: Any, ax: Any, shapes: Sequence[Mapping[str, Any]] | None) -> None:
    """Draw MAIN #27 shapes (arrow/line/rect/ellipse). Arrows use
    ``FancyArrowPatch``; plain lines ``Line2D``; rect/ellipse the matching
    matplotlib patch with ``alpha`` -- all added via ``ax.add_patch``/
    ``ax.add_line`` (data-anchored, the default -- no explicit ``transform``
    needed there; matplotlib resolves an artist added this way against
    ``ax.transData``) or with an EXPLICIT ``transform=fig.transFigure`` for
    a page-anchored shape (``ax.add_patch``/``add_line`` never override an
    already-set transform -- verified empirically, see the porting notes).
    """
    if not shapes:
        return
    for sh in shapes:
        kind = sh.get("kind")
        if kind not in _SHAPE_KINDS:
            continue
        p1, p2, transform = _shape_endpoints(sh, ax, fig)
        stroke = sh.get("stroke") or _DEFAULT_STROKE
        width = float(sh.get("width") or _DEFAULT_WIDTH)
        dash: Literal["-", "--"] = "--" if sh.get("dash") else "-"
        opacity = sh.get("opacity")
        opacity = float(opacity) if opacity is not None else _DEFAULT_OPACITY[kind]
        fill = sh.get("fill") or stroke
        patch: Any

        if kind == "arrow":
            patch = FancyArrowPatch(
                p1,
                p2,
                transform=transform,
                arrowstyle="-|>",
                mutation_scale=12 + width * 4,
                # matplotlib's FancyArrowPatch default shrinkA/shrinkB=2pt
                # insets BOTH ends from the given points (meant for
                # "annotate near, not touching, an object") -- WYSIWYG with
                # the screen's canvas draw (no shrink at all) needs the
                # endpoints to land EXACTLY where dragged.
                shrinkA=0,
                shrinkB=0,
                color=stroke,
                linewidth=width,
                linestyle=dash,
                alpha=opacity,
            )
            ax.add_patch(patch)
        elif kind == "line":
            line = Line2D(
                [p1[0], p2[0]],
                [p1[1], p2[1]],
                transform=transform,
                color=stroke,
                linewidth=width,
                linestyle=dash,
                alpha=opacity,
            )
            ax.add_line(line)
        elif kind == "rect":
            x0, x1v = min(p1[0], p2[0]), max(p1[0], p2[0])
            y0, y1v = min(p1[1], p2[1]), max(p1[1], p2[1])
            patch = Rectangle(
                (x0, y0),
                x1v - x0,
                y1v - y0,
                transform=transform,
                edgecolor=stroke,
                facecolor=fill,
                linewidth=width,
                linestyle=dash,
                alpha=opacity,
            )
            ax.add_patch(patch)
        else:  # ellipse
            cx, cy = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
            w, h = abs(p2[0] - p1[0]), abs(p2[1] - p1[1])
            patch = Ellipse(
                (cx, cy),
                w,
                h,
                transform=transform,
                edgecolor=stroke,
                facecolor=fill,
                linewidth=width,
                linestyle=dash,
                alpha=opacity,
            )
            ax.add_patch(patch)
