"""SNIP clipping kernel for ``calc.baseline._snip_background``.

The MATLAB algorithm clips ``v`` against the mean of its two neighbours
``w`` samples away, for ``w = w_max .. 1``. ``w_max`` is a fixed fraction of
the sample count (the detector widens the window to 5 % of the x span), so the
loop is O(n * w_max) = O(n^2) *by construction*, and on noisy data nearly every
sample changes at every step, so there is no sparse/early-exit shortcut. What
is wasted is constant factor: the textbook form allocates and copies the whole
array and three temporaries per step. This kernel does the same arithmetic on
the same operands in the same order, only without the allocations:

* double-buffered output (no per-step ``copy``),
* ``(L + R) * 0.5`` instead of ``/ 2.0`` -- the same correctly-rounded value
  (a power-of-two scale is exact, including for inf and NaN), and
* the temporary lives in a cache-sized chunk instead of a full-array pass.

Every element is produced by ``min(v[i], fl(fl(v[i-w] + v[i+w]) / 2))``,
exactly as before, so the result is bit-identical (NaN/inf included, since the
same ``np.minimum`` propagation applies).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from quantized.calc._snip_numba import get_kernel, peek_kernel

__all__ = ["snip_clip", "snip_clip_numpy", "snip_clip_reference"]

# Elements per temporary: 512 KiB, comfortably inside L2.
_CHUNK = 65_536

# Dispatch thresholds, in element-steps (``n * w_max``; numpy does ~1e9/s).
# The compiled kernel costs a one-off ~0.5 s (numba import + cached-code load)
# and up to ~1.5 s with a cold on-disk cache, so a process that has not loaded
# it yet only pays that above ``_COMPILED_MIN_WORK`` (numpy >= ~0.2 s); once it
# is loaded, the much lower ``_WARM_MIN_WORK`` is enough (loading is free and
# the kernel is ~3x faster). Below both, numba is never touched.
_COMPILED_MIN_WORK = 200_000_000
_WARM_MIN_WORK = 20_000_000


def snip_clip_reference(v: NDArray[np.float64], w_max: int) -> NDArray[np.float64]:
    """The original scalar-style implementation (kept as the parity oracle)."""
    n = v.size
    for w in range(w_max, 0, -1):
        v_new = v.copy()
        avg = (v[: n - 2 * w] + v[2 * w :]) / 2.0
        v_new[w : n - w] = np.minimum(v[w : n - w], avg)
        v = v_new
    return v


def snip_clip(v: NDArray[np.float64], w_max: int) -> NDArray[np.float64]:
    """Clip ``v`` for ``w = w_max .. 1``; bit-identical to the reference.

    Large problems run the compiled kernel (``_snip_numba``) when numba is
    available; everything else, and any platform without it, runs
    :func:`snip_clip_numpy`. ``v`` is not modified."""
    work = v.size * w_max
    if w_max >= 1 and work >= _WARM_MIN_WORK:
        kernel = get_kernel() if work >= _COMPILED_MIN_WORK else peek_kernel()
        if kernel is not None:
            a = np.array(v, dtype=np.float64)
            return kernel(a, np.empty_like(a), w_max)
    return snip_clip_numpy(v, w_max)


def snip_clip_numpy(v: NDArray[np.float64], w_max: int) -> NDArray[np.float64]:
    """The numpy implementation of :func:`snip_clip` (also its fallback).

    ``w_max`` must satisfy ``2 * w_max < v.size`` (the caller clamps it).
    ``v`` is not modified."""
    n = v.size
    if w_max < 1:
        return v.copy()
    a = np.array(v, dtype=np.float64)
    b = np.empty_like(a)
    tmp = np.empty(min(_CHUNK, n), dtype=np.float64)
    for w in range(w_max, 0, -1):
        for s in range(w, n - w, _CHUNK):
            e = min(s + _CHUNK, n - w)
            t = tmp[: e - s]
            np.add(a[s - w : e - w], a[s + w : e + w], out=t)
            np.multiply(t, 0.5, out=t)
            np.minimum(a[s:e], t, out=b[s:e])
        b[:w] = a[:w]
        b[n - w :] = a[n - w :]
        a, b = b, a
    return a
