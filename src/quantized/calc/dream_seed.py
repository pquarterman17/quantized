"""A seeded, exclusive random stream for bumps' DREAM sampler.

Pure calc layer (used by :mod:`quantized.calc.refl_dream` and the DREAM
engine of :mod:`quantized.calc.fit_bumps`). bumps.dream draws every random
number from a module-level ``rng`` — ``numpy.random`` itself by default — and
several of its modules bind that name, or one of its functions, at import
(``from .util import rng``; ``pchoice = rng.choice`` in the DE step), so "set
``bumps.dream.util.rng``", the seeding recipe bumps documents, leaves the DE
step and the chain bookkeeping on the global stream. A seeded run therefore
swaps EVERY such binding for the length of the run (measured: without the
``pchoice`` swap, one seed gave different posteriors run to run), and holds a
lock while it does: two DREAM runs in one process (the job pool runs two at
once) would otherwise draw from each other's stream, and a seed would no
longer reproduce a result. The lock serialises DREAM runs; it is not a worker
thread and holds no state beyond the swap. An unseeded run takes the lock
too, so it cannot draw from a seeded run's stream.

Two installs a seed cannot fully control, reported by :func:`seed_reproducible`
so a caller can say so: with numba installed bumps JIT-compiles its DE step,
and numba keeps its own generator that no Python-level seed reaches; with
bumps' compiled DE kernel (``bumps.dream.compiled.dll``) the kernel's
generator is seeded from this stream — reproducible, but a different sequence
from the pure-Python path. Either way a seed reproduces a result on one
installation at best, never across installations.
"""

from __future__ import annotations

import importlib
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import numpy as np

__all__ = ["DREAM_RNG_MODULES", "seed_reproducible", "seeded_dream"]

#: Every bumps.dream module that holds the sampler's ``rng`` as an attribute
#: (measured against bumps 1.0.5: ``rg -n "rng" bumps/dream``; the others
#: read ``util.rng`` at call time, which the first entry covers).
DREAM_RNG_MODULES = (
    "bumps.dream.util", "bumps.dream.core", "bumps.dream.diffev", "bumps.dream.state",
)

_LOCK = threading.Lock()


def seed_reproducible() -> bool:
    """False when bumps runs its DE step under numba, whose generator a seed
    set from Python cannot reach (a seeded run is then NOT reproducible)."""
    diffev = importlib.import_module("bumps.dream.diffev")
    return getattr(diffev, "prange", range) is range


@contextmanager
def seeded_dream(seed: int | None) -> Iterator[np.random.RandomState]:
    """Run the body exclusively, with every DREAM module drawing from
    ``RandomState(seed)``; yields that stream (for the caller's own draws).

    ``seed`` None swaps nothing — the run keeps bumps' default, the global
    ``numpy.random`` stream (so a caller that seeded that, as the bumps engine's
    own tests do, keeps its seed) — and yields a fresh unseeded stream; the run
    is still exclusive. The previous bindings are restored on exit, whether
    the body returns or raises.
    """
    mods: list[Any] = [importlib.import_module(name) for name in DREAM_RNG_MODULES]
    diffev = mods[DREAM_RNG_MODULES.index("bumps.dream.diffev")]
    with _LOCK:
        stream = np.random.RandomState(seed)
        if seed is None:
            yield stream
            return
        swaps: list[tuple[Any, str, Any]] = [(m, "rng", stream) for m in mods]
        if seed_reproducible():  # the pure-Python DE step's import-time choice()
            swaps.append((diffev, "pchoice", stream.choice))
        saved = [(m, attr, getattr(m, attr)) for m, attr, _ in swaps]
        try:
            for m, attr, new in swaps:
                setattr(m, attr, new)
            yield stream
        finally:
            for m, attr, old in saved:
                setattr(m, attr, old)
