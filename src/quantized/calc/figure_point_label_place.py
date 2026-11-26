"""Overlap-avoiding point labels in an export Axes (plan item 18).

``overrides.point_labels.avoid = {leader_distance, leader_width, leader_dashed}``
asks the figure to place the labels itself: the placement rule is
``calc.label_placement`` (twin of the canvas's ``lib/labelPlacement.ts``, pinned
by ``tests/fixtures/wire/point_label_placement.json``) run over THIS renderer's
own text widths. It runs at DRAW time, in the final transforms (the caller's
``tight_layout`` moves the axes after this module is called), so the plot area,
the anchors and the text widths are the ones the saved figure has. The artist
keeps its last result in ``placements`` for tests.

Cross-side tolerance: the rule is exact for identical inputs; the canvas and
matplotlib measure the same string within about 5 % of its width, so a label can
land a slot or two apart on the two sides in a crowded spot. Uncrowded labels
(which keep the default slot) agree to the gap constant, and overlap / leader
outcomes of the robust fixture cases are unchanged under +-5 % widths.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from matplotlib.artist import Artist
from matplotlib.font_manager import FontProperties
from matplotlib.lines import Line2D
from matplotlib.text import Text
from matplotlib.transforms import IdentityTransform

from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.label_placement import Placed, PlaceItem, PlaceOpts, Rect, place_labels

__all__ = ["NOTE_BAND_ATTR", "PlacedLabels", "avoid_options", "footnote"]

# Set on the figure when a point-label note is in its footer: ``calc.figure_layout`` then
# reserves the footer band (the same one a caveat footnote gets) in its tight layout.
NOTE_BAND_ATTR = "_qz_point_label_note"

_RANGES = {"leader_distance": (0.5, 8.0), "leader_width": (0.25, 3.0)}
_GAP_PT, _PAD_PT, _MARKER_PT = (
    3.0,
    0.75,
    2.5,
)  # the export's own default-slot offset is (3, 3) points


def avoid_options(raw: Any) -> dict[str, Any] | None:
    """The checked ``avoid`` block, or ``None`` (off). ``ValueError`` when malformed."""
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise ValueError(
            "point_labels avoid must be {leader_distance, leader_width, leader_dashed}"
        )
    out: dict[str, Any] = {}
    for key, (lo, hi) in _RANGES.items():
        v = raw.get(key)
        if (
            isinstance(v, bool)
            or not isinstance(v, (int, float))
            or not math.isfinite(v)
            or not lo <= v <= hi
        ):
            raise ValueError(f"point_labels avoid {key} must be a number from {lo} to {hi}")
        out[key] = float(v)
    dashed = raw.get("leader_dashed", False)
    if not isinstance(dashed, bool):
        raise ValueError("point_labels avoid leader_dashed must be true or false")
    out["leader_dashed"] = dashed
    return out


def footnote(ax: Any, note: str | None) -> Any:
    """The note as an italic footer line at the bottom-left of the figure, as every other
    export footnote is (``calc.figure_group_notes.add_caveat``): under the axes, not over the
    data. ``None`` when there is no note."""
    if not note:
        return None
    fig = ax.figure
    setattr(fig, NOTE_BAND_ATTR, True)
    return fig.text(
        0.01, 0.01, safe_mathtext_label(note), ha="left", va="bottom", fontsize="small",
        style="italic", color="0.4",
    )


def overlap_note(n: int) -> str | None:
    return f"{n} {'label' if n == 1 else 'labels'} could not avoid overlap" if n else None


class PlacedLabels(Artist):
    """Draws the labels (and leader lines) at the slots ``place_labels`` picks."""

    def __init__(
        self,
        ax: Any,
        points: Sequence[Mapping[str, Any]],
        colors: Sequence[str],
        note: str | None,
        avoid: Mapping[str, Any],
        foot: Any = None,
    ) -> None:
        super().__init__()
        self._ax, self._points, self._colors = ax, list(points), list(colors)
        self._note, self._avoid, self._foot = note, dict(avoid), foot
        self._prop = FontProperties(size="x-small")
        self.placements: list[Placed] = []
        self.items: list[PlaceItem] = []  # the measured boxes of the last draw, for tests
        self.set_zorder(10)
        self.set_in_layout(False)  # never part of tight_layout's extents

    def draw(self, renderer: Any) -> None:
        if not self.get_visible():
            return
        ax, fig = self._ax, self._ax.figure
        ppp = float(renderer.points_to_pixels(1.0))
        box = ax.get_window_extent(renderer)
        size = float(self._prop.get_size_in_points())
        n = len(self._points)
        pts = ax.transData.transform([(p["x"], p["y"]) for p in self._points]) if n else []
        items: list[PlaceItem] = []
        for p, (px, py) in zip(self._points, pts, strict=True):
            w = float(renderer.get_text_width_height_descent(p["text"], self._prop, False)[0])
            items.append(PlaceItem(float(px), -float(py), w, size * 1.2 * ppp, abs(float(p["y"]))))
        h = size * 1.2 * ppp
        self.items = items
        self.placements = (
            place_labels(
                items,
                Rect(float(box.x0), -float(box.y1), float(box.x1), -float(box.y0)),
                PlaceOpts(
                    gap=_GAP_PT * ppp,
                    marker_r=_MARKER_PT * ppp,
                    step=h,
                    rings=3,
                    pad=_PAD_PT * ppp,
                    leader_min=float(self._avoid["leader_distance"]),
                ),
            )
            if n
            else []
        )
        clip = ax.patch
        for p, it, pl, color in zip(
            self._points, items, self.placements, self._colors, strict=True
        ):
            if pl.leader:
                x0, y0, x1, y1 = pl.leader
                line = Line2D(
                    [x0, x1],
                    [-y0, -y1],
                    transform=IdentityTransform(),
                    color=color,
                    linewidth=self._avoid["leader_width"],
                    linestyle="--" if self._avoid["leader_dashed"] else "-",
                )
                line.set_figure(fig)
                line.set_clip_path(clip)
                line.draw(renderer)
            t = Text(
                pl.left,
                -(pl.top + it.h),
                p["text"],
                fontproperties=self._prop,
                color=color,
                ha="left",
                va="bottom",
                transform=IdentityTransform(),
            )
            t.set_figure(fig)
            t.set_clip_path(clip)
            t.draw(renderer)
        extra = overlap_note(sum(1 for pl in self.placements if pl.overlap))
        text = "; ".join(s for s in (self._note, extra) if s)
        if text:
            if self._foot is None:  # no base note: the overlap count opens the footer now
                self._foot = footnote(ax, text)
                self._foot.draw(renderer)  # added mid-draw: the figure skips it this pass
            else:
                self._foot.set_text(safe_mathtext_label(text))
