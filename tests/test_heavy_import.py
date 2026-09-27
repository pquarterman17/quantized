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
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest

from quantized import heavy_import as hi

_JOIN_S = 10.0  # generous: only reached when something is genuinely broken


@pytest.fixture
def modules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[..., str]]:
    """``make(body, package=False) -> unique module name`` on ``sys.path``;
    everything it creates is dropped from ``sys.modules`` afterwards."""
    monkeypatch.syspath_prepend(str(tmp_path))
    made: list[str] = []

    def make(body: str, *, package: bool = False) -> str:
        name = f"qz_hvi_{uuid.uuid4().hex[:12]}"
        target = tmp_path / name / "__init__.py" if package else tmp_path / f"{name}.py"
        target.parent.mkdir(exist_ok=True)
        target.write_text(body, encoding="utf-8")
        made.append(name)
        return name

    importlib.invalidate_caches()
    yield make
    for key in [k for k in sys.modules if k.split(".")[0] in made]:
        del sys.modules[key]


def _probe(name: str) -> ModuleType:
    probe = ModuleType(name)
    sys.modules[name] = probe
    return probe


def _race_two(names: list[str], *, guarded: bool) -> None:
    barrier = threading.Barrier(len(names))
    errors: list[BaseException] = []

    def worker(name: str) -> None:
        try:
            barrier.wait(timeout=_JOIN_S)
            if guarded:
                with hi.heavy_imports(name):
                    importlib.import_module(name)
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


def _overlap_pair(modules: Callable[..., str], wait: float) -> tuple[list[str], ModuleType]:
    """Two modules whose bodies each announce they started, then wait up to
    ``wait`` s for the OTHER's body to start -- ``saw_other`` records whether
    the two bodies were ever executing at the same time."""
    probe = _probe(f"qz_hvi_probe_{uuid.uuid4().hex[:12]}")
    probe.started = {"a": threading.Event(), "b": threading.Event()}
    probe.saw_other = {}
    names = [
        modules(_OVERLAP_BODY.format(probe=probe.__name__, me=me, other=other, wait=wait))
        for me, other in (("a", "b"), ("b", "a"))
    ]
    return names, probe


def test_guarded_first_imports_of_different_modules_never_overlap(
    modules: Callable[..., str],
) -> None:
    names, probe = _overlap_pair(modules, wait=0.3)
    try:
        _race_two(names, guarded=True)
        # Whichever body ran first waited out its 0.3 s alone (the other was
        # queued on the lock); the second found the first already done.
        assert sorted(probe.saw_other.values()) == [False, True], probe.saw_other
    finally:
        sys.modules.pop(probe.__name__, None)


def test_unguarded_control_the_probe_does_detect_overlap(modules: Callable[..., str]) -> None:
    """Without the helper the same two bodies DO run concurrently -- proof the
    probe above can see an overlap, so its ``[False, True]`` is meaningful."""
    names, probe = _overlap_pair(modules, wait=_JOIN_S)
    try:
        _race_two(names, guarded=False)
        assert probe.saw_other == {"a": True, "b": True}, probe.saw_other
    finally:
        sys.modules.pop(probe.__name__, None)


def _run_in_thread(fn: Callable[[], None]) -> threading.Thread:
    t = threading.Thread(target=fn, daemon=True)
    t.start()
    return t


def test_fast_path_does_not_touch_the_lock_once_ready() -> None:
    importlib.import_module("email.mime.text")  # make sure both are already imported
    importlib.import_module("json")
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with hi.HEAVY_IMPORT_LOCK:
            held.set()
            release.wait(_JOIN_S)

    holder = _run_in_thread(hold)
    try:
        assert held.wait(_JOIN_S)
        done = threading.Event()

        def fast() -> None:
            with hi.heavy_imports("json", "email.mime.text"):
                import email.mime.text  # noqa: F401
                import json  # noqa: F401
            done.set()

        _run_in_thread(fast)
        assert done.wait(_JOIN_S), "an already-imported module queued behind the lock"
    finally:
        release.set()
        holder.join(_JOIN_S)


def test_a_first_import_waits_for_the_lock(modules: Callable[..., str]) -> None:
    name = modules("VALUE = 1\n")
    held, release, done = threading.Event(), threading.Event(), threading.Event()

    def hold() -> None:
        with hi.HEAVY_IMPORT_LOCK:
            held.set()
            release.wait(_JOIN_S)

    holder = _run_in_thread(hold)
    assert held.wait(_JOIN_S)

    def first() -> None:
        with hi.heavy_imports(name):
            importlib.import_module(name)
        done.set()

    _run_in_thread(first)
    assert not done.wait(0.2), "a not-yet-imported module skipped the lock"
    release.set()
    assert done.wait(_JOIN_S)
    holder.join(_JOIN_S)


def test_an_in_progress_guarded_import_disables_the_fast_path() -> None:
    """While any thread is inside a guarded (slow-path) block, even an
    already-imported module waits: it could depend on a sibling that block
    is still half-way through initialising."""
    inside, release, done = threading.Event(), threading.Event(), threading.Event()

    def slow() -> None:
        with hi.heavy_imports(f"qz_hvi_absent_{uuid.uuid4().hex[:12]}"):
            inside.set()
            release.wait(_JOIN_S)

    slow_thread = _run_in_thread(slow)
    assert inside.wait(_JOIN_S)

    importlib.import_module("json")

    def ready() -> None:
        with hi.heavy_imports("json"):
            import json  # noqa: F401
        done.set()

    _run_in_thread(ready)
    assert not done.wait(0.2), "fast path taken while a guarded import was in progress"
    release.set()
    assert done.wait(_JOIN_S)
    slow_thread.join(_JOIN_S)


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
    with hi.heavy_imports(missing), hi.heavy_imports(f"{missing}_2"):
        pass  # nested on one thread: re-entrant, no self-deadlock
    with pytest.raises(ModuleNotFoundError), hi.heavy_imports(missing):
        importlib.import_module(missing)
    assert hi._in_progress == 0
    acquired: list[bool] = []

    def probe_lock() -> None:
        acquired.append(hi.HEAVY_IMPORT_LOCK.acquire(timeout=_JOIN_S))
        if acquired[-1]:
            hi.HEAVY_IMPORT_LOCK.release()

    _run_in_thread(probe_lock).join(_JOIN_S)
    assert acquired == [True], "the lock stayed held after a failed import"
    with pytest.raises(ValueError):
        with hi.heavy_imports():
            pass
    name = modules("VALUE = 7\n")
    assert hi.heavy_import(name).VALUE == 7
