"""OriginPro's discrete-wavelet conventions, reproduced on plain arrays.

Opt-in alongside the PyWavelets modes in ``calc.wavelets``; nothing here changes
a default. Every convention below was MEASURED against OriginPro 2026b's frozen
answers (``../test-data/origin/analysis_oracle/{dwt_single_level, mdwt_levels,
idwt_roundtrip, wtdenoise_variants, wtsmooth_cutoff}``) and is checked to 1e-10
in ``tests/test_wavelets_oracle.py``:

* **Periodic extension (``origin-periodic``).** One analysis level is the
  *circular* convolution of the signal with each analysis filter, keeping the
  odd-indexed samples (``full[1::2]``). It equals PyWavelets' ``periodization``
  of the input rolled by ``dec_len / 2 - 1`` samples, and a multilevel transform
  repeats that at every level, so it is NOT ``pywt.wavedec(mode="periodization")``
  beyond level 1. Synthesis is the exact inverse (perfect reconstruction to
  rounding). Needs a length divisible by ``2**level``.
* **Custom threshold, ``thrd = p`` (``percent``).** HARD threshold
  ``T = p / 100 * max|d|`` over the detail coefficients of every level, one
  global ``T``; kept coefficients are unchanged, the approximation untouched.
* **Smooth cutoff, ``cutoff = p``.** ``floor(p / 100 * M)`` of the ``M`` detail
  coefficients are zeroed, level 1 first and, inside a level, from the LAST index
  backwards.

NOT reproduced: ``thrt = sqtwolog``. Origin's output is hard thresholding with
ONE global ``T`` (every coefficient is kept exactly or zeroed), but the noise
sigma behind ``T = sigma * sqrt(2 ln N)`` is not identified: the frozen cases
only bound ``T`` from below (a sinusoid dominates them), and the MAD of the
finest level (sigma 0.20, T 0.67) is excluded because Origin zeroes a
coefficient of 1.43. See the oracle test for the evidence. No sigma is guessed.

Pure numpy; the PyWavelets module is passed in, so there is no import cycle.
"""

from __future__ import annotations

import math
from types import ModuleType

import numpy as np
from numpy.typing import NDArray

__all__ = [
    "ORIGIN_PERIODIC",
    "check_origin_level",
    "origin_wavedec",
    "origin_waverec",
    "percent_threshold",
    "smooth_cutoff",
]

Vec = NDArray[np.float64]

ORIGIN_PERIODIC = "origin-periodic"


def check_origin_level(pywt: ModuleType, n: int, wavelet: str, level: int) -> None:
    """Refuse a length or level the circular scheme cannot take (never pad or guess)."""
    half = int(pywt.Wavelet(wavelet).dec_len) // 2
    if n % (1 << level):
        raise ValueError(
            f"the Origin periodic transform needs a length divisible by 2**level; "
            f"{n} rows are not divisible by {1 << level}"
        )
    if (1 << level) * half > n:
        raise ValueError(
            f"level {level} is too deep for {n} rows and {wavelet} "
            "(deepest accepted: 2**level * dec_len/2 <= rows)"
        )


def _circ(x: Vec, f: Vec) -> Vec:
    """``sum_k f[k] x[(i - k) mod n]``: circular convolution."""
    out = np.zeros(x.size)
    for k, fk in enumerate(f):
        out += fk * np.roll(x, k)
    return out


def _analyse(x: Vec, lo: Vec, hi: Vec) -> tuple[Vec, Vec]:
    return _circ(x, lo)[1::2], _circ(x, hi)[1::2]


def _synthesise(a: Vec, d: Vec, rec_lo: Vec, rec_hi: Vec) -> Vec:
    n = 2 * a.size
    x = np.zeros(n)
    for c, g in ((a, rec_lo), (d, rec_hi)):
        up = np.zeros(n)
        up[1::2] = c
        x += np.roll(_circ(up, g), -(g.size - 1))
    return x


def origin_wavedec(pywt: ModuleType, y: Vec, wavelet: str, level: int) -> list[Vec]:
    """``[cA_n, cD_n, ..., cD_1]`` with Origin's periodic analysis at every level."""
    w = pywt.Wavelet(wavelet)
    lo, hi = np.asarray(w.dec_lo, dtype=float), np.asarray(w.dec_hi, dtype=float)
    a = np.asarray(y, dtype=float)
    check_origin_level(pywt, a.size, wavelet, level)
    details: list[Vec] = []
    for _ in range(level):
        a, d = _analyse(a, lo, hi)
        details.append(d)
    return [a, *details[::-1]]


def origin_waverec(pywt: ModuleType, coeffs: list[Vec], wavelet: str) -> Vec:
    """Inverse of :func:`origin_wavedec` (perfect reconstruction to rounding)."""
    w = pywt.Wavelet(wavelet)
    rlo, rhi = np.asarray(w.rec_lo, dtype=float), np.asarray(w.rec_hi, dtype=float)
    a = np.asarray(coeffs[0], dtype=float)
    for d in coeffs[1:]:
        a = _synthesise(a, np.asarray(d, dtype=float), rlo, rhi)
    return a


def percent_threshold(coeffs: list[Vec], percent: float) -> tuple[list[Vec], float]:
    """Origin's custom ``thrd``: hard threshold at ``percent`` of the largest detail
    coefficient, one value for every level. Returns ``(coeffs, T)``."""
    if not (math.isfinite(percent) and 0.0 <= percent <= 100.0):
        raise ValueError("the threshold percentage must be 0 to 100")
    biggest = max((float(np.max(np.abs(d))) for d in coeffs[1:] if d.size), default=0.0)
    t = percent / 100.0 * biggest
    out = [coeffs[0]] + [np.where(np.abs(d) > t, d, 0.0) for d in coeffs[1:]]
    return out, t


def smooth_cutoff(coeffs: list[Vec], cutoff: float) -> tuple[list[Vec], int]:
    """Origin's ``wtsmooth`` cutoff: zero ``floor(cutoff / 100 * M)`` detail coefficients,
    finest level first and from the last index backwards. Returns ``(coeffs, zeroed)``."""
    if not (math.isfinite(cutoff) and 0.0 <= cutoff <= 100.0):
        raise ValueError("the cutoff percentage must be 0 to 100")
    details = [np.array(d, dtype=float) for d in coeffs[:0:-1]]  # cD_1 first
    budget = total = int(cutoff / 100.0 * sum(d.size for d in details))
    for d in details:
        m = min(budget, d.size)
        if m:
            d[d.size - m :] = 0.0
        budget -= m
    return [coeffs[0], *details[::-1]], total
