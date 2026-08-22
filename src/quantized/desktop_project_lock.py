"""Cross-process single-writer project lock (I2 audit fix, Day-6 sprint
P0-3 + P1-1 — see ``plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md``'s
"Independent Day-6 audit" section).

**The bug this closes.** ``frontend/src/store/projectLock.ts``'s default
lock provider was an in-memory, process-local ``Map`` — its own header
admitted that two ``qz --desktop`` processes each get their own empty Map,
so the I2 "single writer" release claim was false in practice. This module
is the durable, cross-process half: a lock file ``<project-path>.lock``
beside the project file, readable/writable by every process on the same
machine.

**Why compare-and-swap, not read-then-write.** The pre-fix store did
read/classify/unconditional-write — two processes racing a takeover could
both read the same stale record, both decide they win, and both write,
leaving whichever wrote last as the "winner" with the other believing it
also holds the lock. The fix is a real CAS primitive: every mutation past
the initial creation opens the lock file and takes an EXCLUSIVE **OS-level**
file lock on it (``desktop_project_lock_oslock.py`` — ``fcntl.flock`` on
POSIX, ``msvcrt.locking`` on Windows, each exercised by this repo's own OS
in the 3-OS CI matrix), reads the CURRENT on-disk content under that lock,
compares the caller's expected token, and only on a match overwrites in
place. The OS lock is what makes "read current, compare, write" atomic
across processes; a plain Python-level lock (``threading.Lock``, an
in-process mutex) would not reach a second OS process at all.

**Token, not "who holds it".** Every acquisition mints a fresh random
token (``secrets.token_urlsafe``) — never reused across acquire/take_over
calls — so ownership is provable by possession of a value nobody else
could have gotten any other way, rather than by trusting a caller-supplied
instance id (which a compromised/buggy caller could simply claim).

**Staleness / TTL.** A holder is expected to call :func:`refresh` roughly
every ``ttl_seconds / 3`` while it holds the project open (the frontend's
``HEARTBEAT_INTERVAL_MS`` / ``STALE_AFTER_MS = 3x`` split —
``lib/lockState.ts``). :data:`DEFAULT_TTL_SECONDS` mirrors that 90s
default. A record whose ``heartbeat_at`` is older than ``ttl_seconds`` is
STALE — :func:`acquire` will attempt a CAS takeover of a stale record, but
never of a fresh one.

**Unverifiable, not an exception.** Every filesystem access here is
wrapped in ``except (OSError, ValueError)`` — ``ValueError`` is included
deliberately: ``os.stat``/``open`` raise it (not ``OSError``) for an
embedded-NUL path on Windows, a real prior CI redness in this repo (see
CLAUDE.md's mypy/numpy lessons for the sibling pattern of "wrap or it
bites you in CI"). A corrupt or unparseable lock file is reported as
:class:`UnverifiableLock`, never raised — callers (the bridge, and
eventually the frontend) must treat "cannot verify" the same as "someone
else might hold it": read-only, never "assume free".

**Pure library, no fastapi/pydantic.** Mirrors ``desktop_project_file.py``:
importable (and testable) without the web stack, called in-process by
``desktop_bridge.py``'s ``project_lock_*`` js_api methods — never
reachable over HTTP, matching every other filesystem-authority module in
this codebase (``desktop_consent.py``'s module doc has the same rule for
read/write path consent).

**R1 fix (see ``plans/POST_SPRINT_INDEPENDENT_REVIEW.md``'s R1 section).**
This module used to expose ``token_still_valid`` — a CAS-protected check
that verified a token and then RELEASED the OS lock, leaving the caller's
actual project-file write to happen outside any lock (a takeover could
land in that gap), and one that returned ``True`` for ANY token when the
lock file was ABSENT. Removed entirely, fully superseded by
:func:`quantized.desktop_project_lock_write.write_holding_token`, which
verifies the token and keeps the SAME exclusive OS lock held through the
caller's own write.

**R1 follow-up: Contended vs. UnverifiableLock.** On Windows, ``msvcrt``
region locks are MANDATORY — while one handle holds this package's
exclusive lock, ANY other handle's plain, unprotected read of that byte
range fails immediately with ``PermissionError``, not a graceful timeout.
The first R1 cut still had an unprotected pre-read in :func:`refresh`
that hit exactly that error while a save was in progress, misclassified
it as :class:`UnverifiableLock`, and demoted a perfectly healthy holder's
own heartbeat. :class:`Contended` is the fix: a distinct outcome for
"someone else genuinely holds this right now" (that mandatory-lock error,
or the exclusive OS-lock ACQUIRE loop timing out on either platform) as
opposed to :class:`UnverifiableLock`'s "content IS accessible but cannot
be trusted". :func:`refresh` no longer pre-reads at all — see its own doc
and :class:`Contended`'s (``desktop_project_lock_record.py``) and
``desktop_bridge.py::project_lock_refresh``'s "soft success" mapping.

**Split across three modules**, purely to stay under the repo's 500-line
ceiling as this design grew: ``desktop_project_lock_record.py`` (pure
data — ``LockRecord``/``UnverifiableLock``/``Contended``/serialization),
``desktop_project_lock_oslock.py`` (the exclusive-OS-lock mechanism,
``_open_locked``/``_unlock``), and this module (the CAS policy —
``read``/``refresh``/``take_over``/``acquire``/``release``). All three are
plain, ordinary one-directional imports; none reaches into another's
private names, and none of the three imports either of the others back.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Callable
from dataclasses import replace

from quantized.desktop_project_lock_oslock import _open_locked, _unlock
from quantized.desktop_project_lock_record import (
    LOCK_VERSION,
    CasResult,
    Contended,
    LockRecord,
    UnverifiableLock,
    _lock_path,
    _make_record,
    _parse_record,
    _record_to_dict,
)

__all__ = [
    "CasResult",
    "Contended",
    "DEFAULT_TTL_SECONDS",
    "LOCK_VERSION",
    "LockRecord",
    "UnverifiableLock",
    "acquire",
    "read",
    "refresh",
    "release",
    "take_over",
]


# Mirrors frontend/src/lib/lockState.ts's `STALE_AFTER_MS` (3 * a 30s
# heartbeat interval) — kept in sync BY HAND, same as desktop_project_file.py's
# WORKSPACE_FORMAT/VERSIONS constants, since nothing crosses the Python/
# TypeScript boundary to share them.
DEFAULT_TTL_SECONDS = 90.0

# A plain read (below) is not protected by the exclusive OS lock at all —
# see `read`'s doc for why — so it gets its OWN small, modest retry budget
# for the one failure mode that can hit it anyway: a Windows mandatory-lock
# `PermissionError` while another handle holds the exclusive lock. The
# exclusive-lock ACQUIRE budget itself, and the unrelated orphan-inode
# identity-retry budget, live with `_open_locked`
# (`desktop_project_lock_oslock.py`) — kept as two SEPARATE constants there
# after a code-review finding that one shared constant on the first R1 cut
# governed both, so enlarging one for save-contention silently enlarged
# the unrelated other too.
_READ_RETRY_ATTEMPTS = 20  # ~0.2s: a plain read's Windows-mandatory-lock retry.
_READ_RETRY_DELAY_S = 0.01


# -- reads --------------------------------------------------------------


def read(path: str) -> LockRecord | UnverifiableLock | Contended | None:
    """Parse the lock file beside `path`. `None` = no lock file at all
    (never held, or cleanly released). Never raises.

    This is a PLAIN, unprotected read — it never takes the exclusive OS
    lock itself (that would make every mere "peek" contend with real
    mutations for no reason). On POSIX that's fine: `fcntl.flock` is
    advisory, so a plain read always succeeds regardless of who holds the
    lock. On WINDOWS, `msvcrt` region locks are MANDATORY — while another
    handle holds this package's exclusive lock, this read can fail
    immediately with `PermissionError`. That is retried a SMALL bounded
    number of times (`_READ_RETRY_ATTEMPTS` — a "is a save merely still in
    progress" window, not a "wait out a whole save" one) and, if it never
    clears, reported as `Contended` — NOT `UnverifiableLock`, which is
    reserved for content that IS readable but cannot be trusted (corrupt/
    unparseable). Callers besides `refresh` (which has its own bespoke,
    non-demoting handling — see its doc) should treat `Contended` the same
    conservative way as `UnverifiableLock`: cannot verify right now, never
    "assume free"."""
    lock_path = _lock_path(path)
    for attempt in range(_READ_RETRY_ATTEMPTS):
        try:
            with open(lock_path, "rb") as f:
                raw = f.read()
        except FileNotFoundError:
            return None
        except PermissionError as exc:
            if attempt == _READ_RETRY_ATTEMPTS - 1:
                return Contended(str(exc))
            time.sleep(_READ_RETRY_DELAY_S)
            continue
        except (OSError, ValueError) as exc:
            return UnverifiableLock(str(exc))
        try:
            text = raw.decode("utf-8")
        except (UnicodeDecodeError, ValueError) as exc:
            return UnverifiableLock(str(exc))
        return _parse_record(text)
    raise AssertionError("unreachable: the loop above always returns")


# -- the CAS primitive ----------------------------------------------------


def _cas_update(
    path: str, expected_token: str, build_new_record: Callable[[LockRecord], LockRecord]
) -> CasResult:
    """The actual CAS primitive: open the lock file, take the exclusive OS
    lock, read the CURRENT record UNDER that lock, and — only if its token
    still equals `expected_token` — write whatever `build_new_record`
    computes from that current record, all before releasing. `_cas_write`
    and `refresh` are both thin callers of this; `refresh` is the reason
    it takes a builder rather than a precomputed record — see its doc for
    why the "read current" step MUST happen inside the same locked section
    as the compare-and-write, not before it."""
    state, fh, err = _open_locked(_lock_path(path))
    if state == "absent":
        return False, None
    if fh is None:
        if state == "contended":
            return False, Contended(err or "lock is currently held by another process/handle")
        return False, UnverifiableLock(err or "could not lock the lock file")
    try:
        try:
            fh.seek(0)
            current = _parse_record(fh.read().decode("utf-8"))
            if isinstance(current, UnverifiableLock):
                return False, current
            if current is None or current.token != expected_token:
                return False, current
            new_record = build_new_record(current)
            payload = json.dumps(_record_to_dict(new_record)).encode("utf-8")
            fh.seek(0)
            fh.write(payload)
            fh.truncate()
            fh.flush()
            os.fsync(fh.fileno())
            return True, new_record
        finally:
            _unlock(fh)
    except (OSError, ValueError) as exc:
        return False, UnverifiableLock(str(exc))
    finally:
        fh.close()


def _cas_write(path: str, expected_token: str, new_record: LockRecord) -> CasResult:
    """Open the lock file, take the exclusive OS lock, and overwrite its
    content with `new_record` ONLY IF the token on disk right now still
    equals `expected_token`. `take_over` is the caller — its replacement
    record never depends on the current one's OTHER fields (it is a
    brand-new identity), so a precomputed record is fine here; `refresh`
    uses `_cas_update` directly instead, since it does need the current
    record's other fields (see that function's doc)."""
    return _cas_update(path, expected_token, lambda _current: new_record)


def refresh(path: str, token: str, *, now: float) -> CasResult:
    """CAS heartbeat bump for the holder of `token`. Reads the CURRENT
    record and computes the refreshed one WHILE STILL HOLDING the same
    exclusive OS lock the write uses (`_cas_update`) — deliberately NO
    separate, unprotected pre-read. An earlier cut of this function did
    `current = read(path)` first, classified it, and only then called the
    CAS primitive; on Windows that unprotected pre-read could hit a
    mandatory-lock `PermissionError` while a save was merely in progress,
    which got misclassified as "lost the lock" (see this module's "R1
    follow-up" doc section and `Contended`'s own doc). Folding the read
    into the CAS's own locked section makes that read fail (or succeed)
    the exact same way every OTHER mutation here already does.

    A token mismatch — including "no lock file at all" — returns `(False,
    current)`: the caller LOST the lock (or never verifiably had it) and
    must drop to read-only. A `Contended` result means the lock is merely
    BUSY right now (another mutation holds the exclusive OS lock this
    instant) — `desktop_bridge.py::project_lock_refresh` maps this to a
    non-demoting "soft success" rather than treating it as loss, since the
    frontend's heartbeat does not otherwise retry a single failed refresh
    and `DEFAULT_TTL_SECONDS`'s 3-tick staleness window is exactly what
    absorbs one contended tick safely."""
    return _cas_update(path, token, lambda current: replace(current, heartbeat_at=now))


def take_over(
    path: str,
    expected_token: str,
    instance_id: str,
    *,
    now: float,
    hostname: str | None = None,
    pid: int | None = None,
) -> CasResult:
    """CAS replace a lock currently held under `expected_token` with a
    brand-new record (a fresh token, `instance_id` as the new holder).
    An expected-token mismatch means someone else moved first — this
    refuses rather than clobbering whatever is there now."""
    candidate = _make_record(instance_id, now, hostname, pid)
    return _cas_write(path, expected_token, candidate)


# -- acquisition ------------------------------------------------------------


def _create_new(lock_path: str, record: LockRecord) -> LockRecord | UnverifiableLock | None:
    """The atomic-creation fast path (`O_CREAT|O_EXCL`). `LockRecord` on
    success. `None` means the file already exists — the caller should read
    and classify it. `UnverifiableLock` means creation itself failed for a
    reason OTHER than "already exists" (e.g. an unwritable directory) —
    never treated as "go read the existing record", since there may be
    none to read."""
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return None
    except (OSError, ValueError) as exc:
        return UnverifiableLock(str(exc))
    try:
        os.write(fd, json.dumps(_record_to_dict(record)).encode("utf-8"))
        os.fsync(fd)
    except (OSError, ValueError) as exc:
        return UnverifiableLock(str(exc))
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
    return record


def _replace_tombstone(lock_path: str, fresh: LockRecord) -> CasResult:
    """CAS-replace a release tombstone with `fresh` under the exclusive OS
    lock. Wins only if the file still parses as released at write time; a
    concurrent winner's record is reported honestly instead."""
    state, fh, err = _open_locked(lock_path)
    if state == "absent":
        created = _create_new(lock_path, fresh)
        if isinstance(created, LockRecord):
            return True, created
        return False, created if isinstance(created, UnverifiableLock) else None
    if fh is None:
        if state == "contended":
            return False, Contended(err or "lock is currently held by another process/handle")
        return False, UnverifiableLock(err or "could not lock the lock file")
    try:
        try:
            fh.seek(0)
            current = _parse_record(fh.read().decode("utf-8"))
            if isinstance(current, UnverifiableLock):
                return False, current
            if current is not None:
                return False, current  # someone re-acquired first
            fh.seek(0)
            fh.write(json.dumps(_record_to_dict(fresh)).encode("utf-8"))
            fh.truncate()
            fh.flush()
            os.fsync(fh.fileno())
            return True, fresh
        finally:
            _unlock(fh)
    except (OSError, ValueError) as exc:
        return False, UnverifiableLock(str(exc))
    finally:
        fh.close()


def acquire(
    path: str,
    instance_id: str,
    *,
    now: float,
    ttl_seconds: float = DEFAULT_TTL_SECONDS,
    hostname: str | None = None,
    pid: int | None = None,
) -> CasResult:
    """Acquire the lock for `path`. `(True, record)` on success. On
    contention: a FRESH other holder refuses outright (`False, record`); a
    STALE one is taken over via the CAS primitive (so this itself is safe
    against a third process racing the same takeover — only one of them
    wins the CAS). An unverifiable lock file, or one currently `Contended`
    (a mandatory-lock `PermissionError` on Windows, or an OS-lock acquire
    timeout — see `read`'s and `Contended`'s own docs), refuses rather
    than guessing either way — this is a one-shot user action (unlike
    `refresh`'s recurring heartbeat), so an honest "busy, try again" is the
    correct and sufficient answer here, not the bespoke soft-success
    treatment `refresh` gets."""
    lock_path = _lock_path(path)
    fresh = _make_record(instance_id, now, hostname, pid)
    created = _create_new(lock_path, fresh)
    if isinstance(created, LockRecord):
        return True, created
    if isinstance(created, UnverifiableLock):
        return False, created

    current = read(path)
    if current is None:
        # Either the file vanished (raced a POSIX release-unlink) or it
        # holds a release TOMBSTONE (the Windows release path). Try the
        # O_EXCL create once more for the vanished case; if the file still
        # exists, CAS-replace the tombstone under the OS lock.
        created = _create_new(lock_path, fresh)
        if isinstance(created, LockRecord):
            return True, created
        if isinstance(created, UnverifiableLock):
            return False, created
        return _replace_tombstone(lock_path, fresh)
    if isinstance(current, (UnverifiableLock, Contended)):
        return False, current
    if now - current.heartbeat_at <= ttl_seconds:
        return False, current  # fresh — genuinely held, no takeover attempt
    return take_over(path, current.token, instance_id, now=now, hostname=hostname, pid=pid)


# -- release ------------------------------------------------------------


def release(path: str, token: str) -> tuple[bool, str | None]:
    """Release the lock, but ONLY if `token` still matches what's on disk
    (verified under the exclusive OS lock, same as every other mutation
    here). `(True, None)` on success, including "there was nothing to
    release" (idempotent). `(False, reason)` otherwise — NEVER raises, so a
    Windows "can't delete a file this same process still has open" failure
    (a real platform difference: POSIX allows unlinking an open file,
    Windows generally does not) comes back as an honest `released=False`
    with a reason instead of an exception; the lock record itself is left
    completely untouched by that failure, still bearing this token, so a
    caller can simply retry."""
    lock_path = _lock_path(path)
    state, fh, err = _open_locked(lock_path)
    if state == "absent":
        return True, None
    if fh is None:
        if state == "contended":
            return False, err or "lock is currently held by another process/handle"
        return False, err or "could not lock the lock file"
    try:
        try:
            fh.seek(0)
            current = _parse_record(fh.read().decode("utf-8"))
            if isinstance(current, UnverifiableLock):
                return False, f"lock file unverifiable: {current.reason}"
            if current is None or current.token != token:
                return False, "token mismatch"
            # Overwrite with the release TOMBSTONE under the OS lock: the
            # semantic release. POSIX can ALSO unlink right here (legal
            # while holding the open fh); Windows cannot -- and a
            # delete-after-close would race a legitimate re-acquire
            # (deleting THEIR fresh lock), so Windows keeps the tombstone
            # file and `acquire` CAS-replaces it.
            try:
                fh.seek(0)
                fh.write(json.dumps({"version": 1, "released": True}).encode("utf-8"))
                fh.truncate()
                fh.flush()
                os.fsync(fh.fileno())
            except (OSError, ValueError) as exc:
                return False, str(exc)
            if sys.platform != "win32":
                try:
                    os.remove(lock_path)
                except OSError:
                    pass  # tombstone already released it semantically
            return True, None
        finally:
            _unlock(fh)
    except (OSError, ValueError) as exc:
        return False, str(exc)
    finally:
        fh.close()
