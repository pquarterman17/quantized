"""Robust peak detection. Port of utilities.findPeaksRobust.

Pure calc layer (no Signal Toolbox equivalent — hand-rolled to match MATLAB).
Detects local maxima on a background-subtracted residual, then filters by
prominence, background slope, width (FWHM + points above half-max), local SNR,
and a greedy minimum-separation rule. Returns ``(peaks, background)`` where
``peaks`` is a list of dicts (one per peak).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .baseline import estimate_background
from .processing import _matlab_gradient

__all__ = ["find_peaks_robust"]

_EPS = float(np.finfo(float).eps)


def _matlab_round(x: float) -> int:
    return int(math.copysign(math.floor(abs(x) + 0.5), x))


def _estimate_noise(y: NDArray[np.float64]) -> float:
    """Robust noise estimate from first differences (MAD/sqrt(2)), floored."""
    diffs = np.diff(y)
    sigma = 1.4826 * float(np.median(np.abs(diffs - np.median(diffs)))) / math.sqrt(2.0)
    return max(sigma, float(np.max(y)) * 1e-6)


def _prominence_bruteforce(
    residual: NDArray[np.float64], max_idx: NDArray[np.intp]
) -> NDArray[np.float64]:
    """Reference O(M·walk) prominence: walk out each side until a higher sample.

    Kept as the parity reference and the fallback for non-finite residuals
    (NaN/Inf comparison semantics differ from the fast path)."""
    n = residual.size
    prom = np.zeros(max_idx.size)
    for k in range(max_idx.size):
        idx = int(max_idx[k])
        pk_height = residual[idx]
        left_min = pk_height
        for j in range(idx - 1, -1, -1):
            if residual[j] < left_min:
                left_min = residual[j]
            if residual[j] > pk_height:
                break
        right_min = pk_height
        for j in range(idx + 1, n):
            if residual[j] < right_min:
                right_min = residual[j]
            if residual[j] > pk_height:
                break
        prom[k] = pk_height - max(left_min, right_min)
    return prom


def _nearest_greater(a: NDArray[np.float64], *, forward: bool) -> NDArray[np.intp]:
    """Index of the nearest strictly-greater element to each position.

    ``forward=False`` scans left (previous-greater, sentinel -1); ``forward=True``
    scans right (next-greater, sentinel n). O(n) via a monotonic stack."""
    n = a.size
    res = np.empty(n, dtype=np.intp)
    rng = range(n) if not forward else range(n - 1, -1, -1)
    sentinel = -1 if not forward else n
    stack: list[int] = []
    for i in rng:
        ai = a[i]
        while stack and a[stack[-1]] <= ai:
            stack.pop()
        res[i] = stack[-1] if stack else sentinel
        stack.append(i)
    return res


class _RangeMin:
    """Sparse table for static inclusive range-minimum (O(n log n) build, O(1) query)."""

    def __init__(self, a: NDArray[np.float64]) -> None:
        n = a.size
        self.table: list[NDArray[np.float64]] = [np.asarray(a, dtype=float)]
        j = 1
        while (1 << j) <= n:
            prev = self.table[j - 1]
            span = 1 << (j - 1)
            width = n - (1 << j) + 1
            self.table.append(np.minimum(prev[:width], prev[span : span + width]))
            j += 1

    def query(self, lo: int, hi: int) -> float:
        """Minimum over the inclusive range ``[lo, hi]``; ``+inf`` if empty (lo>hi)."""
        if lo > hi:
            return float("inf")
        j = (hi - lo + 1).bit_length() - 1
        return float(min(self.table[j][lo], self.table[j][hi - (1 << j) + 1]))


def _compute_prominence(
    residual: NDArray[np.float64], max_idx: NDArray[np.intp]
) -> NDArray[np.float64]:
    """Topographic prominence for each candidate maximum.

    For a peak at ``idx`` the prominence is ``residual[idx] - max(left_min,
    right_min)`` where each side-min is taken over the run from the nearest
    strictly-greater sample up to the peak. Computing the nearest-greater indices
    (monotonic stacks) and the run-minima (sparse table) is O(n log n) instead of
    the O(n²) per-candidate walk that bites on large, noisy data with many local
    maxima. Bit-for-bit identical to :func:`_prominence_bruteforce` on finite
    data (verified); non-finite residuals fall back to the brute force."""
    if not bool(np.isfinite(residual).all()):
        return _prominence_bruteforce(residual, max_idx)
    pge = _nearest_greater(residual, forward=False)
    nge = _nearest_greater(residual, forward=True)
    rmin = _RangeMin(residual)
    prom = np.zeros(max_idx.size)
    for k in range(max_idx.size):
        idx = int(max_idx[k])
        pk = float(residual[idx])
        left_min = min(pk, rmin.query(int(pge[idx]) + 1, idx - 1))
        right_min = min(pk, rmin.query(idx + 1, int(nge[idx]) - 1))
        prom[k] = pk - max(left_min, right_min)
    return prom


def _estimate_fwhm(
    x: NDArray[np.float64], residual: NDArray[np.float64], idx: int, n: int
) -> tuple[float, int]:
    """FWHM via half-max crossings (linearly interpolated) + points above half."""
    half_max = residual[idx] / 2.0

    l_idx = 0
    for j in range(idx - 1, -1, -1):
        if residual[j] <= half_max:
            l_idx = j
            break
    if 0 <= l_idx < idx:
        r1, r2 = residual[l_idx], residual[min(l_idx + 1, n - 1)]
        if abs(r2 - r1) > _EPS:
            frac = (half_max - r1) / (r2 - r1)
            x_left = x[l_idx] + frac * (x[min(l_idx + 1, n - 1)] - x[l_idx])
        else:
            x_left = x[l_idx]
    else:
        x_left = x[max(0, idx - 1)]

    r_idx = n - 1
    for j in range(idx + 1, n):
        if residual[j] <= half_max:
            r_idx = j
            break
    if idx < r_idx <= n - 1:
        r1, r2 = residual[r_idx], residual[max(r_idx - 1, 0)]
        if abs(r2 - r1) > _EPS:
            frac = (half_max - r1) / (r2 - r1)
            x_right = x[r_idx] + frac * (x[max(r_idx - 1, 0)] - x[r_idx])
        else:
            x_right = x[r_idx]
    else:
        x_right = x[min(n - 1, idx + 1)]

    fw = abs(x_right - x_left)
    if fw <= 0:
        fw = abs(x[min(n - 1, idx + 1)] - x[max(0, idx - 1)])
    n_above = int(np.sum(residual[max(0, l_idx) : min(n, r_idx + 1)] >= half_max))
    return fw, n_above


def find_peaks_robust(
    x: ArrayLike,
    y: ArrayLike,
    *,
    snr_threshold: float = 5.0,
    min_separation: float = 0.0,
    max_peaks: int = 50,
    max_window_deg: float = 2.0,
    min_width_deg: float = 0.01,
    max_width_deg: float = 10.0,
    min_prominence: float = 0.02,
    sensitivity: str = "medium",
) -> tuple[list[dict[str, Any]], NDArray[np.float64]]:
    """Detect peaks robustly. Port of utilities.findPeaksRobust.

    Returns ``(peaks, background)``. Each peak dict carries center/fwhm/height/
    area/xRange/status/bg/model/eta/prominence/localSNR (area/eta are NaN and
    xRange empty — filled later by an explicit fit). ``sensitivity`` (low/medium/
    high) tightens or loosens the SNR and prominence thresholds.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    n = yv.size
    if n < 5:
        return [], yv.copy()

    if sensitivity == "high":
        snr_thr, min_prom = min(snr_threshold, 3.0), min(min_prominence, 0.005)
    elif sensitivity == "low":
        snr_thr, min_prom = max(snr_threshold, 8.0), max(min_prominence, 0.05)
    else:
        snr_thr, min_prom = snr_threshold, min_prominence

    x_span = float(xv.max() - xv.min())
    bg = estimate_background(xv, yv, max_window_deg=max(max_window_deg, x_span * 0.05))
    residual = yv - bg
    global_noise = _estimate_noise(yv)
    local_noise = global_noise * np.ones(n)

    is_max = np.zeros(n, dtype=bool)
    is_max[1:-1] = (residual[1:-1] >= residual[:-2]) & (residual[1:-1] > residual[2:])
    is_max &= residual >= snr_thr * local_noise
    max_idx = np.flatnonzero(is_max)
    if max_idx.size == 0:
        return [], bg

    prom = _compute_prominence(residual, max_idx)
    abs_prom_thresh = max(min_prom * float(residual.max()), 4 * global_noise)
    rel_prom_ratio = prom / np.maximum(residual[max_idx], _EPS)
    keep = (prom >= abs_prom_thresh) | ((rel_prom_ratio >= 0.15) & (prom >= 4 * global_noise))
    max_idx, prom = max_idx[keep], prom[keep]
    if max_idx.size == 0:
        return [], bg

    bg_grad = np.abs(_matlab_gradient(bg, xv))
    nbr_span = np.abs(xv[np.minimum(n - 1, max_idx + 1)] - xv[np.maximum(0, max_idx - 1)])
    slope_span = bg_grad[max_idx] * nbr_span
    keep_slope = slope_span <= residual[max_idx] * 0.3
    max_idx, prom = max_idx[keep_slope], prom[keep_slope]
    if max_idx.size == 0:
        return [], bg

    dx = float(np.median(np.diff(xv)))
    min_width_pts = max(4, _matlab_round(min_width_deg / max(dx, _EPS)))
    pk_fwhm = np.zeros(max_idx.size)
    valid = np.ones(max_idx.size, dtype=bool)
    for k in range(max_idx.size):
        fw, n_above = _estimate_fwhm(xv, residual, int(max_idx[k]), n)
        pk_fwhm[k] = fw
        if fw < min_width_deg or fw > max_width_deg or n_above < min_width_pts:
            valid[k] = False
    max_idx, prom, pk_fwhm = max_idx[valid], prom[valid], pk_fwhm[valid]
    if max_idx.size == 0:
        return [], bg

    pk_x = xv[max_idx]
    pk_h = residual[max_idx]
    pk_bg = bg[max_idx]
    pk_snr = pk_h / np.maximum(local_noise[max_idx], _EPS)
    min_sep = min_separation if min_separation > 0 else x_span * 0.005

    # Greedy minimum-separation suppression, strongest peak first.
    order = np.argsort(-pk_h, kind="stable")
    cx, ch, cbg, cfw, cprom, csnr = (
        pk_x[order], pk_h[order], pk_bg[order], pk_fwhm[order], prom[order], pk_snr[order],
    )
    keep2 = np.ones(cx.size, dtype=bool)
    for ii in range(cx.size):
        if not keep2[ii]:
            continue
        for jj in range(ii + 1, cx.size):
            if keep2[jj] and abs(cx[ii] - cx[jj]) < min_sep:
                keep2[jj] = False
    cx, ch, cbg, cfw, cprom, csnr = (
        cx[keep2], ch[keep2], cbg[keep2], cfw[keep2], cprom[keep2], csnr[keep2],
    )
    if cx.size > max_peaks:
        sl = slice(0, max_peaks)
        cx, ch, cbg, cfw, cprom, csnr = cx[sl], ch[sl], cbg[sl], cfw[sl], cprom[sl], csnr[sl]

    reorder = np.argsort(cx, kind="stable")
    cx, ch, cbg, cfw, cprom, csnr = (
        cx[reorder], ch[reorder], cbg[reorder], cfw[reorder], cprom[reorder], csnr[reorder],
    )

    nan = float("nan")
    peaks = [
        {
            "center": float(cx[k]),
            "fwhm": float(cf),
            "height": float(ch[k]),
            "area": nan,
            "xRange": [],
            "status": "auto",
            "bg": float(cbg[k]),
            "model": "",
            "eta": nan,
            "prominence": float(cprom[k]),
            "localSNR": float(csnr[k]),
        }
        for k, cf in enumerate(cfw)
    ]
    return peaks, bg
