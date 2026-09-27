"""In-process locking semantics of ``quantized.heavy_import`` (BUG-032).

Fast and deterministic: every module imported here is a throwaway file in
``tmp_path`` with a per-test unique name, so ``sys.modules`` genuinely does
not hold it yet, and the module bodies coordinate through ``threading.Event``s
rather than sleeps. The real-library race is forced separately, in a fresh
interpreter, by ``test_heavy_import_cold_race.py``.
"""

from __future__ import annotations

import importlib
import sys
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest

from quantized import heavy_import as hi

_JOIN_S = 10.0  # generous: only reached when something is genuinely broken
_BLOCKED_S = 0.3  # "did not finish within" window for a wait that must block


@pytest.fixture
def modules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[..., str]]:
    """``make(body, package=False, sub=None) -> unique module name`` on
    ``sys.path`` (``sub`` names a submodule of an existing package made
    here); everything it creates is dropped from ``sys.modules`` and the
    helper's per-package state afterwards."""
    monkeypatch.syspath_prepend(str(tmp_path))
    made: list[str] = []

    def make(body: str, *, package: bool = False, sub: str | None = None) -> str:
        if sub is not None:
            leaf = f"m_{uuid.uuid4().hex[:8]}"
            (tmp_path / sub / f"{leaf}.py").write_text(body, encoding="utf-8")
            importlib.invalidate_caches()
            return f"{sub}.{leaf}"
        name = f"qz_hvi_{uuid.uuid4().hex[:12]}"
        target = tmp_path / name / "__init__.py" if package else tmp_path / f"{name}.py"
        target.parent.mkdir(exist_ok=True)
        target.write_text(body, encoding="utf-8")
        made.append(name)
        importlib.invalidate_caches()
        return name

    yield make
    for key in [k for k in sys.modules if k.split(".")[0] in made]:
        del sys.modules[key]
    for top in made:
        hi._PACKAGES.pop(top, None)
        hi._DEPS.pop(top, None)
    hi.clear_missing_cache()


def _run_in_thread(fn: Callable[[], None]) -> threading.Thread:
    t = threading.Thread(target=fn, daemon=True)
    t.start()
    return t


def _probe(name: str) -> ModuleType:
    probe = ModuleType(name)
    sys.modules[name] = probe
    return probe


def _race(names: list[str], *, guarded: bool) -> None:
    barrier = threading.Barrier(len(names))
    errors: list[BaseException] = []

    def worker(name: str) -> None:
        try:
            barrier.wait(timeout=_JOIN_S)
            if guarded:
                hi.heavy_import(name)
            else:
                importlib.import_module(name)
        except BaseException as exc:  # noqa: BLE001 - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(n,)) for n in names]
    for t in threads:
        t.start()
    for t in threads:
        t.join(_JOIN_S)
    assert not any(t.is_alive() for t in threads), "a racing import never finished"
    assert not errors, errors


_OVERLAP_BODY = """
import sys
probe = sys.modules[{probe!r}]
probe.started[{me!r}].set()
probe.saw_other[{me!r}] = probe.started[{other!r}].wait({wait})
"""


def _overlap_pair(
    modules: Callable[..., str], wait: float, *, same_package: bool,
) -> tuple[list[str], ModuleType]:
    """Two modules whose bodies each announce they started, then wait up to
    ``wait`` s for the OTHER's body to start -- ``saw_other`` records whether
    the two bodies were ever executing at the same time. ``same_package``:
    two submodules of one fresh package, else two unrelated top-level
    modules."""
    probe = _probe(f"qz_hvi_probe_{uuid.uuid4().hex[:12]}")
    probe.started = {"a": threading.Event(), "b": threading.Event()}
    probe.saw_other = {}
    pkg = modules("", package=True) if same_package else None
    names = [
        modules(_OVERLAP_BODY.format(probe=probe.__name__, me=me, other=other, wait=wait), sub=pkg)
        for me, other in (("a", "b"), ("b", "a"))
    ]
    return names, probe


def test_first_imports_sharing_a_package_never_overlap(modules: Callable[..., str]) -> None:
    names, probe = _overlap_pair(modules, wait=_BLOCKED_S, same_package=True)
    try:
        _race(names, guarded=True)
        # Whichever body ran first waited out its window alone (the other
        # was queued on the package lock); the second found it already done.
        assert sorted(probe.saw_other.values()) == [False, True], probe.saw_other
    finally:
        sys.modules.pop(probe.__name__, None)


def test_unguarded_control_the_probe_does_detect_overlap(modules: Callable[..., str]) -> None:
    """Without the helper the same two bodies DO run concurrently -- proof the
    probe above can see an overlap, so its ``[False, True]`` is meaningful."""
    names, probe = _overlap_pair(modules, wait=_JOIN_S, same_package=True)
    try:
        _race(names, guarded=False)
        assert probe.saw_other == {"a": True, "b": True}, probe.saw_other
    finally:
        sys.modules.pop(probe.__name__, None)


def test_first_imports_of_unrelated_packages_do_not_queue(modules: Callable[..., str]) -> None:
    """Per-package granularity: two first imports whose lock sets are
    disjoint run side by side (a stuck import of one optional package can't
    stall another)."""
    names, probe = _overlap_pair(modules, wait=_JOIN_S, same_package=False)
    try:
        _race(names, guarded=True)
        assert probe.saw_other == {"a": True, "b": True}, probe.saw_other
    finally:
        sys.modules.pop(probe.__name__, None)


def _blocked_slow_path(module: str) -> tuple[threading.Event, threading.Event, threading.Thread]:
    """A thread parked INSIDE a slow-path ``heavy_imports(module)`` block."""
    inside, release = threading.Event(), threading.Event()

    def slow() -> None:
        with hi.heavy_imports(module):
            inside.set()
            release.wait(_JOIN_S)

    thread = _run_in_thread(slow)
    assert inside.wait(_JOIN_S)
    return inside, release, thread


def _free_elsewhere(lock: threading.RLock) -> bool:
    """Whether ANOTHER thread can take ``lock`` (an RLock is always free to
    its owner, so asking from this thread proves nothing)."""
    got: list[bool] = []

    def take() -> None:
        got.append(lock.acquire(timeout=1.0))
        if got[-1]:
            lock.release()

    _run_in_thread(take).join(_JOIN_S)
    return got == [True]


def _import_in_thread(name: str) -> threading.Event:
    """``heavy_import(name)`` on a new thread; the event is set when it
    returns (a test that asserts it is still blocked must wait for it after
    releasing, so the import never outlives the test's own cleanup)."""
    done = threading.Event()

    def run() -> None:
        hi.heavy_import(name)
        done.set()

    _run_in_thread(run)
    return done


def test_an_in_flight_import_never_slows_an_already_loaded_module(
    modules: Callable[..., str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Finding: a stuck first import (a hanging optional dependency, a font
    cache being built) must not queue an already-loaded module -- renders
    holding the render lock take exactly this path. The in-flight import
    here even HOLDS the loaded module's package lock (that package is in its
    dependency closure), so only the fast path can let the caller through."""
    loaded = modules("VALUE = 1\n")
    importlib.import_module(loaded)
    stuck = f"qz_hvi_stuck_{uuid.uuid4().hex[:12]}"
    monkeypatch.setitem(hi._DEPS, stuck, frozenset({stuck, loaded}))
    _, release, slow = _blocked_slow_path(stuck)
    try:
        assert _import_in_thread(loaded).wait(_JOIN_S), (
            "an already-loaded module queued behind an in-flight import"
        )
    finally:
        release.set()
        slow.join(_JOIN_S)


def test_same_package_in_flight_import_only_holds_back_modules_it_could_have_made(
    modules: Callable[..., str],
) -> None:
    """While package P has a guarded import in flight, a module of P that was
    ready BEFORE it began still fast-paths; one that became ready during it
    (it may be the inner half of a circular chain) waits."""
    pkg = modules("", package=True)
    before = modules("X = 1\n", sub=pkg)
    importlib.import_module(before)
    _, release, slow = _blocked_slow_path(f"{pkg}.absent_{uuid.uuid4().hex[:8]}")
    during = modules("X = 2\n", sub=pkg)
    importlib.import_module(during)  # unguarded, so ready while P is in flight
    try:
        assert _import_in_thread(before).wait(_JOIN_S)
        waiter = _import_in_thread(during)
        assert not waiter.wait(_BLOCKED_S), (
            "fast path taken for a module that became ready during an in-flight import"
        )
    finally:
        release.set()
        slow.join(_JOIN_S)
    assert waiter.wait(_JOIN_S)


def test_a_first_import_waits_for_its_package_lock(modules: Callable[..., str]) -> None:
    name = modules("VALUE = 1\n")
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with hi._package(name).lock:
            held.set()
            release.wait(_JOIN_S)

    holder = _run_in_thread(hold)
    assert held.wait(_JOIN_S)
    done = _import_in_thread(name)
    assert not done.wait(_BLOCKED_S), "a not-yet-imported module skipped the lock"
    release.set()
    assert done.wait(_JOIN_S)
    holder.join(_JOIN_S)


def test_the_lock_set_covers_the_dependency_closure(
    modules: Callable[..., str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A first import also takes the locks of the packages it will initialise,
    so a first import of one of THOSE waits for it."""
    dep = modules("VALUE = 1\n")
    user = f"qz_hvi_user_{uuid.uuid4().hex[:8]}"
    monkeypatch.setitem(hi._DEPS, user, frozenset({user, dep}))
    _, release, slow = _blocked_slow_path(user)
    try:
        waiter = _import_in_thread(dep)
        assert not waiter.wait(_BLOCKED_S), (
            "a first import of a package an in-flight import initialises skipped its lock"
        )
    finally:
        release.set()
        slow.join(_JOIN_S)
    assert waiter.wait(_JOIN_S)


def test_real_dependency_closures_overlap_exactly_where_packages_are_shared() -> None:
    def locks(*mods: str) -> set[str]:
        return set(hi._lock_names(mods))

    assert "matplotlib" in locks("quantized.calc.figure_map") & locks("matplotlib.mathtext")
    names = hi._lock_names(["quantized.calc.figure_map"])
    assert names == sorted(names)  # the canonical acquisition order
    # An already-imported plain (non-package) dependency has nothing left to
    # initialise and is left out -- unless it is itself what was asked for.
    importlib.import_module("typing_extensions")
    assert "typing_extensions" in hi._DEPS["quantized"]
    assert "typing_extensions" not in names
    assert "typing_extensions" in locks("typing_extensions")
    for lib in ("lifelines", "statsmodels"):
        pytest.importorskip(lib)
    assert {"pandas", "scipy"} <= locks("lifelines") & locks("statsmodels.api")
    unrelated = locks("win32com.client") | locks("webview")
    assert not unrelated & (locks("matplotlib.mathtext") | locks("quantized.calc.figure"))


def test_fast_path_rechecks_the_generation_after_its_readiness_checks(
    modules: Callable[..., str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A slow path of the same package that enters while the fast path is
    part-way through its (non-atomic) checks must send it to the slow path."""
    pkg = modules("", package=True)
    ready = modules("X = 1\n", sub=pkg)
    importlib.import_module(ready)
    real_ready = hi.module_ready
    triggered: list[tuple[threading.Event, threading.Thread]] = []

    def racing_module_ready(name: str) -> bool:
        if not triggered:  # once: a slow path enters mid-check, then we answer
            triggered.append((threading.Event(), threading.Thread()))
            _, release, thread = _blocked_slow_path(f"{pkg}.absent_{uuid.uuid4().hex[:8]}")
            triggered[0] = (release, thread)
        return real_ready(name)

    monkeypatch.setattr(hi, "module_ready", racing_module_ready)
    try:
        assert hi._fast_path_ok((ready,)) is False
    finally:
        release, thread = triggered[0]
        release.set()
        thread.join(_JOIN_S)
    assert hi._fast_path_ok((ready,)) is True  # quiescent again


def test_timeout_raises_a_dedicated_error_and_releases_what_it_took(
    modules: Callable[..., str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    first, second = modules("A = 1\n"), modules("B = 1\n")
    # One import needing BOTH packages; the later one (sorted) is held.
    later = max(first, second)
    monkeypatch.setitem(hi._DEPS, min(first, second), frozenset({first, second}))
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with hi._package(later).lock:
            held.set()
            release.wait(_JOIN_S)

    holder = _run_in_thread(hold)
    assert held.wait(_JOIN_S)
    monkeypatch.setattr(hi, "HEAVY_IMPORT_TIMEOUT_S", 0.2)
    try:
        start = time.monotonic()
        with pytest.raises(hi.HeavyImportTimeout, match="retry later"):
            hi.heavy_import(min(first, second))
        assert time.monotonic() - start < _JOIN_S
        # The earlier lock it DID take was released on the way out.
        assert _free_elsewhere(hi._package(min(first, second)).lock)
    finally:
        release.set()
        holder.join(_JOIN_S)


def test_while_waiting_keeps_a_queued_import_cancellable(modules: Callable[..., str]) -> None:
    name = modules("VALUE = 1\n")
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with hi._package(name).lock:
            held.set()
            release.wait(_JOIN_S)

    holder = _run_in_thread(hold)
    assert held.wait(_JOIN_S)
    calls: list[float] = []

    class Cancelled(Exception):
        pass

    def waiting() -> None:
        calls.append(time.monotonic())
        if len(calls) >= 2:
            raise Cancelled

    try:
        start = time.monotonic()
        with pytest.raises(Cancelled):
            hi.heavy_import(name, while_waiting=waiting)
        assert time.monotonic() - start < 5 * hi.WAIT_SLICE_S
        assert name not in sys.modules
    finally:
        release.set()
        holder.join(_JOIN_S)


def test_seeded_dream_stays_cancellable_while_its_bumps_import_waits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pytest.importorskip("bumps")
    from quantized.calc import dream_seed

    monkeypatch.setattr(hi, "_fast_path_ok", lambda modules: False)  # force the slow path
    monkeypatch.setattr(hi, "HEAVY_IMPORT_TIMEOUT_S", 5.0)
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with hi._package("bumps").lock:
            held.set()
            release.wait(_JOIN_S)

    holder = _run_in_thread(hold)
    assert held.wait(_JOIN_S)

    def cancel() -> None:
        raise dream_seed.DreamCancelled("cancelled")

    try:
        start = time.monotonic()
        with pytest.raises(dream_seed.DreamCancelled), dream_seed.seeded_dream(
            None, while_waiting=cancel,
        ):
            pass
        assert time.monotonic() - start < 2.0
    finally:
        release.set()
        holder.join(_JOIN_S)


def test_a_missing_module_is_remembered_and_probes_never_contend(
    modules: Callable[..., str],
) -> None:
    missing = f"qz_hvi_absent_{uuid.uuid4().hex[:12]}"
    with pytest.raises(ModuleNotFoundError):
        hi.heavy_import(f"{missing}.sub")  # the PARENT is what is missing
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with hi._package(missing).lock:
            held.set()
            release.wait(_JOIN_S)

    holder = _run_in_thread(hold)
    assert held.wait(_JOIN_S)
    outcome: list[BaseException] = []

    def probe() -> None:
        try:
            hi.heavy_import(missing)
        except ModuleNotFoundError as exc:
            outcome.append(exc)

    try:
        finished = threading.Event()
        _run_in_thread(lambda: (probe(), finished.set()) and None)
        assert finished.wait(_BLOCKED_S), "a known-missing probe queued on the lock"
        assert outcome and outcome[0].name == missing
    finally:
        release.set()
        holder.join(_JOIN_S)
    # Appearing later (a plugin, a test's fake) is honoured, not shadowed.
    fake = _probe(missing)
    try:
        assert hi.heavy_import(missing) is fake
    finally:
        sys.modules.pop(missing, None)


def test_negative_cache_skips_blocks_and_transitive_misses(
    modules: Callable[..., str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    blocked = modules("VALUE = 1\n")
    monkeypatch.setitem(sys.modules, blocked, None)  # how tests fake "absent"
    with pytest.raises(ModuleNotFoundError):
        hi.heavy_import(blocked)
    assert blocked not in hi._MISSING
    inner = f"qz_hvi_absent_{uuid.uuid4().hex[:12]}"
    outer = modules(f"import {inner}\n")  # present, but ITS dependency is not
    with pytest.raises(ModuleNotFoundError):
        hi.heavy_import(outer)
    assert not hi._MISSING, hi._MISSING
    absent = f"qz_hvi_absent_{uuid.uuid4().hex[:12]}"
    with pytest.raises(ModuleNotFoundError):
        hi.heavy_import(absent)
    assert absent in hi._MISSING
    hi.clear_missing_cache()
    assert not hi._MISSING


def test_module_ready_tracks_initialisation_of_module_and_parents(
    modules: Callable[..., str], tmp_path: Path,
) -> None:
    body = (
        "from quantized.heavy_import import module_ready\n"
        "SELF_READY_DURING_BODY = module_ready(__name__)\n"
        "from . import sub\n"
        "SUB_READY_WHILE_PARENT_INITIALISING = module_ready(__name__ + '.sub')\n"
    )
    pkg = modules(body, package=True)
    (tmp_path / pkg / "sub.py").write_text("X = 1\n", encoding="utf-8")
    importlib.invalidate_caches()
    assert not hi.module_ready(pkg)
    mod = importlib.import_module(pkg)
    assert mod.SELF_READY_DURING_BODY is False
    assert mod.SUB_READY_WHILE_PARENT_INITIALISING is False
    assert hi.module_ready(pkg) and hi.module_ready(f"{pkg}.sub")


def test_reentrant_releases_on_error_and_rejects_no_names(modules: Callable[..., str]) -> None:
    missing = f"qz_hvi_absent_{uuid.uuid4().hex[:12]}"
    with hi.heavy_imports(missing), hi.heavy_imports(missing, f"{missing}_2"):
        pass  # nested on one thread: re-entrant, no self-deadlock
    with pytest.raises(ModuleNotFoundError), hi.heavy_imports(missing):
        importlib.import_module(missing)
    pkg = hi._package(missing)
    assert pkg.active == 0 and pkg.baseline is None
    assert _free_elsewhere(pkg.lock), "the lock stayed held after a failed import"
    with pytest.raises(ValueError):
        with hi.heavy_imports():
            pass
    name = modules("VALUE = 7\n")
    assert hi.heavy_import(name).VALUE == 7
