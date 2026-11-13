"""Noise handling for ``calc.peaks.find_peaks_robust`` (fitting audit, finding 11).

Pure calc layer. Three pieces, all inert on noise-free data (sigma at its
``1e-6 * max(y)`` floor), so the MATLAB golden peak case is unchanged:

* ``estimate_noise`` -- white-noise sigma from the MAD of second differences;
* ``noise_floor_offset`` -- the centre of the noise band in ``y - background``
  (SNIP follows the bottom of the noise, ~2 sigma low);
* ``matched_filter_keep`` -- a candidate must stand out of the residual after
  a short moving average matched to the minimum peak width.

Together they stop a clean 3-peak pattern with sigma = 5 noise reporting 15
peaks at SNR >= 3 (9 at the default 5) while keeping weak real peaks.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from .peak_prominence import compute_prominence

__all__ = ["estimate_noise", "matched_filter_keep", "noise_floor", "noise_floor_offset"]


def noise_floor(y: NDArray[np.float64]) -> float:
    return float(np.max(y)) * 1e-6


def estimate_noise(y: NDArray[np.float64]) -> float:
    """Robust white-noise sigma: MAD of the SECOND differences / sqrt(6), floored.

    A second difference is a high-pass filter that cancels any locally linear
    trend (a sloping background, the flanks of a broad peak) and leaves
    ``n[i+1] - 2 n[i] + n[i-1]``, whose variance is ``6 sigma^2`` for white
    noise; the MAD ignores the few samples a sharp peak still disturbs. (The
    first-difference MAD/sqrt(2) it replaces kept a curvature- and slope-
    dependent bias.) Floored at ``1e-6 * max(y)`` exactly as before, so
    noise-free data -- the MATLAB golden case -- is unchanged.
    """
    d2 = np.diff(y, 2)
    sigma = 1.4826 * float(np.median(np.abs(d2 - np.median(d2)))) / math.sqrt(6.0)
    return max(sigma, noise_floor(y))


def noise_floor_offset(residual: NDArray[np.float64], sigma: float) -> float:
    """Where the noise sits in ``y - background``: a 3-sigma-clipped median.

    SNIP (and any lower-envelope background) tracks the BOTTOM of the noise,
    so the raw residual of a pure-noise stretch is centred ~2 sigma above 0.
    Measured from 0, an ordinary noise maximum then scores SNR ~5 and has
    enough samples above "half maximum" to pass the width test -- the flood
    of noise peaks (fitting audit, finding 11). The clipped median finds the
    centre of the noise band while excluding the peaks themselves. Noise-free
    data (sigma at its floor) has no band to centre on -- what remains there
    is the background estimate's own model error -- so it returns 0, which
    also keeps the MATLAB golden case bit-identical.
    """
    r = residual[np.isfinite(residual)]
    if r.size == 0:
        return 0.0
    m = float(np.median(r))
    for _ in range(5):
        band = r[np.abs(r - m) <= 3 * sigma]
        if band.size == 0:
            break
        m_new = float(np.median(band))
        if m_new == m:
            break
        m = m_new
    return m


def matched_filter_keep(
    residual: NDArray[np.float64],
    max_idx: NDArray[np.intp],
    sigma: float,
    min_width_pts: int,
    snr_thr: float,
) -> NDArray[np.bool_]:
    """Which candidates survive a matched (moving-average) filter.

    A real peak spans at least ``min_width_pts`` samples, so averaging over
    ``w`` = that width (made odd) keeps most of its height while white noise
    drops to ``sigma / sqrt(w)``. A single-sample noise maximum -- the kind
    that rides a big peak's tail or simply tops the noise band -- averages
    away: it is no longer a local maximum, or barely stands out. Each
    candidate keeps the smoothed maximum within ``w`` samples of it, and that
    maximum's topographic prominence must reach ``snr_thr * sigma / sqrt(w)``.
    On the audit pattern real peaks score >100 there and noise maxima <= 1.1.
    """
    n = residual.size
    w = max(3, int(min_width_pts) | 1)
    half = w // 2
    padded = np.pad(residual, half, mode="edge")
    smooth = np.convolve(padded, np.ones(w) / w, mode="valid")
    keep = np.zeros(max_idx.size, dtype=bool)
    thresh = snr_thr * sigma / math.sqrt(w)
    cand: list[int] = []
    tops: list[int] = []
    for k, idx in enumerate(max_idx):
        lo, hi = max(1, int(idx) - w), min(n - 2, int(idx) + w)
        if hi < lo:
            continue
        j = lo + int(np.argmax(smooth[lo : hi + 1]))
        if smooth[j] >= smooth[j - 1] and smooth[j] > smooth[j + 1]:
            cand.append(k)  # else: a slope once the noise is averaged out
            tops.append(j)
    if cand:
        prom = compute_prominence(smooth, np.asarray(tops, dtype=np.intp))
        keep[np.asarray(cand)] = prom >= thresh
    return keep
