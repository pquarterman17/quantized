"""Draw the point labels (gap audit 8, LBL) into an export Axes.

The frontend lays the labels out once (``lib/pointLabelLayout.ts``: which points,
the text, the collision thinning) and sends the finished list as
``overrides.point_labels = {"points": [{x, y, text, s}], "note": str?}``; the live
canvas draws that same list, so the two match. This module only validates and
draws it: each label sits up and to the right of its point in the colour of
series ``s`` (an index among the drawn series), and the one-line ``note`` (a
refusal or a thinning message) is printed bottom-left. Pure layer: no
fastapi/pydantic; matplotlib is reached only through the Axes it is given.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from quantized.calc.figure_orient import horizontal_bars
from quantized.calc.figure_point_label_place import PlacedLabels, avoid_options, footnote

__all__ = ["MAX_POINT_LABELS", "apply_point_labels", "validate_point_labels"]

MAX_POINT_LABELS = 500  # the layout caps itself far lower; this bounds a hand-made request
_MAX_TEXT = 200


def validate_point_labels(
    ov: Mapping[str, Any],
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """The checked ``(points, note)`` of ``ov["point_labels"]``; ``([], None)`` when
    absent. ``ValueError`` (a 422) for a malformed list or a view the labels
    cannot honestly sit on (exchanged axes, x breaks, horizontal bars)."""
    raw = ov.get("point_labels")
    if raw is None:
        return [], None
    if not isinstance(raw, Mapping) or not isinstance(raw.get("points"), list):
        raise ValueError("point_labels must be {points: [...], note?: text}")
    points = raw["points"]
    if points:  # a note alone (a refusal printed under the plot) is fine on any view
        if ov.get("exchange_xy"):
            raise ValueError("point_labels are not supported together with exchange_xy")
        if horizontal_bars(series_styles):
            raise ValueError("point_labels are not supported on a graph with horizontal bars")
    if ov.get("x_breaks"):  # the broken figure draws neither
        raise ValueError("point_labels are not supported together with x_breaks")
    if len(points) > MAX_POINT_LABELS:
        raise ValueError(f"point_labels has {len(points)} labels; the limit is {MAX_POINT_LABELS}")
    note = raw.get("note")
    if note is not None and not isinstance(note, str):
        raise ValueError("point_labels note must be text")
    out: list[dict[str, Any]] = []
    for p in points:
        if not isinstance(p, Mapping):
            raise ValueError("each point label must be {x, y, text, s}")
        x, y, text, s = p.get("x"), p.get("y"), p.get("text"), p.get("s", 0)
        if (
            isinstance(x, bool)
            or isinstance(y, bool)
            or not isinstance(x, (int, float))
            or not isinstance(y, (int, float))
            or not math.isfinite(x)
            or not math.isfinite(y)
        ):
            raise ValueError("each point label needs a finite x and y")
        if not isinstance(text, str) or not text or len(text) > _MAX_TEXT:
            raise ValueError(f"each point label needs text of 1 to {_MAX_TEXT} characters")
        if isinstance(s, bool) or not isinstance(s, int) or s < 0:
            raise ValueError("each point label's series index s must be a non-negative integer")
        out.append({"x": float(x), "y": float(y), "text": text, "s": s})
    return out, note


def _color(artists: Sequence[Any], s: int) -> str:
    getter = getattr(artists[s], "get_color", None) if s < len(artists) else None
    c = getter() if callable(getter) else None
    return c if isinstance(c, str) else f"C{s % 10}"


def apply_point_labels(
    ax: Any,
    ov: Mapping[str, Any],
    artists: Sequence[Any],
    series_styles: Sequence[Mapping[str, Any] | None] | None = None,
) -> None:
    points, note = validate_point_labels(ov, series_styles)
    if not points and not note:
        return
    xlim, ylim = ax.get_xlim(), ax.get_ylim()  # labels never widen the exported view
    auto_x, auto_y = ax.get_autoscalex_on(), ax.get_autoscaley_on()
    avoid = avoid_options(ov["point_labels"].get("avoid"))
    foot = footnote(ax, note)  # the note sits in the figure's footer, never over the data
    if avoid:  # plan item 18: placed at draw time, with the figure's own text metrics
        ax.add_artist(
            PlacedLabels(ax, points, [_color(artists, p["s"]) for p in points], note, avoid, foot)
        )
        points = []
    for p in points:
        ax.annotate(
            p["text"],
            (p["x"], p["y"]),
            xytext=(3, 3),
            textcoords="offset points",
            fontsize="x-small",
            color=_color(artists, p["s"]),
            annotation_clip=True,
            clip_on=True,
        )
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
    ax.set_autoscalex_on(auto_x)
    ax.set_autoscaley_on(auto_y)
