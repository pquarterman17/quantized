"""Derivative-based peak finding: an opt-in alternative to the residual finder.

Pure calc layer. ``find_peaks_derivative`` returns the same ``(peaks,
background)`` pair as :func:`quantized.calc.peaks.find_peaks_robust` (the same
peak-dict keys), so the two finders are interchangeable behind one route.

Method (a smoothing window is the one knob that matters, because every
derivative amplifies noise):

1. Smooth with a Savitzky-Golay filter of ``smooth_window`` points (odd,
   >= 5; ``0`` picks ``max(7, n // 40)`` rounded up to odd). The first and
   second derivatives come from the same filter (polynomial order 3 for the
   first, 4 for the second derivative), scaled by the grid spacing, so they
   are in y per x and y per x squared. Unsorted x is sorted; a grid whose
   spacing varies by more than 1 % is linearly resampled onto a uniform grid
   of the same length first (the returned peaks then refer to that grid).
2. ``order=1``: a candidate is every ``+ -> -`` zero crossing of the first
   derivative; its centre is the crossing, linearly interpolated.
   ``order=2``: a candidate is every local minimum of the second derivative
   that is below ``-snr_threshold`` times its robust noise (1.4826 x MAD about
   the median), centre refined by a parabola through the minimum and its two
   neighbours. This finds shoulders that have no first-derivative crossing.
3. Both orders then keep a candidate only when its smoothed height above the
   background reaches ``snr_threshold`` times the noise of ``y``
   (``calc.peak_noise.estimate_noise``), its FWHM and point count pass the
   width limits, and it survives the minimum-separation rule. ``order=1``
   also needs a prominence of at least ``max(min_prominence * tallest, 4
   noise)`` (``order=2`` skips that, since a shoulder is not a local maximum;
   its ``prominence`` field simply reports how small that is).

The background is the one the residual finder uses (``bg_method`` and friends,
SNIP by default), so heights are directly comparable between the finders.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.signal import savgol_filter

from .baseline import estimate_background
from .peak_noise import estimate_noise, noise_floor_offset
from .peak_prominence import compute_prominence
from .peaks import _estimate_fwhm, _matlab_round

__all__ = ["find_peaks_derivative"]

_EPS = float(np.finfo(float).eps)


def _window(smooth_window: int, n: int) -> int:
    if smooth_window == 0:
        w = max(7, n // 40)
        w += (w + 1) % 2
    else:
        w = int(smooth_window)
        if w < 5 or w % 2 == 0:
            raise ValueError(
                "smooth_window must be an odd number of points >= 5 (or 0 for automatic)"
            )
    if w > n:
        w = n if n % 2 == 1 else n - 1
    if w < 5:
        raise ValueError("too few points for the derivative finder (need at least 5)")
    return w


def _grid(x: ArrayLike, y: ArrayLike) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    if not (np.isfinite(xv).all() and np.isfinite(yv).all()):
        raise ValueError("the derivative finder needs finite x and y (drop gap rows first)")
    srt = np.argsort(xv, kind="stable")
    xv, yv = xv[srt], yv[srt]
    if xv.size < 5:
        return xv, yv
    d = np.diff(xv)
    if float(d.sum()) <= 0.0:
        raise ValueError("x has no extent")
    med = float(np.median(d))
    if med <= 0.0 or float(np.max(np.abs(d - med))) > 0.01 * med:
        xu = np.linspace(xv[0], xv[-1], xv.size)
        return xu, np.asarray(np.interp(xu, xv, yv), dtype=float)
    return xv, yv


def find_peaks_derivative(
    x: ArrayLike,
    y: ArrayLike,
    *,
    order: int = 1,
    smooth_window: int = 0,
    snr_threshold: float = 5.0,
    min_separation: float = 0.0,
    max_peaks: int = 50,
    max_window_deg: float = 2.0,
    min_width_deg: float = 0.01,
    max_width_deg: float = 10.0,
    min_prominence: float = 0.02,
    sensitivity: str = "medium",
    bg_method: str = "snip",
    bg_poly_degree: int = 4,
    bg_iterative: bool = False,
) -> tuple[list[dict[str, Any]], NDArray[np.float64]]:
    """Find peaks from first-derivative zero crossings (``order=1``) or
    second-derivative minima (``order=2``); see the module docstring."""
    if order not in (1, 2):
        raise ValueError("order must be 1 (zero crossings) or 2 (second-derivative minima)")
    xv, yv = _grid(x, y)
    n = yv.size
    if n < 5:
        return [], yv.copy()
    w = _window(smooth_window, n)
    x_span = float(xv[-1] - xv[0])
    dx = x_span / (n - 1)

    if sensitivity == "high":
        snr_thr, min_prom = min(snr_threshold, 3.0), min(min_prominence, 0.005)
    elif sensitivity == "low":
        snr_thr, min_prom = max(snr_threshold, 8.0), max(min_prominence, 0.05)
    else:
        snr_thr, min_prom = snr_threshold, min_prominence

    bg = estimate_background(
        xv, yv, method=bg_method, max_window_deg=max(max_window_deg, x_span * 0.05),
        poly_degree=bg_poly_degree, iterative=bg_iterative,
    )
    noise = estimate_noise(yv)
    if noise > float(np.max(yv)) * 1e-6:
        bg = bg + noise_floor_offset(yv - bg, noise)
    poly = 3 if order == 1 else min(4, w - 1)
    smooth = np.asarray(savgol_filter(yv, w, poly, mode="interp"), dtype=float)
    res = smooth - bg

    if order == 1:
        d1 = np.asarray(savgol_filter(yv, w, poly, deriv=1, delta=dx, mode="interp"), dtype=float)
        cross = np.flatnonzero((d1[:-1] > 0.0) & (d1[1:] <= 0.0))
        frac = d1[cross] / (d1[cross] - d1[cross + 1])
        centres = np.asarray(xv[cross] + frac * dx, dtype=float)
        idx = np.where(frac < 0.5, cross, cross + 1).astype(np.intp)
    else:
        d2 = np.asarray(savgol_filter(yv, w, poly, deriv=2, delta=dx, mode="interp"), dtype=float)
        sigma = 1.4826 * float(np.median(np.abs(d2 - np.median(d2))))
        thr = snr_thr * max(sigma, _EPS)
        mid = np.arange(1, n - 1)
        mins = mid[(d2[1:-1] <= d2[:-2]) & (d2[1:-1] < d2[2:]) & (d2[1:-1] <= -thr)]
        a, b, c = d2[mins - 1], d2[mins], d2[mins + 1]
        den = a - 2.0 * b + c
        off = np.where(np.abs(den) > _EPS, 0.5 * (a - c) / np.where(den == 0, 1.0, den), 0.0)
        idx = mins.astype(np.intp)
        centres = np.asarray(xv[idx] + np.clip(off, -1.0, 1.0) * dx, dtype=float)
    if idx.size == 0:
        return [], bg

    prom = compute_prominence(res, idx)
    heights = res[idx]
    keep = heights >= snr_thr * noise
    if order == 1:
        keep &= prom >= max(min_prom * float(res.max()), 4.0 * noise)
    idx, centres, heights, prom = idx[keep], centres[keep], heights[keep], prom[keep]
    if idx.size == 0:
        return [], bg

    min_width_pts = max(4, _matlab_round(min_width_deg / max(dx, _EPS)))
    fwhm = np.zeros(idx.size)
    ok = np.ones(idx.size, dtype=bool)
    for k in range(idx.size):
        fw, n_above = _estimate_fwhm(xv, res, int(idx[k]), n)
        fwhm[k] = fw
        ok[k] = min_width_deg <= fw <= max_width_deg and n_above >= min_width_pts
    idx, centres, heights, prom, fwhm = idx[ok], centres[ok], heights[ok], prom[ok], fwhm[ok]
    if idx.size == 0:
        return [], bg

    min_sep = min_separation if min_separation > 0 else x_span * 0.005
    by_height = np.argsort(-heights, kind="stable")
    alive = np.ones(idx.size, dtype=bool)
    for ii, a_ in enumerate(by_height):
        if not alive[a_]:
            continue
        for b_ in by_height[ii + 1:]:
            if alive[b_] and abs(centres[a_] - centres[b_]) < min_sep:
                alive[b_] = False
    kept = [int(k) for k in by_height if alive[k]][:max_peaks]
    kept.sort(key=lambda k: float(centres[k]))

    nan = float("nan")
    peaks = [
        {
            "center": float(centres[k]),
            "fwhm": float(fwhm[k]),
            "height": float(heights[k]),
            "area": nan,
            "xRange": [],
            "status": "auto",
            "bg": float(bg[idx[k]]),
            "model": "",
            "eta": nan,
            "prominence": float(prom[k]),
            "localSNR": float(heights[k] / max(noise, _EPS)),
        }
        for k in kept
    ]
    return peaks, bg
