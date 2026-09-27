"""Per-package locks that serialize FIRST imports of heavy modules (BUG-032).

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

**Granularity: one lock per top-level package.** A slow-path (first) import
takes the lock of each requested module's top-level package AND of every
top-level package in its declared dependency closure (installed
distribution metadata, ``extra``-only requirements excluded; for first-party
``quantized.*`` modules, this project's own distribution), minus members that
are already-imported plain modules (``typing_extensions``: nothing left to
initialise). That is the set of packages the import is declared to be able
to initialise, so two first imports serialize when they could race on a
shared package -- lifelines and statsmodels both pull in pandas/scipy, a
renderer module and ``matplotlib.mathtext`` both pull in matplotlib -- and
not otherwise: a stuck import whose closure is disjoint (``win32com``;
pywin32 declares no dependencies) blocks nobody else. Locks are created
lazily under a small registry lock and always acquired in sorted
(canonical) order, so two slow paths cannot invert. (Nested blocks on one
thread re-enter the locks they already hold; a nested block needing NEW
locks takes them after the outer ones, out of canonical order -- only a
module body could do that, which the guard test forbids in ``src/``, and
the timeout below bounds it regardless.)

**Fast path: depends only on the requested modules' own readiness.** No lock
is touched when every requested module and each of its parent packages is in
``sys.modules`` with ``__spec__._initializing`` false -- AND, if a guarded
import holding that module's package is in flight, the module was already
ready when that in-flight import began (the package's *baseline*, a snapshot
taken as its first concurrent slow path starts). A module that became ready
DURING an in-flight import of its own package may be the inner half of a
circular chain whose sibling is still half-built, so it waits. Each package
also carries a generation counter bumped on every slow-path entry; the fast
path re-reads it after its readiness checks and falls to the slow path if it
moved (the checks are not atomic). An unrelated package's in-flight import
never slows an already-loaded module.

**Bounded waits.** Acquiring the locks gives up after
:data:`HEAVY_IMPORT_TIMEOUT_S` (read live) with :class:`HeavyImportTimeout`,
which routes map to a 503 like ``RenderLockTimeout``. A caller inside a
cancellable wait passes ``while_waiting``: the locks are then taken in short
slices and ``while_waiting()`` is called between them; it may raise to give
up.

**Missing optional dependencies.** A requested module (or parent) that
failed with ``ModuleNotFoundError`` naming itself is remembered, so later
availability probes raise the same error at once without taking any lock.
An explicit ``sys.modules[name] = None`` block is never remembered, and a
remembered name that has since appeared in ``sys.modules`` is forgotten; a
package installed into the running process is otherwise seen after a
restart or :func:`clear_missing_cache`.

Lock ordering: ``calc.render_lock.RENDER_LOCK`` may be held while these
locks are taken (a renderer's own lazy cross-import mid-render), never the
reverse: a guarded body only imports. Module scope is off-limits too: the
guard test forbids module-scope calls to ``heavy_imports``/``heavy_import``
and to any function that (transitively, as far as a static scan resolves
calls) uses them, and ``tests/test_render_lock_import_time.py`` forbids
module-scope calls that (likewise transitively) take the render lock.
(CPython's per-module import locks cannot see these locks, so a module body
waiting on one while another thread held it and was importing that same
module would deadlock.)

Residual, by design out of reach here: a third-party library's OWN lazy
imports inside its call paths (e.g. matplotlib pulling a backend submodule
mid-render) and a library's undeclared (optional) import-time dependencies
are not covered by the lock set. Renders are already serialized by
``RENDER_LOCK``.

Pure layer: stdlib only (no fastapi/pydantic/starlette).
"""

from __future__ import annotations

import importlib
import re
import sys
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from types import ModuleType

__all__ = [
    "HEAVY_IMPORT_TIMEOUT_S",
    "HeavyImportTimeout",
    "clear_missing_cache",
    "heavy_import",
    "heavy_imports",
    "module_ready",
]

#: Bounded-acquire timeout (seconds) for one slow-path import. Generous: a
#: first import of the heaviest stack here (statsmodels, or matplotlib
#: building its font cache on a fresh machine) takes seconds to tens of
#: seconds; past this the in-flight import is treated as stuck.
HEAVY_IMPORT_TIMEOUT_S = 120.0

#: Slice length for a cancellable (``while_waiting``) acquire.
WAIT_SLICE_S = 0.25

#: This project's top-level package and its distribution name; an editable
#: install does not appear in ``packages_distributions()``.
_FIRST_PARTY = __name__.partition(".")[0]
_FIRST_PARTY_DIST = "quantized-lab"


class HeavyImportTimeout(RuntimeError):
    """A heavy-import lock could not be acquired within the timeout -- another
    thread's first import of a package this one shares is stuck. Mapped to
    HTTP 503 (retryable) by ``routes._errors``."""


class _Package:
    """Per-top-level-package state. ``active``/``generation``/``baseline``
    are written only while ``lock`` is held; the fast path reads them bare
    (each read is atomic under the GIL)."""

    __slots__ = ("active", "baseline", "generation", "lock")

    def __init__(self) -> None:
        # Re-entrant: a nested guarded block on the same thread (a plugin's
        # module body, say) re-acquires instead of self-deadlocking.
        self.lock = threading.RLock()
        self.active = 0  # slow paths holding this lock (nesting counts)
        self.generation = 0  # bumped on every slow-path entry
        self.baseline: frozenset[str] | None = None  # ready modules at 0 -> 1


_REGISTRY_LOCK = threading.Lock()
_PACKAGES: dict[str, _Package] = {}
_DEPS_LOCK = threading.Lock()
_DEPS: dict[str, frozenset[str]] = {}
_DIST_INDEX: tuple[dict[str, frozenset[str]], dict[str, list[str]]] | None = None
_MISSING: dict[str, str] = {}
_REQ_NAME = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def _package(top: str) -> _Package:
    pkg = _PACKAGES.get(top)
    if pkg is None:
        with _REGISTRY_LOCK:
            pkg = _PACKAGES.setdefault(top, _Package())
    return pkg


def _initialising(module: object) -> bool:
    # CPython's import machinery sets ``__spec__._initializing`` for the
    # duration of a module's execution (``importlib._bootstrap._load_unlocked``)
    # -- the same flag it checks itself before handing out a cached module.
    spec = getattr(module, "__spec__", None)
    return bool(getattr(spec, "_initializing", False))


def _prefixes(name: str) -> Iterator[str]:
    parts = name.split(".")
    for end in range(1, len(parts) + 1):
        yield ".".join(parts[:end])


def module_ready(name: str) -> bool:
    """True when ``name`` and every parent package of it are in
    ``sys.modules`` and none is still executing its module body.

    The parent check matters: ``matplotlib.transforms`` finishes importing
    while ``matplotlib/__init__`` -- which imported it -- is still running.
    """
    for prefix in _prefixes(name):
        module = sys.modules.get(prefix)
        if module is None or _initialising(module):
            return False
    return True


# --- dependency closure (slow path only) -------------------------------------


def _normalize(dist: str) -> str:
    return re.sub(r"[-_.]+", "-", dist).lower()


def _dist_index() -> tuple[dict[str, frozenset[str]], dict[str, list[str]]]:
    """(dist -> its top-level import names, top-level name -> dists). Built
    once, under ``_DEPS_LOCK``."""
    global _DIST_INDEX
    if _DIST_INDEX is None:
        import importlib.metadata as md

        by_top = {t: [_normalize(d) for d in ds] for t, ds in md.packages_distributions().items()}
        by_dist: dict[str, set[str]] = {}
        for top, dists in by_top.items():
            for dist in dists:
                by_dist.setdefault(dist, set()).add(top)
        _DIST_INDEX = ({d: frozenset(t) for d, t in by_dist.items()}, by_top)
    return _DIST_INDEX


def _closure(top: str) -> frozenset[str]:
    """``top`` plus every top-level package its distribution's non-extra
    requirements provide, transitively (environment markers are not
    evaluated: over-inclusive, never under). Unknown names (stdlib, a loose
    module) close over themselves only. Unreadable metadata fails safe:
    every known top-level name."""
    try:
        return _closure_from_metadata(top)
    except Exception:  # noqa: BLE001 - a broken dist must not break imports
        return frozenset({top, *(_DIST_INDEX[1] if _DIST_INDEX else ())})


def _closure_from_metadata(top: str) -> frozenset[str]:
    import importlib.metadata as md

    provides, by_top = _dist_index()
    start = by_top.get(top, [])
    if top == _FIRST_PARTY and not start:
        start = [_FIRST_PARTY_DIST]
    seen: set[str] = set()
    todo = list(start)
    while todo:
        dist = todo.pop()
        if dist in seen:
            continue
        seen.add(dist)
        try:
            requirements = md.requires(dist) or []
        except md.PackageNotFoundError:
            if dist == _FIRST_PARTY_DIST:  # running from an uninstalled tree:
                return frozenset({top, *by_top})  # fail safe -- lock everything
            continue
        for req in requirements:
            spec, _, marker = req.partition(";")
            match = _REQ_NAME.match(spec)
            if match and "extra" not in marker:
                todo.append(_normalize(match.group(1)))
    tops = {top}
    for dist in seen:
        tops |= provides.get(dist, frozenset())
    return frozenset(tops)


def _settled(top: str) -> bool:
    """A fully imported plain module (not a package): it has no submodules
    left to initialise, so no first import can race on it any more
    (``typing_extensions``, ``six``, ...). Packages never count -- their
    submodules load lazily."""
    module = sys.modules.get(top)
    spec = getattr(module, "__spec__", None)
    return (
        module is not None
        and spec is not None
        and not _initialising(module)
        and getattr(spec, "submodule_search_locations", None) is None
    )


def _lock_names(modules: Iterable[str]) -> list[str]:
    """The sorted (canonical acquisition order) lock names for a slow path:
    each requested top-level package plus its dependency closure, minus
    closure members that are :func:`_settled`."""
    requested = {m.partition(".")[0] for m in modules}
    names: set[str] = set(requested)
    for top in requested:
        deps = _DEPS.get(top)
        if deps is None:
            with _DEPS_LOCK:
                deps = _DEPS.get(top)
                if deps is None:
                    deps = _DEPS[top] = _closure(top)
        names |= {d for d in deps if not _settled(d)}
    return sorted(names)


# --- negative cache ----------------------------------------------------------


def _known_missing(modules: Iterable[str]) -> str | None:
    for name in modules:
        for prefix in _prefixes(name):
            if prefix not in _MISSING:
                continue
            if sys.modules.get(prefix) is not None:  # appeared since (a plugin, a test)
                _MISSING.pop(prefix, None)
                continue
            return prefix
    return None


def _remember_missing(exc: ModuleNotFoundError, modules: Iterable[str]) -> None:
    name = exc.name
    if not name or name in sys.modules:  # ``sys.modules[name] = None``: a block
        return
    if any(name in _prefixes(m) for m in modules):
        _MISSING[name] = str(exc)


def clear_missing_cache() -> None:
    """Forget every remembered missing module (tests; a live install)."""
    _MISSING.clear()


# --- the fast path, the locks, the public API --------------------------------


def _fast_path_ok(modules: tuple[str, ...]) -> bool:
    watched: list[tuple[_Package, int]] = []
    for name in modules:
        pkg = _package(name.partition(".")[0])
        generation = pkg.generation
        baseline = pkg.baseline
        busy = pkg.active > 0
        if not module_ready(name):
            return False
        if busy and (baseline is None or any(p not in baseline for p in _prefixes(name))):
            return False
        watched.append((pkg, generation))
    # Re-check: a slow path that entered while we looked (its body may be
    # what just made a module "ready") has moved the generation.
    return all(pkg.generation == generation for pkg, generation in watched)


def _ready_snapshot(tops: set[str]) -> dict[str, frozenset[str]]:
    ready: dict[str, set[str]] = {t: set() for t in tops}
    for name, module in list(sys.modules.items()):
        bucket = ready.get(name.partition(".")[0])
        if bucket is not None and module is not None and not _initialising(module):
            bucket.add(name)
    return {t: frozenset(r) for t, r in ready.items()}


def _acquire(
    names: list[str], while_waiting: Callable[[], None] | None,
) -> list[_Package]:
    deadline = time.monotonic() + HEAVY_IMPORT_TIMEOUT_S
    held: list[_Package] = []
    try:
        for name in names:
            pkg = _package(name)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise HeavyImportTimeout(
                        f"a first import could not start within {HEAVY_IMPORT_TIMEOUT_S:.0f}s: "
                        f"another thread's import sharing package {name!r} is still "
                        "running (stuck?); retry later"
                    )
                step = min(remaining, WAIT_SLICE_S) if while_waiting else remaining
                if pkg.lock.acquire(timeout=step):
                    held.append(pkg)
                    break
                if while_waiting is not None:
                    while_waiting()
    except BaseException:
        for pkg in reversed(held):
            pkg.lock.release()
        raise
    return held


@contextmanager
def heavy_imports(
    *modules: str, while_waiting: Callable[[], None] | None = None,
) -> Iterator[None]:
    """Run the body's import statements under the per-package heavy-import
    locks, unless all of ``modules`` are already fully imported (fast path).

    ``modules`` must name every module the body imports (the guard test
    checks this statically). Raises :class:`HeavyImportTimeout` if the locks
    are not free within :data:`HEAVY_IMPORT_TIMEOUT_S`; ``while_waiting``,
    when given, is called about every :data:`WAIT_SLICE_S` s while waiting
    and may raise to cancel. A remembered missing module raises
    ``ModuleNotFoundError`` before any lock. Exceptions from the body
    propagate unchanged, and every lock is always released.
    """
    if not modules:
        raise ValueError("heavy_imports() needs the module names its body imports")
    if _MISSING:
        missing = _known_missing(modules)
        if missing is not None:
            raise ModuleNotFoundError(_MISSING.get(missing, missing), name=missing)
    if _fast_path_ok(modules):
        yield
        return
    names = _lock_names(modules)
    held = _acquire(names, while_waiting)
    try:
        fresh = {n for n, pkg in zip(names, held, strict=True) if pkg.active == 0}
        snapshot = _ready_snapshot(fresh) if fresh else {}
        for name, pkg in zip(names, held, strict=True):
            if name in snapshot:
                pkg.baseline = snapshot[name]
            pkg.active += 1
            pkg.generation += 1
        try:
            yield
        except ModuleNotFoundError as exc:
            _remember_missing(exc, modules)
            raise
        finally:
            for pkg in held:
                pkg.active -= 1
                if pkg.active == 0:
                    pkg.baseline = None
    finally:
        for pkg in reversed(held):
            pkg.lock.release()


def heavy_import(name: str, *, while_waiting: Callable[[], None] | None = None) -> ModuleType:
    """``importlib.import_module(name)`` through :func:`heavy_imports`, for a
    module name that is computed rather than written as a statement."""
    with heavy_imports(name, while_waiting=while_waiting):
        return importlib.import_module(name)
