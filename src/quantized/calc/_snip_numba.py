"""Optional compiled (numba) SNIP clip kernel; see ``calc/_snip.py``.

Same arithmetic, operands and order as ``snip_clip_reference``: every output
element is ``min(v[i], fl(fl(v[i-w] + v[i+w]) * 0.5))`` and the clip is
double-buffered per window step. No fastmath (so no reassociation and no FMA
contraction, and IEEE NaN/inf/+-0 behaviour is untouched). The minimum is
spelled out to match ``np.minimum``: NaN in either operand propagates (the
first NaN wins), otherwise the SECOND operand wins when the two compare
equal (measured: this is how ``-0.0`` vs ``0.0`` resolves at every length
and alignment).

numba is imported lazily (it pulls in llvmlite; ``heavy_imports`` serialises
that first import) and is optional at runtime: :func:`get_kernel` returns
``None`` when it cannot be imported or compiled, and the caller falls back to
the numpy implementation. ``QZ_NO_NUMBA=1`` forces that fallback.
"""

from __future__ import annotations

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
    for cache in (True, False):
        try:
            jitted = numba.njit(cache=cache, nogil=True)(_snip_loop)
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
