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


_LAGS = (1, 2, 4, 8, 16, 32)


def _lag_sigma(y: NDArray[np.float64], lag: int) -> float:
    """sigma from the MAD of the lag-``lag`` second difference
    ``y[i+lag] - 2 y[i] + y[i-lag]`` (variance ``6 sigma^2`` when the three
    samples are uncorrelated)."""
    d2 = y[2 * lag :] - 2 * y[lag:-lag] + y[: -2 * lag]
    return 1.4826 * float(np.median(np.abs(d2 - np.median(d2)))) / math.sqrt(6.0)


def estimate_noise(y: NDArray[np.float64]) -> float:
    """Robust noise sigma: MAD of second differences / sqrt(6), over several
    lags, floored.

    A second difference is a high-pass filter that cancels any locally linear
    trend (a sloping background, the flanks of a broad peak); the MAD ignores
    the few samples a sharp peak still disturbs. At lag 1 this assumes WHITE
    noise: neighbouring samples of correlated noise (a detector's point
    spread, a smoothed or oversampled scan) nearly cancel, so the lag-1
    estimate read 0.63 for sigma = 3.3 with a 21-point correlation and every
    slow wiggle became a "peak" (review item 8). The same difference at a lag
    beyond the correlation length sees independent samples again: the
    estimate climbs with the lag (by >= 1.2x per doubling) until the lag
    passes the correlation length, then levels off. So the lag is doubled
    (1, 2, ... 32, capped at n/16 so each lag keeps plenty of samples) for
    as long as the estimate keeps RISING by more than 10 %, and stops at the
    first lag that does not. White noise stops immediately -- its estimate
    is flat across lags -- which also keeps the longer lags, where peaks
    start to leak into the differences, out of the ordinary case.

    Noise-free data is decided at lag 1 alone: if that is at the
    ``1e-6 * max(y)`` floor there is no noise to measure (longer lags would
    only read the signal's own curvature), and the floor is returned exactly
    as before -- the MATLAB golden case is unchanged.
    """
    floor = noise_floor(y)
    sigma = _lag_sigma(y, 1) if y.size >= 3 else 0.0
    if sigma <= floor:
        return floor
    for lag in _LAGS[1:]:
        if lag > y.size // 16:
            break
        nxt = _lag_sigma(y, lag)
        if nxt <= 1.1 * sigma:
            break
        sigma = nxt
    return sigma


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
    maximum's topographic prominence must reach ``snr_thr`` times the noise
    of the SMOOTHED series. That noise is measured (``estimate_noise`` of the
    smoothed residual), not assumed to be ``sigma / sqrt(w)``: averaging does
    not reduce correlated noise, and the white-noise figure let its slow
    wiggles through. On the audit pattern real peaks score >100 there and
    noise maxima <= 1.1.

    Two candidates that share one smoothed maximum are one peak (the taller
    stands for it). The smoothed maximum may be a PLATEAU: integer counts tie, and the mean
    of ``w`` of them is then flat across two or more samples (a 60-count
    Poisson peak was rejected for it). A plateau is a maximum when the
    series rises into it and falls out of it.
    """
    n = residual.size
    w = max(3, int(min_width_pts) | 1)
    half = w // 2
    padded = np.pad(residual, half, mode="edge")
    smooth = np.convolve(padded, np.ones(w) / w, mode="valid")
    keep = np.zeros(max_idx.size, dtype=bool)
    sigma_s = min(sigma, estimate_noise(smooth)) if sigma > 0 else 0.0
    thresh = snr_thr * max(sigma_s, sigma / math.sqrt(w))
    tie = 1e-12 * max(float(np.max(np.abs(smooth))), 1e-300)
    cand: list[int] = []
    tops: list[int] = []
    for k, idx in enumerate(max_idx):
        lo, hi = max(1, int(idx) - w), min(n - 2, int(idx) + w)
        if hi < lo:
            continue
        j = lo + int(np.argmax(smooth[lo : hi + 1]))
        left = j
        while left > 0 and abs(smooth[left - 1] - smooth[j]) <= tie:
            left -= 1
        right = j
        while right < n - 1 and abs(smooth[right + 1] - smooth[j]) <= tie:
            right += 1
        rises = left > 0 and smooth[left - 1] < smooth[j]
        falls = right < n - 1 and smooth[right + 1] < smooth[j]
        if rises and falls:
            cand.append(k)  # else: a slope once the noise is averaged out
            tops.append(left)
    if cand:
        prom = compute_prominence(smooth, np.asarray(tops, dtype=np.intp))
        # One smoothed maximum is ONE peak: noise can split a peak's top into
        # two raw maxima, and only the taller of them stands for it.
        best: dict[int, int] = {}
        for k, top, pr in zip(cand, tops, prom, strict=True):
            if pr < thresh:
                continue
            rival = best.get(top)
            if rival is None or residual[max_idx[k]] > residual[max_idx[rival]]:
                best[top] = k
        keep[list(best.values())] = True
    return keep
