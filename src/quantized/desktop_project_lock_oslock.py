"""The exclusive OS-level file lock primitive shared by every mutator of
the project lock file — ``fcntl.flock`` on POSIX, ``msvcrt.locking`` on
Windows. See ``desktop_project_lock.py``'s module doc for the full CAS
design this is the "other half" of.

**Split out (R1 code-review follow-up) so it has no dependents at all,
not even each other.** Before this split, ``desktop_project_lock.py``
defined these functions itself, and the new
``desktop_project_lock_write.py`` (the R1 fix) reached into that module's
PRIVATE names (``_open_locked``, ``_unlock``) one-directionally to avoid a
circular import. That worked, but it meant this primitive had exactly one
"real" owner and one privileged reacher-in. Giving it its OWN module
means both ``desktop_project_lock.py`` (``read``/``refresh``/``take_over``/
``acquire``/``release``) and ``desktop_project_lock_write.py``
(``write_holding_token``) import it the SAME, ordinary way — no private
reach-in, no directionality to keep straight — and it also pulled this
file's own line count back under the repo's 500-line ceiling after the
``Contended`` outcome (see ``desktop_project_lock_record.py``) added
real, load-bearing documentation weight to the module that used to own
this code.

Pure mechanism, no policy: this module never constructs a `Contended` or
`UnverifiableLock` value itself — `_open_locked` reports a bare state
string (``"ok"``/``"absent"``/``"contended"``/``"error"``) plus an
optional reason, and every CALLER decides how to represent that (a
`Contended`/`UnverifiableLock` dataclass, or — for `release`, whose return
type is a plain `(bool, str | None)` — just a reason string). No
fastapi/pydantic, no `desktop_project_lock_record` import even: this
module doesn't need to know what a `LockRecord` looks like at all.
"""

from __future__ import annotations

import os
import sys
import time
from typing import IO

__all__ = ["_open_locked", "_unlock"]

# Two INDEPENDENT retry budgets (a code-review finding on the first R1
# cut: one shared constant governed both the OS-lock ACQUIRE loop below
# AND the orphan-inode identity-retry loop, so enlarging one for save-
# contention silently enlarged the other too — an unrelated race with an
# unrelated rationale). Both stay MODEST: `Contended` (see
# `desktop_project_lock_record.py`) is now a graceful, retry-next-tick
# outcome rather than a demotion, so a caller no longer needs either
# budget to outlast a whole in-flight save — `refresh`'s heartbeat caller
# absorbs that wait instead, bounded by `DEFAULT_TTL_SECONDS`'s 3-tick
# staleness window (`desktop_project_lock.py`).
_LOCK_ACQUIRE_RETRY_ATTEMPTS = 100  # ~1s: the exclusive OS-lock acquire loop.
_IDENTITY_RETRY_ATTEMPTS = 100  # ~1s: the orphan-inode re-open loop below.
_LOCK_RETRY_DELAY_S = 0.01
_LOCK_REGION_BYTES = 1  # Windows locks a byte RANGE, not the whole file.

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


def _classify_permission_error(exc: PermissionError) -> tuple[str, str]:
    """R1 round-3 fix (code review): a `PermissionError` means genuinely
    different things on the two platforms. On WINDOWS, `msvcrt` region
    locks are MANDATORY — another handle holding this package's lock can
    make an ordinary open/read/identity-check fail with exactly this
    exception, so it is real, transient CONTENDED-ness. On POSIX,
    `fcntl.flock` is advisory: nothing about another handle holding it can
    ever make a plain `open()` raise `PermissionError` — a `PermissionError`
    there reflects a REAL, persistent permissions problem (wrong file mode
    or ownership), not contention, and must surface as an honest error.
    Round 2's version classified this the same way on both platforms,
    which would have silently masked a genuine POSIX permissions failure
    behind `Contended`'s soft-success handling forever."""
    if sys.platform == "win32":
        return "contended", str(exc)
    return "error", str(exc)


def _acquire_os_lock(fh: IO[bytes]) -> bool:
    for attempt in range(_LOCK_ACQUIRE_RETRY_ATTEMPTS):
        if _try_lock(fh):
            return True
        if attempt < _LOCK_ACQUIRE_RETRY_ATTEMPTS - 1:
            time.sleep(_LOCK_RETRY_DELAY_S)
    return False


def _open_locked(lock_path: str, mode: str = "r+b") -> tuple[str, IO[bytes] | None, str | None]:
    """Open `lock_path` and take the exclusive OS lock, verifying AFTER the
    lock is held that the handle still refers to the file the path names
    (`fstat` vs `stat`, device+inode). Locking an ORPHANED inode is the
    race the two-process test caught red-handed: a POSIX release unlinks
    the file, a waiter that had already opened the old path locks the
    orphan, "wins" a CAS against content nobody else can see, and a third
    process O_EXCL-creates a brand-new lock file — two holders at once.
    On identity mismatch: unlock, reopen, retry (bounded by
    `_IDENTITY_RETRY_ATTEMPTS` — a DIFFERENT budget than the OS-lock
    acquire below; these are unrelated races with unrelated rationales).

    Returns `("ok", fh, None)` with the lock HELD (caller must `_unlock`
    then `close`), `("absent", None, None)` when the path stops existing,
    `("contended", None, reason)` when another live handle genuinely holds
    it right now (the OS-lock acquire timed out on EITHER platform, or —
    WINDOWS ONLY — a mandatory-lock `PermissionError` on the open/
    identity-check itself; see `_classify_permission_error`'s and
    `desktop_project_lock_record.Contended`'s docs for why a POSIX
    `PermissionError` is never classified this way), or `("error", None,
    reason)` for anything else (nothing held, nothing open)."""
    for _ in range(_IDENTITY_RETRY_ATTEMPTS):
        try:
            fh = open(lock_path, mode)
        except FileNotFoundError:
            return "absent", None, None
        except PermissionError as exc:
            state, reason = _classify_permission_error(exc)
            return state, None, reason
        except (OSError, ValueError) as exc:
            return "error", None, str(exc)
        try:
            locked = _acquire_os_lock(fh)
        except PermissionError as exc:
            fh.close()
            state, reason = _classify_permission_error(exc)
            return state, None, reason
        except (OSError, ValueError) as exc:
            fh.close()
            return "error", None, str(exc)
        if not locked:
            fh.close()
            return "contended", None, "timed out waiting for the exclusive lock"
        stale = False
        try:
            fst = os.fstat(fh.fileno())
            try:
                pst = os.stat(lock_path)
            except FileNotFoundError:
                stale = True
            else:
                stale = (fst.st_dev, fst.st_ino) != (pst.st_dev, pst.st_ino)
        except PermissionError as exc:
            _unlock(fh)
            fh.close()
            state, reason = _classify_permission_error(exc)
            return state, None, reason
        except (OSError, ValueError) as exc:
            _unlock(fh)
            fh.close()
            return "error", None, str(exc)
        if not stale:
            return "ok", fh, None
        _unlock(fh)
        fh.close()
        time.sleep(_LOCK_RETRY_DELAY_S)
    return "error", None, "lock file kept changing identity under the open/lock race"
