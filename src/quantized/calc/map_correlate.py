"""2-D cross-correlation of two maps (Origin's ``corr2``).

Both maps must be regular grids with the same cell size in X and in Y (the
spacing of each axis uniform within 1e-6 of a cell).

Two options change what "normalised" means (both default to the original
behaviour):

* ``subtract_means`` (default on). On: each map has its own mean removed first
  (blank cells then contribute nothing, ``on_nan = "zero"``). Off: the maps are
  used as they are, which is what OriginPro's ``corr2`` does (blank cells then
  contribute zero).
* ``normalize`` (default ``"global"``). ``"global"`` takes the full
  cross-correlation with an FFT and divides by the product of the two WHOLE
  maps' norms, so a shift that pushes part of a feature out of the overlap
  lowers the value. The result lies in [-1, 1] (Cauchy-Schwarz) and equals 1
  only for identical maps at zero offset. ``"local"`` normalises each offset
  over the cells that are valid in BOTH maps at that offset (the overlap
  window, with blank cells left out), exactly:

      N   = number of cells valid in both,
      Sa  = sum of A over them, Saa = sum of A^2, likewise Sb, Sbb, and
      Sab = sum of A * B,

  and the value at the offset is ``(Sab - Sa Sb / N) / sqrt((Saa - Sa^2 / N)
  (Sbb - Sb^2 / N))`` (the Pearson correlation over the overlap), or with
  ``subtract_means`` off ``Sab / sqrt(Saa Sbb)``. An offset whose overlap has
  fewer than ``min_overlap`` (a fraction, default 0.25) of the smaller map's
  valid cells is left blank, because a handful of cells correlate at +-1 by
  chance. Blank cells are never an error here: they are the mask.

Offset convention: the output axes are the offset ``(dx, dy)`` in axis units to
ADD to map B's coordinates to land its features on map A's. A Gaussian at
``x0`` in B and at ``x0 + s`` in A peaks at ``dx = +s``. The peak is refined to
sub-cell precision by a parabola through the peak and its two neighbours on each
axis (``subpixel``), and left on the cell when it sits on the edge.

Fail closed: mismatched cell sizes, a constant map (zero norm), blanks without
``on_nan = "zero"`` (global form), no offset with enough overlap (local form),
or an output beyond the map-size limit are refused.

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


def _xcorr(u: _Arr, v: _Arr) -> _Arr:
    """Full cross-correlation: ``out[lag] = sum_p u[p] v[p - lag]``."""
    return np.asarray(fftconvolve(u, v[::-1, ::-1], mode="full"), dtype=float)


def _local_correlation(a: _Arr, b: _Arr, *, subtract_means: bool, min_overlap: float) -> _Arr:
    """Correlation normalised over each offset's overlap of valid cells (see the
    module docstring); offsets with too little overlap or no variance are NaN."""
    ma, mb = np.isfinite(a).astype(float), np.isfinite(b).astype(float)
    a0, b0 = np.where(ma > 0, a, 0.0), np.where(mb > 0, b, 0.0)
    n = np.rint(_xcorr(ma, mb))
    saa, sbb = _xcorr(a0 * a0, mb), _xcorr(ma, b0 * b0)
    sab = _xcorr(a0, b0)
    nmin = max(2.0, np.ceil(min_overlap * min(ma.sum(), mb.sum())))
    ok = n >= nmin
    safe_n = np.where(ok, n, 1.0)
    if subtract_means:
        sa, sb = _xcorr(a0, mb), _xcorr(ma, b0)
        num = sab - sa * sb / safe_n
        va = np.maximum(saa - sa * sa / safe_n, 0.0)
        vb = np.maximum(sbb - sb * sb / safe_n, 0.0)
    else:
        num, va, vb = sab, np.maximum(saa, 0.0), np.maximum(sbb, 0.0)
    ok &= (va > 1e-9 * np.maximum(saa, 1e-300)) & (vb > 1e-9 * np.maximum(sbb, 1e-300))
    with np.errstate(all="ignore"):
        out = np.where(ok, num / np.sqrt(np.where(ok, va * vb, 1.0)), np.nan)
    return np.clip(out, -1.0, 1.0)


def correlate_maps(
    a: MapGrid,
    b: MapGrid,
    *,
    on_nan: Literal["error", "zero"] = "error",
    subpixel: bool = True,
    subtract_means: bool = True,
    normalize: Literal["global", "local"] = "global",
    min_overlap: float = 0.25,
) -> tuple[MapGrid, CorrelationPeak]:
    """Normalised cross-correlation of ``a`` and ``b`` and its peak."""
    if normalize not in ("global", "local"):
        raise ValueError("normalize must be global or local")
    if not 0.0 < min_overlap <= 1.0:
        raise ValueError("min_overlap must be above 0 and at most 1")
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
    if normalize == "local":
        corr = _local_correlation(a.z, b.z, subtract_means=subtract_means, min_overlap=min_overlap)
        if not np.isfinite(corr).any():
            raise ValueError(
                "no offset has enough valid overlap (or a map is constant); "
                "lower the minimum overlap or check the maps"
            )
        peak_at = int(np.nanargmax(corr))
    else:
        if blanks and on_nan != "zero":
            raise ValueError(
                f"{blanks} blank cell(s); fill them or choose to leave them out of the sums"
            )
        za = _centred(a.z, subtract_means)
        zb = _centred(b.z, subtract_means)
        na, nb = float(np.linalg.norm(za)), float(np.linalg.norm(zb))
        if na == 0 or nb == 0:
            raise ValueError("a map is constant, so it has no pattern to correlate")
        corr = _xcorr(za, zb) / (na * nb)
        peak_at = int(np.argmax(corr))
    j, i = (int(v) for v in np.unravel_index(peak_at, corr.shape))
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


def _centred(z: _Arr, subtract_means: bool = True) -> _Arr:
    ok = np.isfinite(z)
    mean = float(z[ok].mean()) if ok.any() and subtract_means else 0.0
    return np.where(ok, z - mean, 0.0)
