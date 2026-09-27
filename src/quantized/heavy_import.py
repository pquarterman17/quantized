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
re-running the failed imports afterwards in the same process still fails, so
every later export that needs it fails until restart.

The fix: every such lazy import goes through :func:`heavy_imports` (or
:func:`heavy_import` for a computed name). Usage -- the body holds ONLY
import statements, and names every module it imports (both enforced by
``tests/test_heavy_import_guard.py``)::

    with heavy_imports("quantized.calc.figure_map"):
        from quantized.calc.figure_map import render_map_figure

**Fast path (no lock): readiness.** When every requested module, each of
its parent packages and its top-level package are in ``sys.modules``, not
``None``, and finished initialising (``__spec__._initializing`` falsy), the
body runs without touching the lock -- whatever other imports are in flight
elsewhere. The parent check matters: ``matplotlib.transforms`` finishes
while ``matplotlib/__init__``, which imported it, is still running, so it is
not ready until its package is.

**Slow path: one re-entrant lock.** Otherwise the caller takes
:data:`HEAVY_IMPORT_LOCK`, so first imports happen one at a time. Readiness
is re-checked once the lock is held: if another thread finished the import
meanwhile, the lock is released before the body runs. The wait is
unbounded -- a legitimately long first import (matplotlib building its font
cache on a first launch) makes the others wait rather than fail -- but
cooperative: a caller inside a cancellable wait passes ``while_waiting``;
the lock is then taken in :data:`WAIT_SLICE_S` slices with the hook called
between them, and whatever the hook raises propagates (DREAM jobs cancel
this way).

**Missing optional dependencies never wait.** Before taking the lock, a
requested top-level package that is not loaded is looked up with
``importlib.util.find_spec`` (a finder search: for a top-level name the
standard finders execute no module body); if it cannot be found -- or the
lookup itself raises ``ImportError``/``ValueError`` -- ``ModuleNotFoundError``
is raised at once. Nothing is cached: a package installed while the process
runs is found by the next call. (This covers the optional-dependency probes
-- ``bumps_available``, the stats checks, ``_import_h5py``, ``dialog_kind``,
``com_available``, the SIMS sniffer's openpyxl -- without any per-site code,
and works in a frozen build, which carries no distribution metadata.)

Lock ordering: ``calc.render_lock.RENDER_LOCK`` may be held while this lock
is taken (a renderer's own lazy cross-import mid-render), never the
reverse: a guarded body only imports. Module scope is off-limits too: the
guard test forbids module-scope calls to ``heavy_imports``/``heavy_import``
and to any function that (transitively, as far as a static scan resolves
calls) uses them, and ``tests/test_render_lock_import_time.py`` forbids
module-scope calls that (likewise transitively) take the render lock.
(CPython's per-module import locks cannot see this lock, so a module body
waiting on it while another thread held it and was importing that same
module would deadlock.)

Residual, by design out of reach here: a third-party library's OWN lazy
imports inside its call paths (e.g. matplotlib pulling a backend submodule
mid-render) do not go through the lock. Renders are already serialized by
``RENDER_LOCK``.

Pure layer: stdlib only (no fastapi/pydantic/starlette).
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from types import ModuleType

__all__ = ["HEAVY_IMPORT_LOCK", "WAIT_SLICE_S", "heavy_import", "heavy_imports", "module_ready"]

#: The one lock, held only for a slow-path (first) import. Re-entrant so a
#: guarded import whose module body reaches another guarded block on the
#: same thread (forbidden in ``src/`` by the guard test, possible in a
#: plugin) re-acquires instead of self-deadlocking.
HEAVY_IMPORT_LOCK = threading.RLock()

#: Slice length (seconds) of a cancellable (``while_waiting``) acquire.
WAIT_SLICE_S = 0.25


def _initialising(module: object) -> bool:
    # CPython's import machinery sets ``__spec__._initializing`` for the
    # duration of a module's execution (``importlib._bootstrap._load_unlocked``)
    # -- the same flag it checks itself before handing out a cached module.
    spec = getattr(module, "__spec__", None)
    return bool(getattr(spec, "_initializing", False))


def module_ready(name: str) -> bool:
    """True when ``name`` and every parent package of it (its top-level
    package included) are in ``sys.modules``, not ``None``, and none is
    still executing its module body."""
    parts = name.split(".")
    for end in range(1, len(parts) + 1):
        module = sys.modules.get(".".join(parts[:end]))
        if module is None or _initialising(module):
            return False
    return True


def _ready(modules: tuple[str, ...]) -> bool:
    return all(module_ready(name) for name in modules)


def _raise_if_absent(modules: tuple[str, ...]) -> None:
    """``ModuleNotFoundError`` for a requested top-level package that is not
    loaded and cannot be found -- without taking the lock (``find_spec`` of a
    top-level name searches the finders; it imports no parent)."""
    for name in modules:
        top = name.partition(".")[0]
        if sys.modules.get(top) is not None:
            continue
        try:
            found = importlib.util.find_spec(top) is not None
        except (ImportError, ValueError):  # a ``None`` entry, a broken finder
            found = False
        if not found:
            raise ModuleNotFoundError(f"No module named {top!r}", name=top)


def _acquire(while_waiting: Callable[[], None] | None) -> None:
    if while_waiting is None:
        HEAVY_IMPORT_LOCK.acquire()
        return
    while not HEAVY_IMPORT_LOCK.acquire(timeout=WAIT_SLICE_S):
        while_waiting()  # may raise to give up; nothing is held here


@contextmanager
def heavy_imports(
    *modules: str, while_waiting: Callable[[], None] | None = None,
) -> Iterator[None]:
    """Run the body's import statements under :data:`HEAVY_IMPORT_LOCK`,
    unless all of ``modules`` are already fully imported (fast path).

    ``modules`` must name every module the body imports (the guard test
    checks this statically). A requested top-level package that cannot be
    found raises ``ModuleNotFoundError`` before any lock. ``while_waiting``,
    when given, is called about every :data:`WAIT_SLICE_S` s while the lock
    is busy and may raise to cancel. Exceptions from the body propagate
    unchanged, and the lock is always released.
    """
    if not modules:
        raise ValueError("heavy_imports() needs the module names its body imports")
    if _ready(modules):
        yield
        return
    _raise_if_absent(modules)
    _acquire(while_waiting)
    held = True
    try:
        if _ready(modules):  # another thread finished it while we waited
            HEAVY_IMPORT_LOCK.release()
            held = False
        yield
    finally:
        if held:
            HEAVY_IMPORT_LOCK.release()


def heavy_import(name: str, *, while_waiting: Callable[[], None] | None = None) -> ModuleType:
    """``importlib.import_module(name)`` through :func:`heavy_imports`, for a
    module name that is computed rather than written as a statement."""
    with heavy_imports(name, while_waiting=while_waiting):
        return importlib.import_module(name)
