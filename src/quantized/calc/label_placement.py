"""Deterministic label placement that avoids overlaps (plan item 18).

ONE rule shared with the canvas (``frontend/src/lib/labelPlacement.ts``), pinned
by ``tests/fixtures/wire/point_label_placement.json``; each side calls it with
its OWN text metrics (canvas ``measureText``, matplotlib's renderer). Pure: no
matplotlib, no numpy. Units are whatever the caller measures in (device pixels
on both sides); y grows DOWNWARD.

Rules:

* Labels are placed in order of importance (largest first), then ``ax``
  (left to right), then input order, so a peak keeps its best slot.
* Candidate slots per label, in order: the default (up and right, exactly where
  an unplaced label sits today), above, below, left, right, then the other
  three diagonals; then the same eight again ``step`` farther out, for
  ``rings`` more rings. A slot at distance ``d`` keeps the box ``d`` from the
  point (a diagonal moves ``d`` on both axes; a cardinal one is centred).
* The first slot whose box lies inside ``rect``, touches no already placed box
  (kept ``pad`` apart) and covers no marker (a disc of radius ``marker_r`` at
  every anchor) wins.
* A label with no free slot keeps the default slot and is flagged ``overlap``;
  it still counts as placed. Nothing is ever dropped.
* A label whose box ends farther than ``leader_min`` label heights from its
  point gets a leader line from the box's nearest point to the marker edge.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

__all__ = ["DIRECTIONS", "Placed", "PlaceOpts", "PlaceItem", "Rect", "place_labels"]

#: (dx, dy) of each slot's direction, dy < 0 is up. Default (up-right) first.
DIRECTIONS: tuple[tuple[int, int], ...] = (
    (1, -1),
    (0, -1),
    (0, 1),
    (-1, 0),
    (1, 0),
    (-1, -1),
    (1, 1),
    (-1, 1),
)


@dataclass(frozen=True)
class PlaceItem:
    ax: float
    ay: float
    w: float
    h: float
    importance: float


@dataclass(frozen=True)
class Rect:
    left: float
    top: float
    right: float
    bottom: float


@dataclass(frozen=True)
class PlaceOpts:
    gap: float
    marker_r: float
    step: float
    rings: int = 3
    pad: float = 1.0
    leader_min: float = 1.5  # in label heights


@dataclass(frozen=True)
class Placed:
    left: float
    top: float
    overlap: bool
    leader: tuple[float, float, float, float] | None  # x0, y0 (label end), x1, y1 (marker end)


def _box(it: PlaceItem, d: float, direction: tuple[int, int]) -> tuple[float, float]:
    dx, dy = direction
    left = it.ax + d if dx > 0 else it.ax - d - it.w if dx < 0 else it.ax - it.w / 2
    top = it.ay - d - it.h if dy < 0 else it.ay + d if dy > 0 else it.ay - it.h / 2
    return left, top


def _free(
    box: tuple[float, float, float, float],
    rect: Rect,
    placed: Sequence[tuple[float, float, float, float]],
    anchors: Sequence[PlaceItem],
    o: PlaceOpts,
) -> bool:
    x0, y0, x1, y1 = box
    if x0 < rect.left or y0 < rect.top or x1 > rect.right or y1 > rect.bottom:
        return False
    for pl, pt, pr, pb in placed:
        if x0 < pr + o.pad and pl - o.pad < x1 and y0 < pb + o.pad and pt - o.pad < y1:
            return False
    r2 = o.marker_r * o.marker_r
    for a in anchors:
        nx, ny = min(max(a.ax, x0), x1), min(max(a.ay, y0), y1)
        if (nx - a.ax) ** 2 + (ny - a.ay) ** 2 < r2:
            return False
    return True


def _leader(
    it: PlaceItem, left: float, top: float, o: PlaceOpts
) -> tuple[float, float, float, float] | None:
    nx, ny = min(max(it.ax, left), left + it.w), min(max(it.ay, top), top + it.h)
    dx, dy = nx - it.ax, ny - it.ay
    dist = math.sqrt(dx * dx + dy * dy)
    if dist <= o.leader_min * it.h or dist == 0.0:
        return None
    k = o.marker_r / dist
    return nx, ny, it.ax + dx * k, it.ay + dy * k


def place_labels(items: Sequence[PlaceItem], rect: Rect, o: PlaceOpts) -> list[Placed]:
    """The slot of every item, aligned with ``items`` (see the module doc)."""
    order = sorted(range(len(items)), key=lambda i: (-items[i].importance, items[i].ax, i))
    out: list[Placed | None] = [None] * len(items)
    placed: list[tuple[float, float, float, float]] = []
    for i in order:
        it = items[i]
        chosen: tuple[float, float] | None = None
        for k in range(o.rings + 1):
            d = o.gap + k * o.step
            for direction in DIRECTIONS:
                left, top = _box(it, d, direction)
                if _free((left, top, left + it.w, top + it.h), rect, placed, items, o):
                    chosen = (left, top)
                    break
            if chosen:
                break
        overlap = chosen is None
        left, top = chosen if chosen else _box(it, o.gap, DIRECTIONS[0])
        placed.append((left, top, left + it.w, top + it.h))
        out[i] = Placed(left, top, overlap, _leader(it, left, top, o))
    return [p for p in out if p is not None]
