"""Optional compiled (numba) SNIP clip kernel; see ``calc/_snip.py``.

Same arithmetic, operands and order as ``snip_clip_reference``: every output
element is ``min(v[i], fl(fl(v[i-w] + v[i+w]) * 0.5))`` and the clip is
double-buffered per window step. No fastmath (so no reassociation and no FMA
contraction, and IEEE NaN/inf/+-0 behaviour is untouched). The minimum is
spelled out to match ``np.minimum``: NaN in either operand propagates (the
first NaN wins), otherwise a tie of ``+0.0``/``-0.0`` resolves the way THIS
platform's ``np.minimum`` resolves it. That is platform-dependent: x86 SIMD
(``minpd``) returns the second operand, AArch64 (``fmin``) returns ``-0.0``
in either order. :func:`_zero_tie_mode` probes it once at compile time; if
the probe is inconsistent across lengths the kernel is not used at all.

numba is imported lazily (it pulls in llvmlite; ``heavy_imports`` serialises
that first import) and is optional at runtime: :func:`get_kernel` returns
``None`` when it cannot be imported or compiled, and the caller falls back to
the numpy implementation. ``QZ_NO_NUMBA=1`` forces that fallback.
"""

from __future__ import annotations

import math
import os
import threading
from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.heavy_import import heavy_imports

__all__ = ["get_kernel", "peek_kernel", "reset_for_tests"]

Kernel = Callable[[NDArray[np.float64], NDArray[np.float64], int], NDArray[np.float64]]

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {"loaded": False, "kernel": None}


def _snip_loop(a: Any, b: Any, w_max: int) -> Any:
    """Clip ``a`` (scratch ``b``, same shape) for ``w = w_max .. 1``; returns
    whichever buffer holds the result. Both buffers are overwritten.

    The inner loop runs over four equal-length slice views with an UNSIGNED
    index. That is what lets LLVM vectorise it (a signed index forces a
    per-access wraparound select; measured ~3x slower, scalar ``addsd`` only).
    The element-wise result is unchanged."""
    n = a.shape[0]
    for w in range(w_max, 0, -1):
        m = n - 2 * w
        left = a[:m]
        right = a[2 * w :]
        mid = a[w : n - w]
        out = b[w : n - w]
        for i in range(np.uint64(m)):
            x = mid[i]
            t = (left[i] + right[i]) * 0.5
            out[i] = x if (x < t or x != x) else t
        for i in range(w):
            b[i] = a[i]
            b[n - 1 - i] = a[n - 1 - i]
        a, b = b, a
    return a


def _snip_loop_negzero(a: Any, b: Any, w_max: int) -> Any:
    """:func:`_snip_loop` for platforms whose ``np.minimum`` returns ``-0.0``
    for a ``+0.0``/``-0.0`` tie in either order (AArch64)."""
    n = a.shape[0]
    for w in range(w_max, 0, -1):
        m = n - 2 * w
        left = a[:m]
        right = a[2 * w :]
        mid = a[w : n - w]
        out = b[w : n - w]
        for i in range(np.uint64(m)):
            x = mid[i]
            t = (left[i] + right[i]) * 0.5
            if x < t or x != x:
                out[i] = x
            elif x == t and x == 0.0 and math.copysign(1.0, x) < 0.0:
                out[i] = x
            else:
                out[i] = t
        for i in range(w):
            b[i] = a[i]
            b[n - 1 - i] = a[n - 1 - i]
        a, b = b, a
    return a


def _zero_tie_mode() -> str | None:
    """How ``np.minimum`` resolves a signed-zero tie here: ``"second"``
    (returns the second operand), ``"negative"`` (returns ``-0.0`` in either
    order), or ``None`` when it differs between array lengths (SIMD body vs
    scalar tail), in which case no kernel can match it and numpy is used."""
    modes = set()
    for n in (1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 33, 64, 67, 1000):
        pos, neg = np.zeros(n), np.full(n, -0.0)
        a = np.signbit(np.minimum(pos, neg))  # second operand is -0
        b = np.signbit(np.minimum(neg, pos))  # second operand is +0
        if a.all() and not b.any():
            modes.add("second")
        elif a.all() and b.all():
            modes.add("negative")
        else:
            return None
    return modes.pop() if len(modes) == 1 else None


def _compile() -> Kernel | None:
    if os.environ.get("QZ_NO_NUMBA"):
        return None
    try:
        with heavy_imports("numba"):
            import numba
    except (ImportError, OSError):  # no wheel for this platform / broken llvmlite
        return None
    # cache=True keeps the compiled code on disk (next launch skips the JIT).
    # In a frozen build or a read-only install it can fail to find a cache
    # location; retry uncached rather than lose the kernel.
    mode = _zero_tie_mode()
    if mode is None:
        return None
    loop = _snip_loop if mode == "second" else _snip_loop_negzero
    for cache in (True, False):
        try:
            jitted = numba.njit(cache=cache, nogil=True)(loop)
            probe = np.array([3.0, 1.0, 2.0, 5.0, 4.0])
            jitted(probe.copy(), np.empty_like(probe), 1)  # compile + smoke
            return jitted
        except Exception:  # noqa: BLE001 - any JIT failure means "use numpy"
            continue
    return None


def get_kernel() -> Kernel | None:
    """The compiled kernel ``(a, b, w_max) -> result buffer``, or ``None``."""
    if _STATE["loaded"]:
        return _STATE["kernel"]  # type: ignore[no-any-return]
    with _LOCK:
        if not _STATE["loaded"]:
            _STATE["kernel"] = _compile()
            _STATE["loaded"] = True
    return _STATE["kernel"]  # type: ignore[no-any-return]


def peek_kernel() -> Kernel | None:
    """The kernel only if already loaded; never imports or compiles."""
    return _STATE["kernel"] if _STATE["loaded"] else None


def reset_for_tests() -> None:
    """Forget the loaded kernel so the next :func:`get_kernel` re-resolves."""
    with _LOCK:
        _STATE.update(loaded=False, kernel=None)
