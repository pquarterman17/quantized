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
the initial creation opens the lock file, takes an EXCLUSIVE **OS-level**
file lock on it (``fcntl.flock`` on POSIX, ``msvcrt.locking`` on Windows —
a platform branch, each exercised by this repo's own OS in the 3-OS CI
matrix), reads the CURRENT on-disk content under that lock, compares the
caller's expected token, and only on a match overwrites in place. The OS
lock is what makes "read current, compare, write" atomic across processes;
a plain Python-level lock (``threading.Lock``, an in-process mutex) would
not reach a second OS process at all.

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
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import sys
import time
from dataclasses import dataclass, replace
from typing import IO, Any

__all__ = [
    "CasResult",
    "DEFAULT_TTL_SECONDS",
    "LOCK_VERSION",
    "LockRecord",
    "UnverifiableLock",
    "acquire",
    "read",
    "refresh",
    "release",
    "take_over",
    "token_still_valid",
]

LOCK_VERSION = 1

# Mirrors frontend/src/lib/lockState.ts's `STALE_AFTER_MS` (3 * a 30s
# heartbeat interval) — kept in sync BY HAND, same as desktop_project_file.py's
# WORKSPACE_FORMAT/VERSIONS constants, since nothing crosses the Python/
# TypeScript boundary to share them.
DEFAULT_TTL_SECONDS = 90.0

# Bounded retry budget for the exclusive OS-level lock below: real contention
# between two processes racing a heartbeat/takeover resolves within a few
# milliseconds, so ~1s of total budget is generous headroom, not a hang risk
# for a caller (or a test) that expects this to return promptly either way.
_LOCK_RETRY_ATTEMPTS = 100
_LOCK_RETRY_DELAY_S = 0.01
_LOCK_REGION_BYTES = 1  # Windows locks a byte RANGE, not the whole file.


@dataclass(frozen=True)
class LockRecord:
    """The lock file's parsed content. Field order matches the JSON key
    order the frozen contract specifies."""

    version: int
    token: str
    instance_id: str
    hostname: str
    pid: int
    acquired_at: float
    heartbeat_at: float


@dataclass(frozen=True)
class UnverifiableLock:
    """The lock file exists but could not be trusted (corrupt, unparseable,
    or an I/O error mid-read) — NEVER raised; see this module's doc. Callers
    must treat this exactly like "someone else might hold it"."""

    reason: str


# `(success, resulting_or_current_record)` — the shape every mutating
# function below returns. Named so those signatures fit the line-length
# gate without folding the union onto its own awkward line.
CasResult = tuple[bool, "LockRecord | UnverifiableLock | None"]


def _lock_path(project_path: str) -> str:
    return f"{project_path}.lock"


def _make_record(instance_id: str, now: float, hostname: str | None, pid: int | None) -> LockRecord:
    return LockRecord(
        version=LOCK_VERSION,
        token=secrets.token_urlsafe(24),
        instance_id=instance_id,
        hostname=hostname if hostname is not None else socket.gethostname(),
        pid=pid if pid is not None else os.getpid(),
        acquired_at=now,
        heartbeat_at=now,
    )


def _record_to_dict(record: LockRecord) -> dict[str, Any]:
    return {
        "version": record.version,
        "token": record.token,
        "instance_id": record.instance_id,
        "hostname": record.hostname,
        "pid": record.pid,
        "acquired_at": record.acquired_at,
        "heartbeat_at": record.heartbeat_at,
    }


def _parse_record(raw: str) -> LockRecord | UnverifiableLock | None:
    """`None` is deliberately NOT returned for an empty/whitespace-only
    file — the file EXISTS (unlike a missing lock file, which `read`
    reports as `None` before ever reaching this function), so an empty
    read is a torn/mid-write state, reported `UnverifiableLock` like any
    other corrupt content."""
    if raw.strip() == "":
        return UnverifiableLock("empty lock file")
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        return UnverifiableLock(f"corrupt lock file: {exc}")
    if not isinstance(obj, dict):
        return UnverifiableLock("lock file is not a JSON object")
    try:
        return LockRecord(
            version=int(obj["version"]),
            token=str(obj["token"]),
            instance_id=str(obj["instance_id"]),
            hostname=str(obj["hostname"]),
            pid=int(obj["pid"]),
            acquired_at=float(obj["acquired_at"]),
            heartbeat_at=float(obj["heartbeat_at"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        return UnverifiableLock(f"malformed lock record: {exc}")


# -- the exclusive OS-level lock (the CAS primitive's other half) -----------
# A platform branch: mypy skips the branch that doesn't match its configured
# `sys.platform` (the running OS, since pyproject.toml sets none explicitly),
# so each half is only ever type-checked — and unit-tested — on its own OS;
# the 3-OS CI matrix is what exercises both in practice.

if sys.platform == "win32":
    import msvcrt

    def _try_lock(fh: IO[bytes]) -> bool:
        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, _LOCK_REGION_BYTES)
            return True
        except OSError:
            return False

    def _unlock(fh: IO[bytes]) -> None:
        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, _LOCK_REGION_BYTES)
        except OSError:
            pass  # best-effort — the fh is about to be closed regardless

else:
    import fcntl

    def _try_lock(fh: IO[bytes]) -> bool:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    def _unlock(fh: IO[bytes]) -> None:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass  # best-effort — the fh is about to be closed regardless


def _acquire_os_lock(fh: IO[bytes]) -> bool:
    for attempt in range(_LOCK_RETRY_ATTEMPTS):
        if _try_lock(fh):
            return True
        if attempt < _LOCK_RETRY_ATTEMPTS - 1:
            time.sleep(_LOCK_RETRY_DELAY_S)
    return False


# -- reads --------------------------------------------------------------


def read(path: str) -> LockRecord | UnverifiableLock | None:
    """Parse the lock file beside `path`. `None` = no lock file at all
    (never held, or cleanly released). Never raises."""
    try:
        with open(_lock_path(path), "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        return UnverifiableLock(str(exc))
    try:
        text = raw.decode("utf-8")
    except (UnicodeDecodeError, ValueError) as exc:
        return UnverifiableLock(str(exc))
    return _parse_record(text)


def token_still_valid(path: str, token: str) -> bool:
    """CAS-PROTECTED check — is `token` still the current lock holder's
    token for `path`, verified under the SAME exclusive OS lock every
    mutation here uses (never a plain, unprotected `read()`). This is what
    `desktop_bridge.py`'s `write_project_file` calls IMMEDIATELY before a
    write to close the save TOCTOU: an unprotected read taken a moment
    earlier could race a concurrent `refresh`/`take_over`/`release` on the
    SAME lock file and observe a torn intermediate state; this cannot,
    because the OS lock excludes every other mutator for the duration of
    the compare.

    `True` (proceed) when there is NO lock file at all — nothing to verify
    a token against, matching `write_project_file`'s "only enforced when a
    lock file exists" contract. `False` (refuse) for an actual mismatch
    AND for `UnverifiableLock` — a lock file whose content cannot be
    trusted must never be treated as "no lock", the same fail-closed rule
    `read`'s own doc states for every other caller."""
    try:
        fh = open(_lock_path(path), "rb")
    except FileNotFoundError:
        return True
    except (OSError, ValueError):
        return False
    try:
        if not _acquire_os_lock(fh):
            return False
        try:
            current = _parse_record(fh.read().decode("utf-8"))
        finally:
            _unlock(fh)
    except (OSError, ValueError):
        return False
    finally:
        fh.close()
    return isinstance(current, LockRecord) and current.token == token


# -- the CAS primitive ----------------------------------------------------


def _cas_write(path: str, expected_token: str, new_record: LockRecord) -> CasResult:
    """Open the lock file, take the exclusive OS lock, and overwrite its
    content with `new_record` ONLY IF the token on disk right now still
    equals `expected_token`. This is the one place a lock record is ever
    mutated after creation — `refresh` and `take_over` are both thin
    callers of this."""
    try:
        fh = open(_lock_path(path), "r+b")
    except FileNotFoundError:
        return False, None
    except (OSError, ValueError) as exc:
        return False, UnverifiableLock(str(exc))
    try:
        if not _acquire_os_lock(fh):
            return False, UnverifiableLock("timed out waiting for the exclusive lock")
        try:
            fh.seek(0)
            current = _parse_record(fh.read().decode("utf-8"))
            if isinstance(current, UnverifiableLock):
                return False, current
            if current is None or current.token != expected_token:
                return False, current
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


def refresh(path: str, token: str, *, now: float) -> CasResult:
    """CAS heartbeat bump for the holder of `token`. A token mismatch —
    including "no lock file at all" or "unverifiable" — returns `(False,
    current)`: the caller LOST the lock (or never verifiably had it) and
    must drop to read-only, never keep believing it still writes."""
    current = read(path)
    if not isinstance(current, LockRecord) or current.token != token:
        return False, current
    return _cas_write(path, token, replace(current, heartbeat_at=now))


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
    wins the CAS). An unverifiable lock file refuses rather than guessing
    either way."""
    lock_path = _lock_path(path)
    fresh = _make_record(instance_id, now, hostname, pid)
    created = _create_new(lock_path, fresh)
    if isinstance(created, LockRecord):
        return True, created
    if isinstance(created, UnverifiableLock):
        return False, created

    current = read(path)
    if current is None:
        # Raced with a release between our O_EXCL failure and this read —
        # one more attempt; if that ALSO loses, someone else was faster
        # still and this call honestly reports their record.
        created = _create_new(lock_path, fresh)
        if isinstance(created, LockRecord):
            return True, created
        if isinstance(created, UnverifiableLock):
            return False, created
        return False, read(path)
    if isinstance(current, UnverifiableLock):
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
    try:
        fh = open(lock_path, "r+b")
    except FileNotFoundError:
        return True, None
    except (OSError, ValueError) as exc:
        return False, str(exc)
    try:
        if not _acquire_os_lock(fh):
            return False, "timed out waiting for the exclusive lock"
        try:
            fh.seek(0)
            current = _parse_record(fh.read().decode("utf-8"))
            if isinstance(current, UnverifiableLock):
                return False, f"lock file unverifiable: {current.reason}"
            if current is None or current.token != token:
                return False, "token mismatch"
            try:
                os.remove(lock_path)
            except OSError as exc:
                return False, str(exc)
            return True, None
        finally:
            _unlock(fh)
    except (OSError, ValueError) as exc:
        return False, str(exc)
    finally:
        fh.close()
