"""2-D cross-correlation of two maps (Origin's ``corr2``).

Both maps must be regular grids with the same cell size in X and in Y (the
spacing of each axis uniform within 1e-6 of a cell). Each map has its own mean
removed (blank cells count as the mean, i.e. contribute nothing, when
``on_nan = "zero"``), the full cross-correlation is taken with an FFT, and it is
divided by the product of the two maps' norms. The result lies in [-1, 1]
(Cauchy-Schwarz) and equals 1 only for identical maps at zero offset. Because
the norms are those of the whole maps, a shift that pushes part of a feature
out of the overlap lowers the value, as in the usual global normalised
cross-correlation.

Offset convention: the output axes are the offset ``(dx, dy)`` in axis units to
ADD to map B's coordinates to land its features on map A's. A Gaussian at
``x0`` in B and at ``x0 + s`` in A peaks at ``dx = +s``. The peak is refined to
sub-cell precision by a parabola through the peak and its two neighbours on each
axis (``subpixel``), and left on the cell when it sits on the edge.

Fail closed: mismatched cell sizes, a constant map (zero norm), blanks without
``on_nan = "zero"``, or an output beyond the map-size limit are refused.

Pure layer: ``MapGrid`` in, ``MapGrid`` + dataclass out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.signal import fftconvolve

from quantized.calc.map_ops import MapGrid

__all__ = ["CorrelationPeak", "correlate_maps"]

_Arr = NDArray[np.float64]
_MAX_CELLS = 4_000_000


@dataclass(frozen=True)
class CorrelationPeak:
    value: float
    offset_x: float
    offset_y: float
    lag_x: int
    lag_y: int
    subpixel: bool
    blank_cells: int


def _step(axis: _Arr, name: str) -> float:
    d = np.diff(axis)
    step = float(np.median(d))
    if step <= 0 or np.any(np.abs(d - step) > 1e-6 * abs(step)):
        raise ValueError(f"the {name} axis is not evenly spaced, so it cannot be correlated")
    return step


def _refine(corr: _Arr, j: int, i: int) -> tuple[float, float]:
    """Sub-cell (dy, dx) of the maximum at row ``j``, column ``i``."""
    out = []
    for centre, line in ((j, corr[:, i]), (i, corr[j, :])):
        if centre <= 0 or centre >= line.size - 1:
            out.append(0.0)
            continue
        a, b, c = line[centre - 1], line[centre], line[centre + 1]
        den = a - 2 * b + c
        out.append(float(0.5 * (a - c) / den) if den < 0 else 0.0)
    return out[0], out[1]


def correlate_maps(
    a: MapGrid,
    b: MapGrid,
    *,
    on_nan: Literal["error", "zero"] = "error",
    subpixel: bool = True,
) -> tuple[MapGrid, CorrelationPeak]:
    """Normalised cross-correlation of ``a`` and ``b`` and its peak."""
    dxa, dya = _step(a.x, "X"), _step(a.y, "Y")
    dxb, dyb = _step(b.x, "X"), _step(b.y, "Y")
    if abs(dxa - dxb) > 1e-6 * abs(dxa) or abs(dya - dyb) > 1e-6 * abs(dya):
        raise ValueError(
            f"the maps have different cell sizes ({dxa:g} x {dya:g} against {dxb:g} x {dyb:g}); "
            "regrid one onto the other first"
        )
    ny = a.z.shape[0] + b.z.shape[0] - 1
    nx = a.z.shape[1] + b.z.shape[1] - 1
    if ny * nx > _MAX_CELLS:
        raise ValueError(
            f"the correlation would have {ny * nx:,} cells; the limit is {_MAX_CELLS:,}"
        )
    blanks = int(np.count_nonzero(~np.isfinite(a.z)) + np.count_nonzero(~np.isfinite(b.z)))
    if blanks and on_nan != "zero":
        raise ValueError(f"{blanks} blank cell(s); fill them or choose to treat them as the mean")
    za = _centred(a.z)
    zb = _centred(b.z)
    na, nb = float(np.linalg.norm(za)), float(np.linalg.norm(zb))
    if na == 0 or nb == 0:
        raise ValueError("a map is constant, so it has no pattern to correlate")
    corr = np.asarray(fftconvolve(za, zb[::-1, ::-1], mode="full"), dtype=float) / (na * nb)
    j, i = (int(v) for v in np.unravel_index(int(np.argmax(corr)), corr.shape))
    fy = fx = 0.0
    if subpixel:
        fy, fx = _refine(corr, j, i)
    lag_y, lag_x = j - (b.z.shape[0] - 1), i - (b.z.shape[1] - 1)
    ox0 = float(a.x[0] - b.x[0]) + (lag_x + fx) * dxa
    oy0 = float(a.y[0] - b.y[0]) + (lag_y + fy) * dya
    xs = float(a.x[0] - b.x[0]) + (np.arange(nx) - (b.z.shape[1] - 1)) * dxa
    ys = float(a.y[0] - b.y[0]) + (np.arange(ny) - (b.z.shape[0] - 1)) * dya
    out = MapGrid(
        x=xs,
        y=ys,
        z=corr,
        x_label=f"{a.x_label} offset",
        x_unit=a.x_unit,
        y_label=f"{a.y_label} offset",
        y_unit=a.y_unit,
        z_unit="",
        metadata={k: v for k, v in a.metadata.items() if k in ("source",)},
    )
    peak = CorrelationPeak(float(corr[j, i]), ox0, oy0, lag_x, lag_y, subpixel, blanks)
    return out, peak


def _centred(z: _Arr) -> _Arr:
    ok = np.isfinite(z)
    mean = float(z[ok].mean()) if ok.any() else 0.0
    return np.where(ok, z - mean, 0.0)
