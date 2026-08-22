"""`desktop_project_lock_write.write_holding_token` (R1 fix) — see that
module's doc and ``plans/POST_SPRINT_INDEPENDENT_REVIEW.md``'s R1 section
for the design this closes.

RED-FIRST EVIDENCE, two kinds:

1. `test_two_real_processes_a_concurrent_takeover_never_lands_mid_write`
   forces a REAL second OS process to attempt a takeover WHILE a writer
   holds the OS lock inside `write_fn`, and proves (via wall-clock-ordered
   log lines, not sampling) that the takeover cannot complete until the
   write has — the exact property `token_still_valid`'s verify-then-release
   shape did NOT have. It also proves the old, now-stale token is refused
   for a follow-up write afterward: the "displaced writer never lands"
   half of the acceptance criterion.
2. `test_refresh_spuriously_loses_a_healthy_lock_under_too_small_a_retry_
   budget` and `test_refresh_waits_out_a_slow_write_under_the_real_budget`
   force the SAME contention scenario (a real second thread genuinely
   holding the OS lock, synchronized via an `Event`, not a raw sleep) once
   against an artificially small retry budget (reproducing the bug a too-
   small budget causes) and once against the module's actual, current
   budget (proving it is large enough) — the item-3 contention-budget
   evidence.
"""

from __future__ import annotations

import json
import multiprocessing
import multiprocessing.synchronize
import threading
import time
from pathlib import Path

import pytest

import quantized.desktop_project_lock as lockmod
from quantized.desktop_project_lock import LockRecord, UnverifiableLock, acquire, refresh
from quantized.desktop_project_lock_write import LockLost, LockVerified, write_holding_token


def _project(tmp_path: Path) -> str:
    p = tmp_path / "workspace.dwk"
    body = '{"format": "quantized-workspace", "version": 4, "datasets": []}'
    p.write_text(body, encoding="utf-8")
    return str(p)


# -- basic contract -----------------------------------------------------


def test_write_holding_token_runs_write_fn_and_returns_its_result(tmp_path: Path) -> None:
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)

    calls = []

    def _write_fn() -> str:
        calls.append(1)
        Path(path).write_text("replaced", encoding="utf-8")
        return "done"

    result = write_holding_token(path, rec.token, _write_fn)
    assert isinstance(result, LockVerified)
    assert result.result == "done"
    assert calls == [1]
    assert Path(path).read_text(encoding="utf-8") == "replaced"


def test_write_holding_token_requires_a_non_empty_token(tmp_path: Path) -> None:
    """Empty/None token is `desktop_bridge.py`'s legacy no-lock path's job
    to route around this function entirely — calling this with one is a
    caller bug, not a runtime condition to degrade for."""
    path = _project(tmp_path)
    try:
        write_holding_token(path, "", lambda: None)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for an empty token")


# -- (ii) absent lock + non-empty token refuses --------------------------


def test_absent_lock_with_a_non_empty_token_refuses_write_fn_never_called(
    tmp_path: Path,
) -> None:
    """THE defect (b) fix: an absent lock file with a NON-EMPTY supplied
    token means the caller's claimed ownership is unverifiable (their lock
    was released or replaced, or never existed) — refuse, never "nothing
    to check against, proceed"."""
    path = _project(tmp_path)
    calls = []
    result = write_holding_token(path, "some-token-nobody-ever-issued", lambda: calls.append(1))
    assert isinstance(result, LockLost)
    assert result.record is None
    assert calls == []
    assert Path(path).read_text(encoding="utf-8") != ""  # untouched original content
    assert "datasets" in Path(path).read_text(encoding="utf-8")


def test_a_mismatched_token_refuses_and_reports_the_current_holder(tmp_path: Path) -> None:
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)
    calls = []
    result = write_holding_token(path, "not-the-real-token", lambda: calls.append(1))
    assert isinstance(result, LockLost)
    assert isinstance(result.record, LockRecord)
    assert result.record.token == rec.token
    assert calls == []


# -- (iv) UnverifiableLock refuses ----------------------------------------


def test_a_corrupt_lock_file_refuses_write_fn_never_called(tmp_path: Path) -> None:
    path = _project(tmp_path)
    Path(path + ".lock").write_text("not json at all", encoding="utf-8")
    calls = []
    result = write_holding_token(path, "any-token", lambda: calls.append(1))
    assert isinstance(result, LockLost)
    assert isinstance(result.record, UnverifiableLock)
    assert calls == []


# -- (v) tombstone = absent semantics -------------------------------------


def test_a_release_tombstone_refuses_the_pre_release_token(tmp_path: Path) -> None:
    """A release TOMBSTONE (`{"released": true}`, written on Windows because
    the releasing process cannot delete a file it still holds open — see
    `desktop_project_lock.release`'s doc) parses as `None`, IDENTICAL to
    "no lock file" (`_parse_record`'s documented absent-lock semantics).
    Written directly here so the assertion holds on every OS this test
    runs on, not just Windows — the tombstone CONTENT is what matters, not
    which platform produced it."""
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)
    Path(path + ".lock").write_text(json.dumps({"version": 1, "released": True}), encoding="utf-8")
    calls = []
    result = write_holding_token(path, rec.token, lambda: calls.append(1))
    assert isinstance(result, LockLost)
    assert result.record is None
    assert calls == []


# -- (i) real two-process race: a concurrent takeover must never land ----
# mid-write, and the displaced (now-stale) token must never write afterward.


def _writer_proc(
    path: str,
    token: str,
    signal_event: multiprocessing.synchronize.Event,
    log_path: str,
    hold_s: float,
) -> None:
    import time as _time

    from quantized.desktop_project_lock_write import LockVerified as _LockVerified
    from quantized.desktop_project_lock_write import write_holding_token as _write_holding_token

    def _log(label: str) -> None:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"{_time.time():.6f} {label}\n")

    def _slow_write() -> None:
        _log("write-start")
        signal_event.set()
        _time.sleep(hold_s)
        with open(path, "w", encoding="utf-8") as f:
            f.write("from-writer")
        _log("write-end")

    result = _write_holding_token(path, token, _slow_write)
    _log(f"result-{'ok' if isinstance(result, _LockVerified) else 'lost'}")


def _taker_proc(
    path: str,
    expected_token: str,
    signal_event: multiprocessing.synchronize.Event,
    log_path: str,
) -> None:
    import time as _time

    import quantized.desktop_project_lock as _lockmod

    assert signal_event.wait(timeout=10.0)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"{_time.time():.6f} takeover-start\n")
    ok, _record = _lockmod.take_over(path, expected_token, "instance-taker", now=_time.time())
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"{_time.time():.6f} takeover-end-{'ok' if ok else 'fail'}\n")


def test_two_real_processes_a_concurrent_takeover_never_lands_mid_write(tmp_path: Path) -> None:
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-writer", now=time.time(), ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)
    token = rec.token

    log_path = str(tmp_path / "race.log")
    Path(log_path).write_text("", encoding="utf-8")

    ctx = multiprocessing.get_context("spawn")
    signal_event = ctx.Event()
    hold_s = 0.4

    p_writer = ctx.Process(target=_writer_proc, args=(path, token, signal_event, log_path, hold_s))
    p_taker = ctx.Process(target=_taker_proc, args=(path, token, signal_event, log_path))
    p_writer.start()
    p_taker.start()
    p_writer.join(timeout=20.0)
    p_taker.join(timeout=20.0)
    assert not p_writer.is_alive() and not p_taker.is_alive(), "a worker hung"
    assert p_writer.exitcode == 0, f"writer crashed (exitcode {p_writer.exitcode})"
    assert p_taker.exitcode == 0, f"taker crashed (exitcode {p_taker.exitcode})"

    ts: dict[str, float] = {}
    for line in Path(log_path).read_text(encoding="utf-8").splitlines():
        time_str, label = line.split(maxsplit=1)
        ts[label] = float(time_str)

    for label in ("write-start", "write-end", "result-ok", "takeover-start", "takeover-end-ok"):
        assert label in ts, f"missing log line {label!r}: {ts}"

    # The taker only ATTEMPTS the takeover once it is certain the writer
    # already holds the OS lock (the signal fires from inside `write_fn`,
    # after `write_holding_token` has already verified the token and taken
    # the lock) — so this is a forced interleaving, not a sampled one.
    assert ts["takeover-start"] >= ts["write-start"]
    # THE property: the takeover cannot COMPLETE until the writer has
    # released the lock, which only happens after `write_fn` (the real
    # project-file replace) has finished — proving the lock is held
    # through the entire write, not just an initial verify-then-release.
    assert ts["takeover-end-ok"] >= ts["write-end"], (
        "a concurrent takeover completed before the in-flight write finished "
        "— the OS lock was not held through the write"
    )
    # The writer's own write_fn ran to completion and landed.
    assert ts["result-ok"] >= ts["write-end"]
    assert Path(path).read_text(encoding="utf-8") == "from-writer"

    # "Displaced writer's os.replace must never land": the writer's token is
    # now stale (the taker holds a fresh one) — a follow-up write attempt
    # with the OLD token must refuse, and must not touch the file.
    calls: list[int] = []

    def _stale_write() -> None:
        calls.append(1)
        Path(path).write_text("stale", encoding="utf-8")

    stale_result = write_holding_token(path, token, _stale_write)
    assert isinstance(stale_result, LockLost)
    assert calls == []
    assert Path(path).read_text(encoding="utf-8") == "from-writer"


# -- (vi) contention budget: a slow in-flight write must not spuriously ---
# fail a concurrent refresh/heartbeat.


def _hold_the_lock_in_a_thread(
    path: str, token: str, started: threading.Event, release: threading.Event
) -> tuple[threading.Thread, dict[str, object]]:
    outcome: dict[str, object] = {}

    def _slow_write() -> None:
        started.set()
        release.wait(timeout=10.0)

    def _run() -> None:
        outcome["result"] = write_holding_token(path, token, _slow_write)

    t = threading.Thread(target=_run)
    t.start()
    assert started.wait(timeout=2.0), "writer thread never acquired the lock"
    return t, outcome


def test_refresh_spuriously_loses_a_healthy_lock_under_too_small_a_retry_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RED: reproduces the item-3 bug directly — with a retry budget too
    small to outlast an in-flight write, a perfectly healthy holder's own
    heartbeat reports the lock lost while its OWN save is still running."""
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)

    started = threading.Event()
    release = threading.Event()
    monkeypatch.setattr(lockmod, "_LOCK_RETRY_ATTEMPTS", 5)
    monkeypatch.setattr(lockmod, "_LOCK_RETRY_DELAY_S", 0.01)
    writer_thread, outcome = _hold_the_lock_in_a_thread(path, rec.token, started, release)
    try:
        # The writer is holding the lock (confirmed via `started`) and will
        # not release for a long time — this refresh call is FORCED to hit
        # the (tiny) retry budget's ceiling before the writer ever lets go.
        ok, current = refresh(path, rec.token, now=1030.0)
        assert ok is False
        assert isinstance(current, UnverifiableLock)
    finally:
        release.set()
        writer_thread.join(timeout=5.0)
    assert isinstance(outcome["result"], LockVerified)  # the write itself was fine


def test_refresh_waits_out_a_slow_write_under_the_real_budget(tmp_path: Path) -> None:
    """FIX: forces the identical contention (a real thread genuinely
    holding the OS lock, synchronized via an `Event`) against the module's
    ACTUAL, current retry budget rather than a hardcoded number, and shows
    a concurrent refresh now waits it out and succeeds instead of
    spuriously reporting the lock lost."""
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)

    started = threading.Event()
    release = threading.Event()
    writer_thread, outcome = _hold_the_lock_in_a_thread(path, rec.token, started, release)
    # Release the lock partway through — DELIBERATELY past the OLD ~1s
    # budget this module used to have (100 attempts * 10ms), so this test
    # would fail against that prior budget and only passes because the
    # budget was actually enlarged (read from the module rather than
    # hardcoded here, so this stays honest about testing the real value).
    old_budget_s = 100 * 0.01  # the pre-R1 `_LOCK_RETRY_ATTEMPTS * _LOCK_RETRY_DELAY_S`
    hold_s = 1.5
    assert hold_s > old_budget_s, "must exceed the OLD budget to prove this isn't vacuous"
    assert hold_s < lockmod._LOCK_RETRY_ATTEMPTS * lockmod._LOCK_RETRY_DELAY_S, (
        "must stay under the module's CURRENT budget or this test would (correctly) fail"
    )
    timer = threading.Timer(hold_s, release.set)
    timer.start()
    try:
        ok, current = refresh(path, rec.token, now=1030.0)
    finally:
        writer_thread.join(timeout=10.0)
        timer.join(timeout=1.0)
    assert ok is True, current
    assert isinstance(current, LockRecord)
    assert current.heartbeat_at == 1030.0
    assert isinstance(outcome["result"], LockVerified)
