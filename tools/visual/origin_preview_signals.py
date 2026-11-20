"""Cheap, renderer-agnostic image signals for the Origin preview oracle.

Origin's saved graph previews are ~200 px wide thumbnails on a white page; our
screenshots are ~1100 px wide uPlot canvases in the light theme. Neither pixel
diffs nor OCR survive that gap, so every signal here is coarse and scale-free:

* the **plot area** (Origin: the axis frame found from long dark runs; ours:
  the uPlot ``.u-over`` rects the shot script records),
* the **ink** inside it -- saturated ("coloured") pixels plus dark neutral
  ones, after a small inset that drops the frame lines themselves,
* a **hue-cluster count** (how many distinctly coloured series are drawn;
  black curves are not counted -- Origin's first default colour is black),
* the ink **bounding box** normalised to the plot area, and
* a **coarse occupancy grid** (``GRID`` cells) of the ink, compared between
  the two images by dilated Jaccard overlap. Same axis ranges + same curves
  give similar grids regardless of resolution; phantom, missing, flattened or
  wrongly scaled curves do not.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

GRID = (24, 32)  # rows, cols of the occupancy grid
HUE_BINS = 24

Box = tuple[int, int, int, int]  # x0, y0, x1, y1 (exclusive)
FBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class InkSignals:
    plot_box: Box
    ink_fraction: float
    hue_clusters: int
    hues: list[int]
    ink_bbox: FBox | None  # normalised to the plot area, or None when empty
    grid: list[list[int]]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _hsv(rgb: NDArray[np.float64]) -> tuple[NDArray[np.float64], ...]:
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    delta = mx - mn
    sat = np.where(mx > 0, delta / np.maximum(mx, 1e-9), 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    safe = np.maximum(delta, 1e-9)
    hue = np.where(
        mx == r,
        ((g - b) / safe) % 6,
        np.where(mx == g, (b - r) / safe + 2, (r - g) / safe + 4),
    )
    return np.asarray(hue * 60.0, dtype=float), sat, mx


def ink_masks(rgb: NDArray[np.uint8]) -> tuple[NDArray[np.bool_], NDArray[np.bool_]]:
    """(coloured, dark-neutral) masks of an ``H x W x 3`` uint8 image."""
    f = rgb.astype(float) / 255.0
    _hue, sat, val = _hsv(f)
    coloured = (sat >= 0.35) & (val >= 0.25)
    # Neutral ink is anything clearly darker than a white/near-white page:
    # a thin anti-aliased black line (Origin's 0.5 pt default) lands at
    # ~130-180 grey on our canvas, so a "black only" cut would miss it.
    dark = (~coloured) & (val < 0.78)
    return coloured, dark


def find_frame(rgb: NDArray[np.uint8]) -> Box:
    """The axis frame of an Origin preview: the outermost rows/columns whose
    dark pixels span a large share of the image. Falls back to the image less
    a 10 % margin when no frame-like line exists."""
    h, w = rgb.shape[:2]
    _coloured, dark = ink_masks(rgb)
    cols = np.flatnonzero(dark.sum(axis=0) >= 0.35 * h)
    rows = np.flatnonzero(dark.sum(axis=1) >= 0.35 * w)
    x0, x1 = (int(cols[0]), int(cols[-1]) + 1) if cols.size else (w // 10, w - w // 10)
    y0, y1 = (int(rows[0]), int(rows[-1]) + 1) if rows.size else (h // 10, h - h // 10)
    if x1 - x0 < 0.2 * w:  # only a left axis: run to the right margin
        x1 = w - w // 20
    if y1 - y0 < 0.2 * h:  # only a bottom axis: run to the top margin
        y0 = h // 20
    return x0, y0, x1, y1


def union_box(rects: list[dict[str, float]], w: int, h: int) -> Box | None:
    if not rects:
        return None
    x0 = max(0, int(min(r["x"] for r in rects)))
    y0 = max(0, int(min(r["y"] for r in rects)))
    x1 = min(w, int(max(r["x"] + r["w"] for r in rects)))
    y1 = min(h, int(max(r["y"] + r["h"] for r in rects)))
    return (x0, y0, x1, y1) if x1 > x0 and y1 > y0 else None


def _hue_clusters(hues: NDArray[np.float64]) -> list[int]:
    if hues.size == 0:
        return []
    hist, _ = np.histogram(hues, bins=HUE_BINS, range=(0.0, 360.0))
    keep = hist >= max(4, int(0.04 * hues.size))
    centres: list[int] = []
    i = 0
    while i < HUE_BINS:  # merge runs of adjacent kept bins (circular at 0/360)
        if not keep[i]:
            i += 1
            continue
        j = i
        while j + 1 < HUE_BINS and keep[j + 1]:
            j += 1
        centres.append(int((i + j + 1) * 360 / HUE_BINS / 2))
        i = j + 1
    if len(centres) > 1 and keep[0] and keep[-1]:
        centres.pop()
    return centres


def ink_signals(rgb: NDArray[np.uint8], plot_box: Box) -> InkSignals:
    x0, y0, x1, y1 = plot_box
    inset = max(2, round(0.012 * max(x1 - x0, y1 - y0)))
    sub = rgb[y0 + inset : y1 - inset, x0 + inset : x1 - inset]
    if sub.size == 0:
        return InkSignals(plot_box, 0.0, 0, [], None, [[0] * GRID[1] for _ in range(GRID[0])])
    coloured, dark = ink_masks(sub)
    ink = coloured | dark
    hue, _sat, val = _hsv(sub.astype(float) / 255.0)
    # Sub-pixel (ClearType-style) anti-aliasing in Origin's own exports puts
    # orange/blue fringes on every black stroke and glyph; a coloured pixel
    # touching near-black neutral ink is such a fringe, not a series.
    fringe = _dilate(dark & (val < 0.35))
    hues = _hue_clusters(hue[coloured & ~fringe])
    hh, ww = ink.shape
    ys, xs = np.nonzero(ink)
    bbox: FBox | None = None
    if ys.size:
        bbox = (
            round(xs.min() / ww, 3),
            round(ys.min() / hh, 3),
            round((xs.max() + 1) / ww, 3),
            round((ys.max() + 1) / hh, 3),
        )
    grid = np.zeros(GRID, dtype=int)
    if ys.size:
        gy = np.minimum(ys * GRID[0] // hh, GRID[0] - 1)
        gx = np.minimum(xs * GRID[1] // ww, GRID[1] - 1)
        np.add.at(grid, (gy, gx), 1)
    # A cell counts only with real ink, relative to its pixel area, so a
    # single anti-aliased stray pixel in a big screenshot cell does not.
    cell_px = (hh / GRID[0]) * (ww / GRID[1])
    occ = (grid >= max(1.0, 0.02 * cell_px)).astype(int)
    return InkSignals(
        plot_box,
        round(float(ink.mean()), 5),
        len(hues),
        hues,
        bbox,
        occ.tolist(),
    )


def _dilate(a: NDArray[np.bool_]) -> NDArray[np.bool_]:
    out = a.copy()
    out[1:, :] |= a[:-1, :]
    out[:-1, :] |= a[1:, :]
    out[:, 1:] |= a[:, :-1]
    out[:, :-1] |= a[:, 1:]
    return out


def grid_overlap(a: list[list[int]], b: list[list[int]]) -> float | None:
    """Symmetric dilated overlap of two occupancy grids in [0, 1]: the mean of
    the share of each grid's cells that land near the other's ink. None when
    both are empty."""
    ga = np.asarray(a, dtype=bool)
    gb = np.asarray(b, dtype=bool)
    if not ga.any() and not gb.any():
        return None
    if not ga.any() or not gb.any():
        return 0.0
    hit_a = (ga & _dilate(gb)).sum() / ga.sum()
    hit_b = (gb & _dilate(ga)).sum() / gb.sum()
    return round(float((hit_a + hit_b) / 2), 3)


def bbox_iou(a: FBox | None, b: FBox | None) -> float | None:
    if a is None or b is None:
        return None
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return round(inter / union, 3) if union > 0 else None
