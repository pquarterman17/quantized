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
2. `test_refresh_reports_contended_not_lost_while_a_save_holds_the_lock`
   forces a real second thread to hold the exclusive OS lock (via
   `write_holding_token`, synchronized on an `Event`, not a raw sleep) for
   LONGER than the modest OS-lock-acquire budget, and shows a concurrent
   `refresh` correctly classifies this as `Contended` — busy right now,
   never lost — rather than `UnverifiableLock` (the code-review finding:
   the first R1 cut's separate, unprotected pre-read inside `refresh`
   would hit a Windows mandatory-lock `PermissionError` in exactly this
   window and misclassify it). `test_project_lock_refresh_maps_contended_
   to_a_non_demoting_soft_success` (in `test_desktop_bridge_lock.py`) is
   the other half: proving the BRIDGE turns that `Contended` into a
   non-demoting response carrying the last genuinely-observed record, not
   a fabricated or null one.
"""

from __future__ import annotations

import json
import multiprocessing
import multiprocessing.synchronize
import threading
import time
from pathlib import Path

from quantized.desktop_project_lock import Contended, LockRecord, UnverifiableLock, acquire, refresh
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


def test_refresh_reports_contended_not_lost_while_a_save_holds_the_lock(tmp_path: Path) -> None:
    """RED-FIRST evidence for the reclassification (code-review finding on
    the first R1 cut): forces a real second thread to hold the exclusive
    OS lock — via `write_holding_token`, the actual production save path,
    not a bare lock-grab — for the DURATION of `refresh`'s entire acquire
    retry budget (the writer only releases once THIS test tells it to, in
    `finally`, so `refresh`'s own bounded retry loop is guaranteed to run
    to completion before returning). The result must be `Contended` — busy
    right now — never `UnverifiableLock` (a real heartbeat lost this
    distinction on the first cut because it pre-read the lock file
    UNPROTECTED before ever reaching the CAS primitive; see `refresh`'s
    and `Contended`'s own docs)."""
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)

    started = threading.Event()
    release = threading.Event()
    writer_thread, outcome = _hold_the_lock_in_a_thread(path, rec.token, started, release)
    try:
        ok, current = refresh(path, rec.token, now=1030.0)
    finally:
        release.set()
        writer_thread.join(timeout=10.0)
    assert ok is False
    assert isinstance(current, Contended), f"expected Contended, got {current!r}"
    assert isinstance(outcome["result"], LockVerified)  # the write itself completed fine


def test_write_holding_token_also_reports_contended_not_unverifiable(tmp_path: Path) -> None:
    """The same reclassification applies to `write_holding_token` itself
    (not just `refresh`): a second, concurrent save attempt that cannot
    even acquire the exclusive OS lock — because a FIRST save already
    holds it — must be told the lock is busy, not that its content is
    corrupt."""
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)

    started = threading.Event()
    release = threading.Event()
    writer_thread, outcome = _hold_the_lock_in_a_thread(path, rec.token, started, release)

    def _never_runs() -> None:
        raise AssertionError("write_fn must never run when the lock could not be acquired")

    try:
        second_result = write_holding_token(path, rec.token, _never_runs)
    finally:
        release.set()
        writer_thread.join(timeout=10.0)
    assert isinstance(second_result, LockLost)
    assert isinstance(second_result.record, Contended), f"expected Contended, got {second_result!r}"
    assert isinstance(outcome["result"], LockVerified)
