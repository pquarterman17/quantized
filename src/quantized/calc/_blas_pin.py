r"""One-thread BLAS for the bounded least-squares solve, safe under overlap.

Why one thread: ``calc/_bounded_lsq.py``'s module doc (oversubscribed
OpenBLAS threads made a 20-peak fit miss its deadline on a loaded machine).

Why not ``threadpoolctl``'s ``limit()`` context: it is process-wide for a
pthreads OpenBLAS, and each context restores the count IT saw on entry. Two
overlapping fits -- a superseded fit the server still finishes beside its
replacement, a batch beside a wizard fit -- then interleave as: A pins (4 -> 1),
B enters and saves 1, A leaves and restores 4 while B is still solving
(unpinned), B leaves and restores 1, and BLAS stays single-threaded for the
whole process forever. threadpoolctl also lets only one "controlling" thread
change a shared pool, so a restore from another thread silently does nothing.

So :func:`single_thread_blas` refcounts under one lock: the FIRST entrant
records every shared pool's count and sets 1, the LAST leaver -- from
whichever thread that is -- restores the recorded counts, clearing
threadpoolctl's controlling-thread claim around each change
(``clear_controlling_thread(force=True)``). A pool behind the OpenMP threading
layer is per-thread instead: each entrant pins and restores its own.

While any fit holds the pin, other BLAS work in the process runs on one
thread too (docs/performance_envelope.md).
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from threadpoolctl import OpenBLASController, ThreadpoolController

__all__ = ["single_thread_blas"]

_lock = threading.Lock()
_libs: list[Any] | None = None  # the process's BLAS lib controllers, found once
_holders = 0
_saved: list[tuple[Any, int]] = []  # shared pools' counts before the first pin


def _blas_libs() -> list[Any]:
    """BLAS lib controllers (call under ``_lock``: found once, thread-safely)."""
    global _libs
    if _libs is None:
        _libs = list(ThreadpoolController().select(user_api="blas").lib_controllers)
    return _libs


def _set_shared(lib: Any, n: int) -> None:
    """Set a shared (process-wide) pool from any thread."""
    OpenBLASController.clear_controlling_thread(force=True)
    lib.set_num_threads(n)
    OpenBLASController.clear_controlling_thread(force=True)


def _per_thread(lib: Any) -> bool:
    return getattr(lib, "threading_layer", None) == "openmp"


@contextmanager
def single_thread_blas() -> Iterator[None]:
    """Hold every BLAS pool at one thread for the duration (module doc)."""
    global _holders, _saved
    with _lock:
        libs = _blas_libs()
        if _holders == 0:
            _saved = [(lib, int(lib.get_num_threads())) for lib in libs if not _per_thread(lib)]
            for lib, _n in _saved:
                _set_shared(lib, 1)
        _holders += 1
    mine = [(lib, int(lib.get_num_threads())) for lib in libs if _per_thread(lib)]
    for lib, _n in mine:
        lib.set_num_threads(1)
    try:
        yield
    finally:
        for lib, n in mine:
            lib.set_num_threads(n)
        with _lock:
            _holders -= 1
            if _holders == 0:
                for lib, n in _saved:
                    _set_shared(lib, n)
                _saved = []
