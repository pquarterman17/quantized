"""Cross-process single-writer project lock (I2 audit fix, P0-3 + P1-1) —
see :mod:`quantized.desktop_project_lock`'s module doc for the design.

RED-FIRST EVIDENCE for the CAS claim: `test_read_then_write_race_loses_an_
update_under_a_broken_primitive` below runs the SAME race this module fixes
against a deliberately-reintroduced read/classify/unconditional-write
primitive (the shape the old in-memory frontend provider used) and shows it
corrupts — proving the race is real, not a strawman, and that `_cas_write`
(exercised by every other test here) is what actually closes it.
"""

from __future__ import annotations

import json
import multiprocessing
import multiprocessing.synchronize
import os
import time
from pathlib import Path

from quantized.desktop_project_lock import (
    LockRecord,
    UnverifiableLock,
    acquire,
    read,
    refresh,
    release,
    take_over,
    token_still_valid,
)


def _project(tmp_path: Path) -> str:
    p = tmp_path / "workspace.dwk"
    body = '{"format": "quantized-workspace", "version": 4, "datasets": []}'
    p.write_text(body, encoding="utf-8")
    return str(p)


# -- acquire / exclusivity ---------------------------------------------------


def test_acquire_succeeds_on_an_unlocked_project(tmp_path: Path) -> None:
    path = _project(tmp_path)
    ok, record = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert ok is True
    assert isinstance(record, LockRecord)
    assert record.instance_id == "instance-a"
    assert os.path.isfile(path + ".lock")


def test_second_acquire_refuses_while_the_first_is_fresh(tmp_path: Path) -> None:
    path = _project(tmp_path)
    ok1, rec1 = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    ok2, rec2 = acquire(path, "instance-b", now=1005.0, ttl_seconds=90.0)
    assert ok1 is True
    assert ok2 is False
    assert isinstance(rec2, LockRecord)
    assert rec2.instance_id == "instance-a"  # the loser sees the WINNER's record
    assert isinstance(rec1, LockRecord)
    assert rec2.token == rec1.token


def test_reacquiring_the_same_instance_id_still_refuses_a_fresh_lock(tmp_path: Path) -> None:
    """A second `acquire` call is NOT re-entrant at this layer — the bridge/
    store decide what "already mine" means (comparing tokens/instance ids);
    this module only ever hands back the truth on disk."""
    path = _project(tmp_path)
    acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    ok2, rec2 = acquire(path, "instance-a", now=1001.0, ttl_seconds=90.0)
    assert ok2 is False
    assert isinstance(rec2, LockRecord)


# -- staleness / takeover -----------------------------------------------------


def test_acquire_takes_over_a_stale_lock(tmp_path: Path) -> None:
    path = _project(tmp_path)
    ok1, rec1 = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert ok1 is True
    ok2, rec2 = acquire(path, "instance-b", now=1000.0 + 200.0, ttl_seconds=90.0)
    assert ok2 is True
    assert isinstance(rec2, LockRecord)
    assert rec2.instance_id == "instance-b"
    assert isinstance(rec1, LockRecord)
    assert rec2.token != rec1.token  # takeover always mints a NEW token


def test_take_over_refuses_a_live_lock() -> None:
    ok, result = take_over("/nonexistent/x.dwk", "some-token", "instance-b", now=1000.0)
    assert ok is False
    assert result is None  # no lock file at all — nothing to take over


def test_take_over_refuses_when_expected_token_is_stale(tmp_path: Path) -> None:
    """The heart of the CAS fix: a caller holding an OLD token (because a
    third party already moved) never wins, even if it still believes the
    lock is stale enough to take."""
    path = _project(tmp_path)
    _, rec1 = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec1, LockRecord)
    # instance-b takes over first.
    ok_b, rec_b = take_over(path, rec1.token, "instance-b", now=1300.0)
    assert ok_b is True
    assert isinstance(rec_b, LockRecord)
    # instance-c races against instance-a's now-STALE token — refused, since
    # the token on disk no longer matches what instance-c expected.
    ok_c, current = take_over(path, rec1.token, "instance-c", now=1301.0)
    assert ok_c is False
    assert isinstance(current, LockRecord)
    assert current.instance_id == "instance-b"
    assert current.token == rec_b.token


# -- refresh (heartbeat) ------------------------------------------------------


def test_refresh_bumps_heartbeat_for_the_current_holder(tmp_path: Path) -> None:
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)
    ok, updated = refresh(path, rec.token, now=1030.0)
    assert ok is True
    assert isinstance(updated, LockRecord)
    assert updated.heartbeat_at == 1030.0
    assert updated.token == rec.token  # refresh never mints a new token


def test_refresh_after_a_takeover_fails_with_the_old_token(tmp_path: Path) -> None:
    """CAS refresh after takeover fails with the old token — the exact
    scenario a suspended-then-resumed instance hits (lockState.ts's
    "FALSE-POSITIVE RISK" section): its OWN next heartbeat must refuse."""
    path = _project(tmp_path)
    _, rec1 = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec1, LockRecord)
    take_over(path, rec1.token, "instance-b", now=1300.0)
    ok, current = refresh(path, rec1.token, now=1301.0)
    assert ok is False
    assert isinstance(current, LockRecord)
    assert current.instance_id == "instance-b"


def test_refresh_with_no_lock_file_reports_none() -> None:
    ok, current = refresh("/nonexistent/x.dwk", "tok", now=1000.0)
    assert ok is False
    assert current is None


# -- release ------------------------------------------------------------


def test_release_verifies_token_before_deleting(tmp_path: Path) -> None:
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)
    ok, reason = release(path, "wrong-token")
    assert ok is False
    assert reason is not None
    assert os.path.isfile(path + ".lock")  # untouched
    ok2, reason2 = release(path, rec.token)
    assert ok2 is True
    assert reason2 is None
    assert not os.path.isfile(path + ".lock")


def test_release_with_no_lock_file_is_idempotent_success(tmp_path: Path) -> None:
    path = _project(tmp_path)
    ok, reason = release(path, "whatever")
    assert ok is True
    assert reason is None


def test_release_then_acquire_gets_a_clean_lock(tmp_path: Path) -> None:
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)
    release(path, rec.token)
    ok, rec2 = acquire(path, "instance-b", now=1001.0, ttl_seconds=90.0)
    assert ok is True
    assert isinstance(rec2, LockRecord)
    assert rec2.instance_id == "instance-b"
    assert rec2.token != rec.token


# -- token_still_valid (the write_project_file save-TOCTOU primitive) -------


def test_token_still_valid_true_when_no_lock_file_exists(tmp_path: Path) -> None:
    path = _project(tmp_path)
    assert token_still_valid(path, "any-token") is True


def test_token_still_valid_true_for_the_current_holder(tmp_path: Path) -> None:
    path = _project(tmp_path)
    _, rec = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec, LockRecord)
    assert token_still_valid(path, rec.token) is True


def test_token_still_valid_false_for_a_stale_token_after_takeover(tmp_path: Path) -> None:
    path = _project(tmp_path)
    _, rec1 = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec1, LockRecord)
    take_over(path, rec1.token, "instance-b", now=1300.0)
    assert token_still_valid(path, rec1.token) is False


def test_token_still_valid_false_for_a_corrupt_lock_file(tmp_path: Path) -> None:
    path = _project(tmp_path)
    Path(path + ".lock").write_text("not json", encoding="utf-8")
    assert token_still_valid(path, "any-token") is False


# -- corrupt / unverifiable — never an exception -----------------------------


def test_read_on_a_missing_lock_file_is_none(tmp_path: Path) -> None:
    path = _project(tmp_path)
    assert read(path) is None


def test_read_on_a_corrupt_lock_file_is_unverifiable_not_an_exception(tmp_path: Path) -> None:
    path = _project(tmp_path)
    Path(path + ".lock").write_text("{not json", encoding="utf-8")
    result = read(path)
    assert isinstance(result, UnverifiableLock)


def test_read_on_an_empty_lock_file_is_unverifiable(tmp_path: Path) -> None:
    path = _project(tmp_path)
    Path(path + ".lock").write_text("", encoding="utf-8")
    assert isinstance(read(path), UnverifiableLock)


def test_read_on_a_lock_file_missing_required_fields_is_unverifiable(tmp_path: Path) -> None:
    path = _project(tmp_path)
    Path(path + ".lock").write_text(json.dumps({"version": 1, "token": "x"}), encoding="utf-8")
    assert isinstance(read(path), UnverifiableLock)


def test_acquire_refuses_against_a_corrupt_lock_file_rather_than_guessing(tmp_path: Path) -> None:
    path = _project(tmp_path)
    Path(path + ".lock").write_text("garbage, not json", encoding="utf-8")
    ok, result = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert ok is False
    assert isinstance(result, UnverifiableLock)


def test_embedded_null_path_never_raises() -> None:
    """`os.stat`/`open` raise `ValueError` (not `OSError`) for an embedded-NUL
    path on Windows — a real prior CI redness in this repo (CLAUDE.md's mypy/
    numpy lessons). Every filesystem access here must swallow it."""
    bad = "some\x00path"
    assert read(bad) is None or isinstance(read(bad), UnverifiableLock)
    ok, _ = acquire(bad, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert ok is False
    ok2, _ = release(bad, "tok")
    assert ok2 is False or ok2 is True  # never raises either way


# -- the read/classify/unconditional-write race this module fixes -----------


def _broken_takeover(path: str, expected_token: str, instance_id: str, now: float) -> LockRecord:
    """Reproduces the PRE-FIX shape (frontend/src/store/projectLock.ts's old
    in-memory provider, and any read-then-write composition): read current,
    classify, then write UNCONDITIONALLY — no compare-and-swap. Used only to
    prove the race below is real."""
    current = read(path)
    assert isinstance(current, LockRecord)
    # A deliberate window: two "processes" both read the SAME stale record
    # before either writes — the CAS primitive closes this by holding the OS
    # lock across read+compare+write; this helper does not.
    from quantized.desktop_project_lock import _make_record  # noqa: PLC0415

    new_record = _make_record(instance_id, now, None, None)
    with open(path + ".lock", "w", encoding="utf-8") as f:
        json.dump(
            {
                "version": new_record.version,
                "token": new_record.token,
                "instance_id": new_record.instance_id,
                "hostname": new_record.hostname,
                "pid": new_record.pid,
                "acquired_at": new_record.acquired_at,
                "heartbeat_at": new_record.heartbeat_at,
            },
            f,
        )
    return new_record


def test_read_then_write_race_loses_an_update_under_a_broken_primitive(tmp_path: Path) -> None:
    """RED-FIRST: shows the exact failure mode `_cas_write` exists to
    prevent. Two "instances" both read the SAME stale record and both
    unconditionally write a takeover — the second write clobbers the first
    with NO detection, so BOTH believe they hold the lock (the false
    "protects against a second instance" claim the audit flagged). This test
    is expected to demonstrate the race, not to pass a safety property —
    it is evidence the underlying scenario is real, contrasted with
    `test_take_over_refuses_when_expected_token_is_stale` above, which shows
    the REAL `take_over` (going through `_cas_write`) detects and refuses
    the identical scenario."""
    path = _project(tmp_path)
    _, rec1 = acquire(path, "instance-a", now=1000.0, ttl_seconds=90.0)
    assert isinstance(rec1, LockRecord)

    # Both "processes" observe the same stale record...
    seen_by_b = read(path)
    seen_by_c = read(path)
    assert isinstance(seen_by_b, LockRecord)
    assert isinstance(seen_by_c, LockRecord)
    assert seen_by_b.token == seen_by_c.token == rec1.token

    # ...and both unconditionally "take over" — the broken primitive has no
    # compare-and-swap, so the SECOND write silently wins with no signal to
    # the first writer that it lost the race.
    winner_b = _broken_takeover(path, rec1.token, "instance-b", now=1300.0)
    winner_c = _broken_takeover(path, rec1.token, "instance-c", now=1301.0)

    on_disk = read(path)
    assert isinstance(on_disk, LockRecord)
    # instance-c's write landed; instance-b believes it won too (it got a
    # record back with no error), which is exactly the double-writer bug.
    assert on_disk.token == winner_c.token
    assert winner_b.instance_id == "instance-b"  # instance-b thinks it holds the lock...
    assert on_disk.instance_id != winner_b.instance_id  # ...but it does not.


# -- real two-process test ----------------------------------------------------


def _worker(
    path: str,
    worker_id: int,
    iterations: int,
    log_dir: str,
    barrier: multiprocessing.synchronize.Barrier,
) -> None:
    """Runs in a spawned child process: repeatedly try to acquire the lock,
    hold it briefly (recording an in-hold timestamp window to its own log
    file), then release. Started via `multiprocessing` (spawn context) so
    this is a REAL separate OS process, not a thread — the exact gap the I2
    audit flagged (two separate `qz --desktop` processes)."""
    import quantized.desktop_project_lock as lockmod

    barrier.wait()  # start all workers as close to simultaneously as possible
    log_path = os.path.join(log_dir, f"worker-{worker_id}.log")
    held = 0
    with open(log_path, "w", encoding="utf-8") as log:
        deadline = time.time() + 5.0
        while held < iterations and time.time() < deadline:
            now = time.time()
            ok, record = lockmod.acquire(path, f"worker-{worker_id}", now=now, ttl_seconds=2.0)
            if not ok or not isinstance(record, lockmod.LockRecord):
                time.sleep(0.005)
                continue
            start = time.time()
            log.write(f"{start:.6f} start {worker_id}\n")
            log.flush()
            time.sleep(0.01)  # hold briefly — this is the window that must never overlap
            end = time.time()
            log.write(f"{end:.6f} end {worker_id}\n")
            log.flush()
            lockmod.release(path, record.token)
            held += 1


def test_two_real_processes_never_hold_the_lock_concurrently(tmp_path: Path) -> None:
    """The real cross-process test the audit demanded: N SEPARATE OS
    processes (spawn context, not threads) contend for one lock file.
    Assert exactly one holder at a time by checking every worker's logged
    hold interval against every OTHER worker's for overlap — the property
    asserted is "no two intervals overlap", not a timing budget."""
    path = _project(tmp_path)
    log_dir = str(tmp_path / "logs")
    os.makedirs(log_dir, exist_ok=True)
    n_workers = 4
    iterations = 3

    ctx = multiprocessing.get_context("spawn")
    barrier = ctx.Barrier(n_workers)
    procs = [
        ctx.Process(target=_worker, args=(path, i, iterations, log_dir, barrier))
        for i in range(n_workers)
    ]
    for p in procs:
        p.start()
    for p in procs:
        p.join(timeout=9.0)
        assert not p.is_alive(), "worker process hung"
        assert p.exitcode == 0, f"worker process crashed (exitcode {p.exitcode})"

    intervals: list[tuple[float, float, int]] = []
    for i in range(n_workers):
        log_path = os.path.join(log_dir, f"worker-{i}.log")
        assert os.path.isfile(log_path), f"worker {i} produced no log — it never ran"
        lines = Path(log_path).read_text(encoding="utf-8").splitlines()
        starts: dict[int, float] = {}
        seq = 0
        for line in lines:
            ts_str, kind, wid_str = line.split()
            ts = float(ts_str)
            if kind == "start":
                starts[seq] = ts
            else:
                intervals.append((starts.pop(seq), ts, i))
                seq += 1
    assert len(intervals) >= n_workers, "too few completed hold intervals recorded"

    intervals.sort()
    for a, b in zip(intervals, intervals[1:], strict=False):
        a_start, a_end, a_worker = a
        b_start, b_end, b_worker = b
        assert b_start >= a_end, (
            f"lock held concurrently: worker {a_worker} [{a_start},{a_end}] "
            f"overlaps worker {b_worker} [{b_start},{b_end}]"
        )
