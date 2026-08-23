"""Hold-the-lock-through-the-write operation (R1 fix — see
``plans/POST_SPRINT_INDEPENDENT_REVIEW.md``'s R1 section, "Hold project
ownership through the actual project-file replacement").

**The defect this closes.** Before this module existed,
``desktop_bridge.py``'s ``write_project_file`` called
``desktop_project_lock.token_still_valid`` — which took the exclusive OS
lock, compared the token, and RELEASED the lock — and only THEN created a
temp file and called ``os.replace`` on the real project file, entirely
OUTSIDE any lock. Two defects followed: (a) another process's
takeover/release/reacquire could land in the window between verification
and the replace, so a displaced writer's save could still land; (b) an
ABSENT lock file made ``token_still_valid`` return `True` for ANY supplied
token — a caller whose lock had been released or replaced by someone else
was told to proceed rather than refused, because "no lock to check
against" was treated the same as "you still own it".

**The fix.** :func:`write_holding_token` verifies the token and performs
the caller's write while STILL HOLDING the exact same exclusive OS lock
:mod:`quantized.desktop_project_lock`'s CAS mutations
(:func:`~quantized.desktop_project_lock.refresh`,
:func:`~quantized.desktop_project_lock.take_over`) already use — so any
concurrent takeover/refresh/release on the same lock file blocks until
this call's write has completed and the lock is released. An ABSENT lock
file now REFUSES a non-empty token outright (defect (b)'s fix): there is
nothing left to verify the caller's claimed ownership against, which
means their lock was released or replaced by someone else, not that they
still hold it.

**Split from ``desktop_project_lock.py`` purely to keep that module under
the repo's 500-line ceiling** (the same reason
``desktop_project_lock_record.py`` was split out — see that module's own
doc). This module imports the exclusive-OS-lock mechanism
(``_open_locked``, ``_unlock``) from ``desktop_project_lock_oslock.py`` —
an ordinary import, not a reach into a sibling's private names — because
this operation and ``desktop_project_lock.py``'s own CAS mutations MUST
use identical lock semantics.

**Legacy no-lock path is NOT this module's concern.** Per the frozen
``write_project_file`` contract, an EMPTY token skips verification
entirely and writes unlocked, exactly as before I2 existed — that is the
caller's (``desktop_bridge.py``'s) responsibility to route around this
function altogether, not something this function degrades into. Calling
this with an empty token is a caller bug, not a runtime condition, so it
raises ``ValueError`` rather than silently doing the wrong thing.

**Pure library, no fastapi/pydantic** — same rule as every other
filesystem-authority module in this codebase.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from quantized.desktop_project_lock_oslock import _open_locked, _unlock
from quantized.desktop_project_lock_record import (
    Contended,
    LockRecord,
    UnverifiableLock,
    _lock_path,
    _parse_record,
)

__all__ = ["LockLost", "LockVerified", "write_holding_token"]


@dataclass(frozen=True)
class LockVerified:
    """`token` matched the current on-disk holder for the entire call —
    `write_fn` ran while the exclusive OS lock was still held. `result` is
    whatever `write_fn` returned, passed through unchanged."""

    result: Any


@dataclass(frozen=True)
class LockLost:
    """Verification failed BEFORE `write_fn` was ever invoked — the caller
    does not verifiably own the lock right now, so the write never
    happened. `record` mirrors what every other reader in this package
    reports on loss: `None` for "no lock file" (including a release
    tombstone, which parses as `None` — see
    `desktop_project_lock_record._parse_record`'s doc) or a stale-token
    mismatch's current holder, an `UnverifiableLock` for corrupt/unreadable
    lock content, or a `Contended` when the exclusive OS lock itself could
    not even be acquired (someone else's CAS mutation is running right
    this instant — see `Contended`'s own doc). `desktop_bridge.py` maps
    every `LockLost` outcome to the SAME `"lock lost"` error string
    regardless of which of these it was — a save is a one-shot,
    user-triggered action, not a recurring heartbeat, so there is no
    `refresh`-style "soft success" case to special-case here: a save that
    could not verify or could not even get the lock right now is safely
    reported as refused, and the caller (or the user, via a retry) simply
    tries again."""

    record: LockRecord | UnverifiableLock | Contended | None


def write_holding_token(
    path: str, token: str, write_fn: Callable[[], Any]
) -> LockVerified | LockLost:
    """Verify `token` against the CURRENT on-disk lock record for `path`
    and, ONLY on a match, call `write_fn()` while STILL HOLDING the
    exclusive OS lock — releasing it only after `write_fn` returns (or
    raises). `write_fn` is responsible for the actual project-file
    replacement (a temp-write + `os.replace` of a DIFFERENT path — the
    project file itself, never this lock file); this function's only job
    is to make sure nothing else can mutate the lock while that happens.

    Requires a non-empty `token`; raises `ValueError` otherwise (see this
    module's doc — an empty token means "skip verification entirely",
    which is `desktop_bridge.py`'s job to route around this function, not
    this function's job to special-case).

    Returns `LockLost` — `write_fn` is NEVER called — when:
      - there is no lock file for `path` at all (including a release
        tombstone, which reads as absent). A non-empty token against an
        absent lock cannot be verified, so this refuses rather than the
        old, defective "nothing to check against, proceed" behavior.
      - the lock file exists but its token does not match `token` —
        someone else (a takeover) already moved.
      - the lock file cannot be trusted (corrupt JSON, a torn read, an
        I/O error) — `UnverifiableLock`, never raised.
      - the exclusive OS lock itself could not be acquired within the
        module's retry budget, or (Windows only) a mandatory-lock
        `PermissionError` was hit acquiring it — `Contended`: someone
        else's CAS mutation is running right now, distinct from
        corrupted content.

    Returns `LockVerified(result)` — wrapping whatever `write_fn()`
    returned — when the token matched and `write_fn` ran to completion.
    If `write_fn` raises, the exception propagates OUT of this call
    unchanged (the lock is still released via `finally` either way); a
    write failure has nothing to do with lock verification, so this
    module does not invent a new error shape for it — the caller reports
    it exactly as it always has.
    """
    if not token:
        raise ValueError(
            "write_holding_token requires a non-empty token; route an empty "
            "token through the legacy no-lock write path instead"
        )
    # `mode="rb"` (R1 round-3 fix): this function only ever READS the lock
    # file's content (the actual mutation, `write_fn`, targets the PROJECT
    # file, a different path entirely) — `_open_locked`'s "r+b" default is
    # for the CAS mutators in `desktop_project_lock.py` that overwrite this
    # file in place. Opening read-write here meant a lock file this process
    # could only READ (but not write) misreported "lock lost" instead of
    # verifying the token it could perfectly well see. Both platforms'
    # locking calls accept a read-only handle: `msvcrt.locking` locks a
    # byte range on any open handle regardless of access mode, and
    # `fcntl.flock` locks the whole open file description the same way.
    state, fh, err = _open_locked(_lock_path(path), mode="rb")
    if state == "absent":
        return LockLost(None)
    if fh is None:
        if state == "contended":
            return LockLost(Contended(err or "lock is currently held by another process/handle"))
        return LockLost(UnverifiableLock(err or "could not lock the lock file"))
    try:
        try:
            fh.seek(0)
            current = _parse_record(fh.read().decode("utf-8"))
        except (OSError, ValueError) as exc:
            return LockLost(UnverifiableLock(str(exc)))
        if isinstance(current, UnverifiableLock):
            return LockLost(current)
        if current is None or current.token != token:
            return LockLost(current)
        result = write_fn()
        return LockVerified(result)
    finally:
        _unlock(fh)
        fh.close()
