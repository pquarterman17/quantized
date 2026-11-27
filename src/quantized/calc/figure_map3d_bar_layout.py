"""Where each 3-D bar stands: absolute widths and grouped (side by side) bars.

Two opt-in layouts for ``bars3d`` (``calc.figure_map3d_ext``); with neither asked
for the bars are laid out exactly as before. The interactive view
(``frontend/src/components/Stage/Map3D/barLayout3d.ts``) mirrors every rule here,
pinned by ``tests/fixtures/wire/plot3d_kinds.json``.

* ``bar_abs`` -- ``bar_abs_w`` / ``bar_abs_d`` are the bar's width (along x) and
  depth (along y) in DATA units, instead of fractions of the position spacing.
  A value that is not a number above 0 is refused. A bar wider than the spacing
  (the median step between distinct positions) would overlap its neighbour: it is
  clamped to the spacing and the footnote says so.
* ``bar_grouped`` -- with a categorical bar colour (``bar_group``), the bars that
  share a position stand SIDE BY SIDE along x, one slot per category that has a
  bar, in category order, each ``1/slots`` of the footprint wide. Two rows with
  the same position and category would draw on top of each other: refused.

Pure; every refusal is a ``ValueError``.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_map3d_ext import _median_step as median_step

__all__ = ["apply_bar_layout", "bar_layout_requested"]

CLAMP_NOTES = {
    (True, False): "Bar width clamped to the position spacing so bars do not overlap.",
    (False, True): "Bar depth clamped to the position spacing so bars do not overlap.",
    (True, True): "Bar width and depth clamped to the position spacing so bars do not overlap.",
}


def bar_layout_requested(opts: Mapping[str, Any]) -> bool:
    return bool(opts.get("bar_abs")) or bool(opts.get("bar_grouped"))


def _absolute(
    x: NDArray[np.float64], y: NDArray[np.float64], opts: Mapping[str, Any]
) -> tuple[float, float, str]:
    sizes: list[float] = []
    for key in ("bar_abs_w", "bar_abs_d"):
        v = opts.get(key)
        if v is None or not (math.isfinite(float(v)) and float(v) > 0.0):
            raise ValueError(f"{key} must be a number above 0 (a size in data units)")
        sizes.append(float(v))
    sx, sy = median_step(x), median_step(y)
    cut_w, cut_d = sizes[0] > sx, sizes[1] > sy
    note = CLAMP_NOTES.get((cut_w, cut_d), "")
    return min(sizes[0], sx), min(sizes[1], sy), note


def _grouped(
    x: NDArray[np.float64], y: NDArray[np.float64], codes: NDArray[np.intp], dx: float
) -> tuple[NDArray[np.float64], float]:
    used = np.unique(codes)
    key = np.column_stack([x, y, codes.astype(np.float64)])
    repeats = int(x.size - np.unique(key, axis=0).shape[0])
    if repeats:
        raise ValueError(
            f"grouped bars need one row per position and category; {repeats:,} rows repeat "
            "a position and category (aggregate the rows first, or turn grouping off)"
        )
    slot = np.searchsorted(used, codes)
    count = int(used.size)
    shifted = x + ((slot + 0.5) / count - 0.5) * dx
    return np.asarray(shifted, dtype=np.float64), dx / count


def apply_bar_layout(
    x: NDArray[np.float64], y: NDArray[np.float64], dx: float, dy: float,
    codes: NDArray[np.intp] | None, opts: Mapping[str, Any],
) -> tuple[NDArray[np.float64], float, float, str]:
    """The bars' x anchors, width and depth after the layout options, and a footnote
    (empty when nothing was clamped). ``codes``: each bar's category index, or None."""
    note = ""
    if opts.get("bar_abs"):
        dx, dy, note = _absolute(x, y, opts)
    if opts.get("bar_grouped"):
        if codes is None:
            raise ValueError("grouped bars need a categorical bar colour column: send bar_group")
        x, dx = _grouped(x, y, codes, dx)
    return x, dx, dy, note
