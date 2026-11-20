"""The preview-oracle image signals (tools/visual/origin_preview_signals.py).

Synthetic images only: a framed white plot with drawn curves stands in for an
Origin preview, so the frame finder, ink/hue measures and the occupancy-grid
overlap are locked without any corpus file.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "visual"))

from origin_preview_signals import (  # noqa: E402
    bbox_iou,
    find_frame,
    grid_overlap,
    ink_signals,
    union_box,
)

RED = (220, 30, 30)
BLUE = (30, 30, 220)


def _canvas(w: int = 200, h: int = 150) -> np.ndarray:
    img = np.full((h, w, 3), 255, dtype=np.uint8)
    img[20, 30:180] = 0  # top
    img[130, 30:180] = 0  # bottom
    img[20:131, 30] = 0  # left
    img[20:131, 179] = 0  # right
    return img


def _line(img: np.ndarray, colour: tuple[int, int, int], y_of_x, x0: int, x1: int) -> None:
    for x in range(x0, x1):
        y = int(y_of_x(x))
        img[y : y + 2, x] = colour


def test_frame_found_from_long_dark_runs() -> None:
    assert find_frame(_canvas()) == (30, 20, 180, 131)


def test_frame_falls_back_without_axes() -> None:
    blank = np.full((100, 200, 3), 255, dtype=np.uint8)
    assert find_frame(blank) == (20, 10, 180, 90)


def test_counts_distinct_coloured_series_and_ignores_the_frame() -> None:
    img = _canvas()
    assert ink_signals(img, find_frame(img)).ink_fraction == 0.0
    _line(img, RED, lambda x: 40 + (x - 40) * 0.5, 40, 170)
    _line(img, BLUE, lambda x: 110, 40, 170)
    sig = ink_signals(img, find_frame(img))
    assert sig.hue_clusters == 2
    assert sig.ink_bbox is not None and sig.ink_fraction > 0


def test_grid_overlap_separates_same_from_different_curves() -> None:
    small = _canvas()
    _line(small, RED, lambda x: 40 + (x - 40) * 0.5, 40, 170)
    # The same curve at 5x resolution: a different renderer, same picture.
    big = np.full((750, 1000, 3), 255, dtype=np.uint8)
    _line(big, RED, lambda x: 5 * (40 + (x / 5 - 40) * 0.5), 200, 850)
    big_box = (150, 100, 900, 655)
    same = grid_overlap(ink_signals(small, find_frame(small)).grid, ink_signals(big, big_box).grid)
    flat = np.full((750, 1000, 3), 255, dtype=np.uint8)
    flat[640:645, 200:850] = RED  # a flattened (phantom) curve along the bottom
    diff = grid_overlap(ink_signals(small, find_frame(small)).grid, ink_signals(flat, big_box).grid)
    assert same is not None and same > 0.8
    assert diff is not None and diff < 0.3


def test_overlap_and_iou_edge_cases() -> None:
    empty = [[0] * 4 for _ in range(3)]
    full = [[1] * 4 for _ in range(3)]
    assert grid_overlap(empty, empty) is None
    assert grid_overlap(empty, full) == 0.0
    assert grid_overlap(full, full) == 1.0
    assert bbox_iou(None, (0, 0, 1, 1)) is None
    assert bbox_iou((0, 0, 1, 1), (0, 0, 1, 1)) == 1.0
    assert bbox_iou((0, 0, 0.5, 1), (0.5, 0, 1, 1)) == 0.0


def test_union_box_clamps_to_image() -> None:
    rects = [{"x": -3, "y": 10, "w": 50, "h": 40}, {"x": 60, "y": 5, "w": 100, "h": 20}]
    assert union_box(rects, 120, 100) == (0, 5, 120, 50)
    assert union_box([], 10, 10) is None


def test_thin_grey_line_counts_as_ink() -> None:
    # A 0.5 pt black line anti-aliases to mid-grey on a light canvas.
    img = np.full((300, 400, 3), 248, dtype=np.uint8)
    img[150, 50:350] = (160, 160, 162)
    sig = ink_signals(img, (20, 20, 380, 280))
    assert sig.ink_fraction > 0 and sig.hue_clusters == 0


def test_colour_fringes_on_black_strokes_are_not_series() -> None:
    img = _canvas()
    img[80, 40:170] = (0, 0, 0)
    img[79, 40:170] = (255, 182, 102)  # sub-pixel AA fringe above
    img[81, 40:170] = (102, 182, 255)  # ... and below
    assert ink_signals(img, find_frame(img)).hue_clusters == 0
    _line(img, RED, lambda x: 40, 40, 170)
    assert ink_signals(img, find_frame(img)).hue_clusters == 1
