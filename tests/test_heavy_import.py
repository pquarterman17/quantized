"""In-process locking semantics of ``quantized.heavy_import`` (BUG-032).

Fast and deterministic: every module imported here is a throwaway file in
``tmp_path`` with a per-test unique name, so ``sys.modules`` genuinely does
not hold it yet, and the module bodies coordinate through ``threading.Event``s
rather than sleeps. The real-library race is forced separately, in a fresh
interpreter, by ``test_heavy_import_cold_race.py``.
"""

from __future__ import annotations

import importlib
import importlib.util
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
_LOCK = hi.HEAVY_IMPORT_LOCK


@pytest.fixture
def modules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[..., str]]:
    """``make(body, package=False, sub=None, files=None) -> unique module
    name`` on ``sys.path`` (``sub`` names a submodule of an existing package
    made here; ``files`` are extra ``{filename: source}`` written into a new
    package first); everything it creates is dropped from ``sys.modules``
    afterwards."""
    monkeypatch.syspath_prepend(str(tmp_path))
    made: list[str] = []

    def make(
        body: str, *, package: bool = False, sub: str | None = None,
        files: dict[str, str] | None = None,
    ) -> str:
        if sub is not None:
            leaf = f"m_{uuid.uuid4().hex[:8]}"
            (tmp_path / sub / f"{leaf}.py").write_text(body, encoding="utf-8")
            importlib.invalidate_caches()
            return f"{sub}.{leaf}"
        name = f"qz_hvi_{uuid.uuid4().hex[:12]}"
        target = tmp_path / name / "__init__.py" if package else tmp_path / f"{name}.py"
        target.parent.mkdir(exist_ok=True)
        for filename, source in (files or {}).items():
            (target.parent / filename).write_text(source, encoding="utf-8")
        target.write_text(body, encoding="utf-8")
        made.append(name)
        importlib.invalidate_caches()
        return name

    yield make
    for key in [k for k in sys.modules if k.split(".")[0] in made]:
        del sys.modules[key]


def _run_in_thread(fn: Callable[[], None]) -> threading.Thread:
    t = threading.Thread(target=fn, daemon=True)
    t.start()
    return t


def _probe(**attrs: object) -> ModuleType:
    """A coordination module the throwaway module bodies can reach through
    ``sys.modules`` (dropped again by :func:`_drop`)."""
    probe = ModuleType(f"qz_hvi_probe_{uuid.uuid4().hex[:12]}")
    probe.__dict__.update(attrs)
    sys.modules[probe.__name__] = probe
    return probe


def _drop(probe: ModuleType) -> None:
    sys.modules.pop(probe.__name__, None)


def _free_elsewhere() -> bool:
    """Whether ANOTHER thread can take the lock (an RLock is always free to
    its owner, so asking from the calling thread proves nothing)."""
    got: list[bool] = []

    def take() -> None:
        got.append(_LOCK.acquire(timeout=1.0))
        if got[-1]:
            _LOCK.release()

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


_SLOW_BODY = """
import sys
probe = sys.modules[{probe!r}]
{before}
probe.inside.set()
probe.release.wait({wait})
"""


class _SlowImport:
    """A thread parked INSIDE a genuine first import (``heavy_import(name)``,
    slow path, holding the lock) whose module body waits for :meth:`finish`."""

    def __init__(
        self, modules: Callable[..., str], *, package: bool = False, before: str = "",
        files: dict[str, str] | None = None,
    ) -> None:
        self.probe = _probe(inside=threading.Event(), release=threading.Event())
        body = _SLOW_BODY.format(probe=self.probe.__name__, before=before, wait=_JOIN_S)
        self.name = modules(body, package=package, files=files)
        self.thread = _run_in_thread(lambda: hi.heavy_import(self.name) and None)
        assert self.probe.inside.wait(_JOIN_S), "the slow first import never started"

    def finish(self) -> None:
        self.probe.release.set()
        self.thread.join(_JOIN_S)
        _drop(self.probe)


@pytest.fixture
def slow_imports() -> Iterator[list[_SlowImport]]:
    started: list[_SlowImport] = []
    yield started
    for slow in started:
        slow.finish()


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
    probe = _probe(started={"a": threading.Event(), "b": threading.Event()}, saw_other={})
    pkg = modules("", package=True) if same_package else None
    names = [
        modules(_OVERLAP_BODY.format(probe=probe.__name__, me=me, other=other, wait=wait), sub=pkg)
        for me, other in (("a", "b"), ("b", "a"))
    ]
    return names, probe


# --- (c) first imports are serialised ---------------------------------------


@pytest.mark.parametrize("same_package", [True, False], ids=["same-package", "unrelated"])
def test_concurrent_first_imports_never_overlap(
    modules: Callable[..., str], same_package: bool,
) -> None:
    """One lock for every first import: the package a first import will reach
    cannot be known up front, so even apparently unrelated ones queue."""
    names, probe = _overlap_pair(modules, wait=_BLOCKED_S, same_package=same_package)
    try:
        _race(names, guarded=True)
        # Whichever body ran first waited out its window alone (the other
        # was queued on the lock); the second found it already done.
        assert sorted(probe.saw_other.values()) == [False, True], probe.saw_other
    finally:
        _drop(probe)


def test_unguarded_control_the_probe_does_detect_overlap(modules: Callable[..., str]) -> None:
    """Without the helper the same two bodies DO run concurrently -- proof the
    probe above can see an overlap, so its ``[False, True]`` is meaningful."""
    names, probe = _overlap_pair(modules, wait=_JOIN_S, same_package=True)
    try:
        _race(names, guarded=False)
        assert probe.saw_other == {"a": True, "b": True}, probe.saw_other
    finally:
        _drop(probe)


def test_a_first_import_waits_for_the_lock(
    modules: Callable[..., str], slow_imports: list[_SlowImport],
) -> None:
    slow = _SlowImport(modules)
    slow_imports.append(slow)
    assert not _free_elsewhere(), "the slow first import does not hold the lock"
    waiter = _import_in_thread(modules("VALUE = 1\n"))
    assert not waiter.wait(_BLOCKED_S), "a not-yet-imported module skipped the lock"
    slow.finish()
    assert waiter.wait(_JOIN_S)


# --- (a) the fast path is readiness only -------------------------------------


def test_an_in_flight_first_import_never_slows_an_already_loaded_module(
    modules: Callable[..., str], slow_imports: list[_SlowImport],
) -> None:
    """A slow first import (a hanging optional dependency, matplotlib's font
    cache being built) holds the lock; an already-loaded module -- plain or
    a submodule of a loaded package -- still goes straight through (renders
    holding the render lock take exactly this path)."""
    loaded = modules("VALUE = 1\n")
    pkg = modules("", package=True)
    loaded_sub = modules("X = 1\n", sub=pkg)
    importlib.import_module(loaded)
    importlib.import_module(loaded_sub)
    slow = _SlowImport(modules)
    slow_imports.append(slow)
    assert not _free_elsewhere()
    for name in (loaded, loaded_sub):
        assert _import_in_thread(name).wait(_JOIN_S / 2), (
            f"already-loaded {name} queued behind an unrelated in-flight import"
        )
    with hi.heavy_imports(loaded, loaded_sub):  # and on this thread
        pass


# --- (b) readiness covers the parent / top-level package ---------------------


def test_a_module_whose_package_is_still_initialising_takes_the_slow_path(
    modules: Callable[..., str], slow_imports: list[_SlowImport],
) -> None:
    """``pkg.sub`` is fully executed while ``pkg/__init__`` (which imported it)
    is still running -- the ``matplotlib.transforms`` shape. It must wait for
    the package, not fast-path past it."""
    slow = _SlowImport(
        modules, package=True, before="from . import sub", files={"sub.py": "X = 1\n"},
    )
    slow_imports.append(slow)
    sub = f"{slow.name}.sub"
    assert sub in sys.modules and not hi.module_ready(sub)
    waiter = _import_in_thread(sub)
    assert not waiter.wait(_BLOCKED_S), "fast path taken while the package was initialising"
    slow.finish()
    assert waiter.wait(_JOIN_S)
    assert hi.module_ready(sub)


def test_readiness_is_rechecked_after_acquiring(
    modules: Callable[..., str], slow_imports: list[_SlowImport],
) -> None:
    """A caller queued behind another thread's first import of the SAME module
    finds it done once it gets the lock, and lets go before its body."""
    slow = _SlowImport(modules)
    slow_imports.append(slow)
    held_during_body: list[bool] = []
    done = threading.Event()

    def second() -> None:
        with hi.heavy_imports(slow.name):
            held_during_body.append(not _free_elsewhere())
        done.set()

    _run_in_thread(second)
    assert not done.wait(_BLOCKED_S)
    slow.finish()
    assert done.wait(_JOIN_S)
    assert held_during_body == [False], "the lock was still held for a finished import"


# --- (d) cooperative waiting -------------------------------------------------


def _hold_lock() -> tuple[threading.Event, threading.Thread]:
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with _LOCK:
            held.set()
            release.wait(_JOIN_S)

    thread = _run_in_thread(hold)
    assert held.wait(_JOIN_S)
    return release, thread


def test_while_waiting_is_called_between_slices_and_its_exception_propagates(
    modules: Callable[..., str],
) -> None:
    name = modules("VALUE = 1\n")
    release, holder = _hold_lock()
    calls: list[float] = []

    class Cancelled(Exception):
        pass

    def waiting() -> None:
        calls.append(time.monotonic())
        if len(calls) >= 3:
            raise Cancelled

    try:
        start = time.monotonic()
        with pytest.raises(Cancelled):
            hi.heavy_import(name, while_waiting=waiting)
        assert len(calls) == 3
        assert calls[0] - start >= 0.8 * hi.WAIT_SLICE_S  # after a slice, not before
        assert time.monotonic() - start < _JOIN_S / 2  # cancelled, not released
        assert name not in sys.modules
    finally:
        release.set()
        holder.join(_JOIN_S)
    assert _free_elsewhere()


def test_seeded_dream_stays_cancellable_while_its_bumps_import_waits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pytest.importorskip("bumps")
    from quantized.calc import dream_seed

    monkeypatch.setattr(hi, "_ready", lambda modules: False)  # force the slow path
    release, holder = _hold_lock()

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


# --- (e) missing modules: find_spec before the lock, nothing cached ----------


def _outcome_in_thread(fn: Callable[[], object]) -> tuple[threading.Event, list[BaseException]]:
    finished, errors = threading.Event(), []

    def run() -> None:
        try:
            fn()
        except BaseException as exc:  # noqa: BLE001 - inspected by the caller
            errors.append(exc)
        finished.set()

    _run_in_thread(run)
    return finished, errors


def test_a_missing_module_never_touches_the_lock_and_a_later_install_is_found(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.syspath_prepend(str(tmp_path))
    missing = f"qz_hvi_absent_{uuid.uuid4().hex[:12]}"
    blocked = f"qz_hvi_blocked_{uuid.uuid4().hex[:12]}"
    monkeypatch.setitem(sys.modules, blocked, None)  # how tests fake "absent"
    release, holder = _hold_lock()
    try:
        for name, top in ((missing, missing), (f"{missing}.sub", missing), (blocked, blocked)):
            finished, errors = _outcome_in_thread(lambda n=name: hi.heavy_import(n))
            assert finished.wait(_BLOCKED_S), f"probe for missing {name} queued on the lock"
            assert len(errors) == 1 and isinstance(errors[0], ModuleNotFoundError), errors
            assert errors[0].name == top
    finally:
        release.set()
        holder.join(_JOIN_S)
    # "Installed" while the process runs: found on the very next call.
    (tmp_path / f"{missing}.py").write_text("VALUE = 3\n", encoding="utf-8")
    importlib.invalidate_caches()
    try:
        assert hi.heavy_import(missing).VALUE == 3
    finally:
        sys.modules.pop(missing, None)


def test_a_failing_find_spec_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    name = f"qz_hvi_absent_{uuid.uuid4().hex[:12]}"
    for exc in (ValueError("x.__spec__ is None"), ModuleNotFoundError("parent")):
        def boom(_name: str, _exc: Exception = exc) -> None:
            raise _exc

        monkeypatch.setattr(importlib.util, "find_spec", boom)
        with pytest.raises(ModuleNotFoundError) as info:
            hi.heavy_import(name)
        assert info.value.name == name


# --- building blocks ---------------------------------------------------------


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
    first, second = modules("A = 1\n"), modules("B = 1\n")
    with hi.heavy_imports(first), hi.heavy_imports(first, second):
        pass  # nested slow paths on one thread: re-entrant, no self-deadlock
    assert _free_elsewhere()
    with pytest.raises(RuntimeError), hi.heavy_imports(first):
        raise RuntimeError("body failed")
    assert _free_elsewhere(), "the lock stayed held after a failing body"
    broken = modules(f"import qz_hvi_absent_{uuid.uuid4().hex[:12]}\n")  # present; ITS dep is not
    with pytest.raises(ModuleNotFoundError):
        hi.heavy_import(broken)
    assert _free_elsewhere(), "the lock stayed held after a failed import"
    with pytest.raises(ValueError):
        with hi.heavy_imports():
            pass
    assert hi.heavy_import(modules("VALUE = 7\n")).VALUE == 7
