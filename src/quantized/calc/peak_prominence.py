"""Topographic prominence of candidate maxima, for ``calc.peaks``.

Pure calc layer, split out of ``calc.peaks`` (unchanged code) so the peak
detector and its noise filter (``calc.peak_noise``) share one implementation:
an O(n log n) monotonic-stack + sparse-table path, and the O(M·walk) brute
force kept as its parity reference and non-finite fallback.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

__all__ = ["compute_prominence", "prominence_bruteforce"]


def prominence_bruteforce(
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


def compute_prominence(
    residual: NDArray[np.float64], max_idx: NDArray[np.intp]
) -> NDArray[np.float64]:
    """Topographic prominence for each candidate maximum.

    For a peak at ``idx`` the prominence is ``residual[idx] - max(left_min,
    right_min)`` where each side-min is taken over the run from the nearest
    strictly-greater sample up to the peak. Computing the nearest-greater indices
    (monotonic stacks) and the run-minima (sparse table) is O(n log n) instead of
    the O(n²) per-candidate walk that bites on large, noisy data with many local
    maxima. Bit-for-bit identical to :func:`prominence_bruteforce` on finite
    data (verified); non-finite residuals fall back to the brute force."""
    if not bool(np.isfinite(residual).all()):
        return prominence_bruteforce(residual, max_idx)
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
