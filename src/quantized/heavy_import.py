"""One process-wide lock that serializes FIRST imports of heavy modules (BUG-032).

Why: the app defers its heavy optional dependencies (matplotlib via every
``calc/figure*.py`` renderer, lifelines, statsmodels, bumps, openpyxl, h5py,
periodictable, ``scipy.io``, python-docx/pptx ...) to function-level imports,
so a launch that never uses a feature never pays for it. FastAPI runs the
sync routes -- and ``quantized.jobs`` runs its jobs -- on worker threads, so
on a cold process several requests can perform several DIFFERENT modules'
first import at the same moment. CPython's import system only locks per
module NAME: a thread importing one name that reaches a shared package
another thread is still initialising (``matplotlib/__init__``,
``matplotlib.transforms``, ``lifelines.statistics`` ...) sees it half-built
and fails -- ``ImportError: cannot import name ... from partially initialized
module``, ``AttributeError: module 'matplotlib' has no attribute ...``,
CPython's own ``_DeadlockError``, whatever line each thread happened to be
on (BUG-032 lists the shapes measured). For matplotlib it is not transient:
re-running the failed imports afterwards in the same process still fails
(``module 'matplotlib' has no attribute '_docstring'``), so every later
export that needs it fails until restart.

The fix: every such lazy import goes through :func:`heavy_imports` (or
:func:`heavy_import` for a computed name), which takes ONE re-entrant lock
around the import statements unless every named module -- and each of its
parent packages -- is already in ``sys.modules`` and finished initialising,
and no guarded import is in progress in any thread. So first imports happen
one at a time, and the steady state (everything already imported) costs a
few dict lookups and never touches the lock. Nothing is imported eagerly:
startup cost is unchanged, and a broken optional dependency still fails only
the feature that needs it. ``tests/test_heavy_import_guard.py`` statically
requires every function-level third-party / ``quantized.*`` import in
``src/`` to sit inside ``with heavy_imports(...)`` (or on its explicit
allowlist), so a new lazy import cannot bypass the lock.

Usage -- the body holds ONLY import statements, and names every module it
imports (both are enforced by the guard test)::

    with heavy_imports("quantized.calc.figure_map"):
        from quantized.calc.figure_map import render_map_figure

Lock ordering: ``calc.render_lock.RENDER_LOCK`` may be held while this lock
is taken (a renderer's own lazy cross-import mid-render), never the reverse:
a guarded body only imports, and no module in ``src/`` takes the render lock
or calls this helper at import time. That module-scope rule matters beyond
the render lock too: CPython's per-module import locks cannot see this lock,
so a module whose body waited on it while another thread held it and was
importing that same module would deadlock -- hence function-level use only
(also enforced by the guard test).

Residual, by design out of reach here: a third-party library's OWN lazy
imports inside its call paths (e.g. matplotlib pulling a backend submodule
mid-render) are not routed through this lock. Renders are already serialized
by ``RENDER_LOCK``; what remains is a library's internal lazy import racing a
concurrent guarded first import of a different library that shares a
still-initialising dependency.

Pure layer: stdlib only (no fastapi/pydantic/starlette).
"""

from __future__ import annotations

import importlib
import sys
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from types import ModuleType

__all__ = ["HEAVY_IMPORT_LOCK", "heavy_import", "heavy_imports", "module_ready"]

#: The one lock. Re-entrant so a guarded import whose module body (directly or
#: transitively) reaches another guarded block in the same thread -- which
#: the module-scope rule above forbids in ``src/`` but a plugin could do --
#: re-acquires instead of self-deadlocking.
HEAVY_IMPORT_LOCK = threading.RLock()

# Threads currently inside a slow-path (locked) block. Written only under
# HEAVY_IMPORT_LOCK; read without it by the fast path. While it is non-zero,
# a module that looks "ready" may still depend on a sibling that a guarded
# import in another thread is half-way through (a circular chain completes
# the inner module first), so the fast path is declined and the caller
# queues behind the in-progress import instead.
_in_progress = 0


def _initialising(module: ModuleType) -> bool:
    # CPython's import machinery sets ``__spec__._initializing`` for the
    # duration of a module's execution (``importlib._bootstrap._load_unlocked``)
    # -- the same flag it checks itself before handing out a cached module.
    spec = getattr(module, "__spec__", None)
    return bool(getattr(spec, "_initializing", False))


def module_ready(name: str) -> bool:
    """True when ``name`` and every parent package of it are in
    ``sys.modules`` and none is still executing its module body.

    The parent check matters: ``matplotlib.transforms`` finishes importing
    while ``matplotlib/__init__`` -- which imported it -- is still running.
    """
    parts = name.split(".")
    for end in range(1, len(parts) + 1):
        module = sys.modules.get(".".join(parts[:end]))
        if module is None or _initialising(module):
            return False
    return True


@contextmanager
def heavy_imports(*modules: str) -> Iterator[None]:
    """Run the body's import statements under the process-wide heavy-import
    lock, unless all of ``modules`` are already fully imported (fast path).

    ``modules`` must name every module the body imports (the guard test
    checks this statically). Exceptions from the body -- an ``ImportError``
    from a missing optional dependency included -- propagate unchanged, and
    the lock is always released.
    """
    global _in_progress
    if not modules:
        raise ValueError("heavy_imports() needs the module names its body imports")
    if _in_progress == 0 and all(module_ready(name) for name in modules):
        yield
        return
    with HEAVY_IMPORT_LOCK:
        _in_progress += 1
        try:
            yield
        finally:
            _in_progress -= 1


def heavy_import(name: str) -> ModuleType:
    """``importlib.import_module(name)`` through :func:`heavy_imports`, for a
    module name that is computed rather than written as a statement."""
    with heavy_imports(name):
        return importlib.import_module(name)
