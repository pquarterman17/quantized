"""Native file-dialog bridge for the pywebview desktop shell (MAIN_PLAN #31).

The gap this closes, quoted from ``Dataset.source``'s own doc: a real path is
"set ONLY where a real path is actually knowable... neither the pywebview
desktop shell — no js_api bridge — nor the Tauri shell... surface one today".
So every GUI import went through ``/upload`` (bytes, no path), which is why a
Recent entry could not reopen by path and a re-import had to re-ask the picker.

This module is that missing bridge. pywebview exposes an object as
``window.pywebview.api`` inside the page; its methods run IN THIS PROCESS, so a
picked path can be handed to :mod:`quantized.desktop_consent` and imported
through the ordinary ``/api/parsers/import`` route — no new import pathway, and
the dataset ends up with a genuine ``source.path`` that re-import already knows
how to use.

Browser mode has no ``window.pywebview``, so the frontend degrades to the file
picker exactly as before. That asymmetry is deliberate and visible rather than
papered over: a browser genuinely cannot know a path, and pretending otherwise
would be the "false promise" the plan warns against.

Kept free of FastAPI/pydantic imports: this is a launch-path helper, not a
route, and the desktop shell must stay importable without the web stack.

## Bridge contract (P1.1)

``window.pywebview.api`` (``DesktopApi``, below) is the pywebview half of the
shell-agnostic frontend contract in ``frontend/src/lib/desktopBridge.ts``. The
dialog / project-READ methods (``probe``, ``pick_files``, ``pick_directory``,
``pick_relink_directory``, ``revoke_relink_dir``, ``path_status``,
``save_file_dialog``, ``open_project_file``, ``read_project_file``,
``probe_source``, ``grant_source_paths``) live on the
:class:`~quantized.desktop_bridge_dialogs.DesktopDialogBridge` mixin this
class inherits from (split out once this module neared the repo's 500-line
god-module ceiling — see that module's doc for the split rationale). This
module keeps the project-file WRITE path (``write_project_file``) and the I2
project-LOCK bridge (below).

**``null`` vs. cancel, everywhere in this contract:** every dialog method
returns a well-formed dict even on cancel or on a recoverable dialog
failure (``{"path": None}``, optionally with an ``"error"`` string) — it
never raises into JS. The FRONTEND is what turns that into the two distinct
outcomes callers must not conflate: a missing/broken bridge method reports
``null`` ("no usable bridge — fall back to the browser input/download"),
while a well-formed cancel result reports ``[]`` (list calls) or a distinct
cancel value (single-result calls) meaning "the user backed out — do
NOTHING, never fall back". See ``desktopBridge.ts``'s own module doc for the
exact frontend-side rule.

**Write consent:** a path is writable through ``write_project_file`` ONLY
when ``save_file_dialog`` (or, in tests, a directly-called
``desktop_consent.grant_write_path``) returned it THIS process. Read consent
does NOT double as write consent, and vice versa. There is still,
deliberately, no HTTP route that grants either kind.

## PR I2 filesystem lock provider (P0-3 + P1-1)

``project_lock_acquire`` / ``project_lock_refresh`` / ``project_lock_takeover``
/ ``project_lock_release`` / ``project_lock_read`` below are the durable,
cross-process half of the single-writer lock the audit found missing —
``frontend/src/store/projectLock.ts``'s default provider is an in-memory
process-local ``Map``, which cannot protect two separate ``qz --desktop``
processes. Every method here is a THIN adapter: resolve the path, require
``consented_write_path`` (the SAME gate ``write_project_file`` already uses
— locking a path this process cannot even write to is refused, so the lock
bridge cannot be turned into an oracle for arbitrary-path existence/mtime
probing the way an ungated version would be), then delegate to the pure
:mod:`quantized.desktop_project_lock` CAS primitives. See that module's own
doc for the actual compare-and-swap mechanics.

``self._instance_id`` is generated ONCE per process, server-side
(``uuid4()`` at ``DesktopApi.__init__``) — the frontend never supplies it
and cannot override it, so a compromised page in the window can request a
lock but can never impersonate a DIFFERENT running instance's identity; the
only thing it could do is act as (a very confused copy of) the one real
instance it is actually running inside.

**Explicitly deferred (not this slice), matching the existing "Explicitly
deferred" list above:** Tauri wiring; packaged Windows/macOS E2E of the
full native lifecycle; the browser/multi-tab cross-TAB lock provider
(``store/projectLock.ts``'s own header covers that gap — a filesystem lock
protects separate OS PROCESSES, not two tabs sharing one server, which
needs an entirely different mechanism).

**``project_lock_refresh``'s CONTENDED "soft success" (R1 follow-up,
hardened in round 3).** ``desktop_project_lock.refresh`` can report
``Contended`` — the lock is merely BUSY right now (another mutation/save
holds the exclusive OS lock this instant), never actually lost. Reporting
that honestly as ``refreshed: False`` would make
``frontend/src/store/projectLock.ts``'s ``heartbeat()`` demote a perfectly
healthy session (it does not retry a single failed refresh) over a single
busy tick. This module instead reports a CONTENDED refresh as
``refreshed: True`` with the LAST lock record this SAME ``DesktopApi``
genuinely observed for this path (``self._last_known_lock_record``).

**Round-3 hardening — a single-writer violation the round-2 version had.**
Two conditions are BOTH required before this soft-success fires, not just
"a cached record exists":

1. ``cached.token == token`` — the CALLER's own presented token must
   match the cached record. Without this check, a DISPLACED instance A
   whose earlier plain read (or a refused acquire) had cached instance
   B's LIVE record could have its own now-stale heartbeat soft-succeed
   with B's record echoed back — the frontend would then adopt B's live
   token as "its own", and A's NEXT save would present B's token and WIN,
   a genuine two-writer violation. ``_remember`` (below) already prevents
   the cache from ever holding another instance's record, but this check
   is the second, independent gate — belt AND braces, not either/or.
2. Fewer than ``_MAX_CONSECUTIVE_CONTENDED_SOFT_SUCCESSES`` (2) consecutive
   soft successes have already been granted for this path
   (``self._contended_streak``). A THIRD consecutive contended tick
   returns the honest refusal instead (the frontend demotes) — matching
   the TTL rationale that justified this design in the first place
   (``STALE_AFTER_MS`` = 3 heartbeat ticks absorbs ONE missed/contended
   refresh; this bridge must not silently absorb unbounded ones on a
   pathologically or permanently contended path). The streak resets to 0
   on any non-soft-success outcome — see ``project_lock_refresh``.

This keeps the frontend's ``record.token`` intact for its next save
attempt across a SHORT contention window, which
``write_project_file``/``write_holding_token`` re-verifies for REAL at
write time regardless — this mapping is a bounded bookkeeping softening
for the recurring heartbeat only, never a substitute for that real check.
The frontend needs no change for this: it already treats "refreshed: true"
as "still holds it" and does not otherwise inspect the record's heartbeat
for freshness itself.

**``_remember``'s cache is instance-scoped success-only (round-3 fix).**
``self._last_known_lock_record`` may ONLY ever hold a record this SAME
``DesktopApi`` instance itself just won — an ``ok: True`` acquire,
refresh, or takeover. It is NEVER populated from a refusal (whose record
belongs to WHOEVER currently holds the lock — possibly a different
instance entirely) or from a plain ``project_lock_read`` (ditto, and it
has no "mine vs. theirs" concept at all). Caching from either would let
the CONTENDED soft-success above echo back a record this instance does
not actually hold — the exact defect described above.
"""

from __future__ import annotations

import os
import tempfile
import time
import uuid
from typing import Any

from quantized import desktop_project_lock as lockmod
from quantized import desktop_project_lock_write as lockwrite
from quantized.desktop_bridge_dialogs import DesktopDialogBridge
from quantized.desktop_consent import consented_write_path
from quantized.desktop_project_file import (
    WRITE_TEMP_PREFIX,
    cleanup_stray_write_temps,
    validate_workspace_payload,
)

__all__ = ["DesktopApi"]

# See this module's "round-3 hardening" doc section: caps how many
# CONSECUTIVE contended heartbeat ticks in a row get the non-demoting
# soft-success treatment before `project_lock_refresh` falls back to an
# honest refusal. Matches the TTL design's own rationale — `refresh`'s doc
# and `DEFAULT_TTL_SECONDS`'s 3-tick staleness window already assume ONE
# missed/contended tick is safely absorbed; this is that same assumption
# enforced explicitly rather than left to chance on a path that could stay
# contended indefinitely (a stuck/pathological holder, not just a normal
# brief save).
_MAX_CONSECUTIVE_CONTENDED_SOFT_SUCCESSES = 2


class DesktopApi(DesktopDialogBridge):
    """The object pywebview exposes at ``window.pywebview.api``.

    Every method is callable from the page, so each one is written as if the
    caller were hostile. The protection is not in this class: opening a modal
    OS dialog requires a human to choose a file, and nothing here can grant
    consent for a path the dialog did not return.
    """

    def __init__(self) -> None:
        self._window: Any = None
        # One id per running process, minted ONCE — see this module's "PR I2"
        # section for why the frontend can never supply or override this.
        self._instance_id = str(uuid.uuid4())
        # Last LockRecord THIS instance itself genuinely WON, per granted
        # path — see this module's "round-3 hardening" doc section. Never
        # fabricated, and NEVER populated from a refusal or a plain read
        # (both could carry a DIFFERENT instance's record) — only from an
        # ok:True acquire/refresh/takeover response, via `_remember`.
        self._last_known_lock_record: dict[str, lockmod.LockRecord] = {}
        # Consecutive CONTENDED soft-successes granted per path — see
        # `_MAX_CONSECUTIVE_CONTENDED_SOFT_SUCCESSES`'s doc.
        self._contended_streak: dict[str, int] = {}

    def attach(self, window: Any) -> None:
        """Called by the launcher once the window exists — the dialog methods
        are on the window object, not the module."""
        self._window = window

    # -- capability probe ---------------------------------------------------

    def probe(self) -> dict[str, Any]:
        """What the shell can do. The frontend calls this once and adapts;
        it never assumes a capability just because ``pywebview`` is present."""
        return {
            "shell": "pywebview",
            "canPickFiles": self._window is not None,
            "canPickDirectory": self._window is not None,
            "cwd": os.getcwd(),
            "home": os.path.expanduser("~"),
        }

    # -- project write (P1.1 C2 + I2 lock-token binding) ---------------------

    def write_project_file(self, path: str, content: str, lock_token: str = "") -> dict[str, Any]:
        """Write ``content`` to ``path`` IN-PROCESS — never through an HTTP
        route, which is what keeps desktop_consent's "no HTTP route grants
        (or spends) consent" boundary intact for writes too.

        Refuses any path that was not returned by ``save_file_dialog`` this
        process. The write itself is temp-file-plus-``os.replace`` (same
        directory, so the replace is atomic on a normal filesystem) so a
        crash mid-write cannot leave a half-written ``.dwk`` at the real
        path — **and**, since P1.2 box 3's hardening, the temp file is
        ``flush``ed and ``fsync``ed BEFORE that replace, so a crash or
        power loss right after ``os.replace`` returns finds the new bytes
        durable on disk rather than whatever the filesystem's delayed
        allocation had buffered. Not guaranteed: durability of the
        containing directory's own metadata beyond a best-effort directory
        ``fsync`` (POSIX-only, swallowed on failure — see
        ``_fsync_directory_best_effort``), which only narrows that window
        further; it is never load-bearing for the prior file's survival,
        which the temp-file-only failure mode above already covers.
        ``content`` must pass ``validate_workspace_payload`` or the write
        is refused before a temp file is even opened.

        **R1 lock-held write (I2 hardening, P1-1):** when `lock_token` is
        non-empty, the token is verified AND the temp-write-plus-`os.replace`
        below runs while STILL HOLDING the SAME exclusive OS lock every
        other lock mutation uses — see
        `quantized.desktop_project_lock_write.write_holding_token`. This
        closes the save TOCTOU a verify-then-release shape left open: a
        session that lost the lock between its last heartbeat and this save
        can no longer land its write in the gap, because there is no gap —
        another process's takeover/refresh/release on the same lock file
        blocks until this save has completed and released it. A verification
        failure (a token mismatch, an ABSENT lock file, or an unverifiable
        one) refuses with a DISTINCT error string (`"error": "lock lost"`)
        the frontend recognizes and surfaces as exactly that, rather than a
        generic write failure — an absent lock is refused here, not treated
        as "nothing to check, proceed" (that was the prior defect: a lock
        that had been released or replaced by someone else must never read
        as "still yours"). An EMPTY token skips verification and the lock
        entirely — the pre-I2, no lock-provider-wired legacy behavior — so a
        caller that never acquired a lock (or the browser/in-memory-only
        path) writes exactly as before, unlocked.
        """
        try:
            resolved = os.path.realpath(path)
        except (OSError, ValueError) as exc:
            return {"ok": False, "error": str(exc)}
        granted = consented_write_path(resolved)
        if granted is None:
            return {"ok": False, "error": "path not consented for writing"}
        invalid = validate_workspace_payload(content)
        if invalid is not None:
            return {"ok": False, "error": f"refusing to write — {invalid}"}
        directory = os.path.dirname(granted) or "."

        def _replace() -> None:
            # R1 round-3 fix (F3): moved INSIDE `_replace` (was a bare call
            # right here) so that, when `lock_token` is supplied, this runs
            # WHILE `write_holding_token` holds the exclusive OS lock — a
            # second concurrent LOCKED save's own `_replace` cannot start
            # until this one has fully finished (including its own
            # `os.replace`), so it can never sweep up THIS save's still-open
            # temp file. `cleanup_stray_write_temps`'s own age floor is the
            # belt-and-braces protection for the unlocked, no-token legacy
            # path directly below, which has no such serialization at all.
            cleanup_stray_write_temps(directory)
            tmp_path: str | None
            fd, tmp_path = tempfile.mkstemp(prefix=WRITE_TEMP_PREFIX, dir=directory)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp_path, granted)
                tmp_path = None  # replaced — nothing left to clean up
                _fsync_directory_best_effort(directory)
            finally:
                if tmp_path is not None:
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass

        try:
            if lock_token:
                result = lockwrite.write_holding_token(granted, lock_token, _replace)
                if isinstance(result, lockwrite.LockLost):
                    return {"ok": False, "error": "lock lost"}
            else:
                _replace()
        except OSError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "path": granted}

    # -- PR I2: filesystem project lock --------------------------------------

    def project_lock_acquire(self, path: str) -> dict[str, Any]:
        """Acquire (or observe) the cross-process lock for `path`. Requires
        write consent for `path` — locking a path this process could not
        even write to would let the lock bridge answer "does this arbitrary
        path exist" for anything, which is exactly the oracle
        `write_project_file` itself refuses to be."""
        granted = self._consented_write_or_none(path)
        if granted is None:
            return {"acquired": False, "error": "path not consented for writing"}
        ok, record = lockmod.acquire(granted, self._instance_id, now=time.time())
        self._remember(granted, ok, record)  # cache ONLY on an ok:True win — see `_remember`
        return _lock_result(record, outcome_key="acquired", outcome_value=ok)

    def project_lock_read(self, path: str) -> dict[str, Any]:
        """Read the current lock record for `path` with no side effect —
        for a caller that wants to classify a lock (fresh/stale/none)
        without attempting to acquire it. Deliberately NEVER feeds
        `_remember`'s cache (round-3 fix): a plain read reports WHATEVER is
        on disk, which may belong to a completely different instance —
        caching it would let `project_lock_refresh`'s soft-success echo
        back someone else's record later."""
        granted = self._consented_write_or_none(path)
        if granted is None:
            return {"record": None, "error": "path not consented for writing"}
        return _lock_result(lockmod.read(granted), outcome_key="acquired", outcome_value=None)

    def project_lock_refresh(self, path: str, token: str) -> dict[str, Any]:
        """Heartbeat bump for a lock this instance believes it holds. A
        token mismatch (including "no lock file" / "unverifiable") reports
        `refreshed: False` — the caller must drop to read-only, never keep
        assuming it still writes.

        A `Contended` result (the lock is merely BUSY right now — see
        `desktop_project_lock.refresh`'s doc) is mapped to a "soft success"
        instead, ONLY when the cached record actually belongs to `token`
        AND the per-path consecutive-soft-success streak has budget left —
        see this module's "round-3 hardening" doc section for the full
        rationale; both are genuine single-writer safety gates, not just
        defensive style. `write_project_file`'s own re-verification at
        actual write time is what stays authoritative regardless."""
        granted = self._consented_write_or_none(path)
        if granted is None:
            return {"refreshed": False, "error": "path not consented for writing"}
        ok, record = lockmod.refresh(granted, token, now=time.time())
        if isinstance(record, lockmod.Contended):
            cached = self._last_known_lock_record.get(granted)
            streak = self._contended_streak.get(granted, 0)
            if (
                cached is not None
                and cached.token == token  # F1/F4: never echo a DIFFERENT token's record
                and streak < _MAX_CONSECUTIVE_CONTENDED_SOFT_SUCCESSES
            ):
                self._contended_streak[granted] = streak + 1
                result = _lock_result(cached, outcome_key="refreshed", outcome_value=True)
                result["contended"] = True  # additive diagnostic only — safe to ignore
                return result
            # No matching cached record, or the streak budget is spent —
            # fall through to the honest refusal (the frontend demotes).
            self._contended_streak.pop(granted, None)
            return _lock_result(record, outcome_key="refreshed", outcome_value=False)
        self._contended_streak.pop(granted, None)  # any non-contended outcome resets the streak
        self._remember(granted, ok, record)
        return _lock_result(record, outcome_key="refreshed", outcome_value=ok)

    def project_lock_takeover(self, path: str, expected_token: str) -> dict[str, Any]:
        """CAS takeover of a STALE lock. Refuses (rather than clobbering)
        when `expected_token` no longer matches what's on disk — someone
        else (the original holder's own heartbeat, or a third instance)
        already moved."""
        granted = self._consented_write_or_none(path)
        if granted is None:
            return {"acquired": False, "error": "path not consented for writing"}
        ok, record = lockmod.take_over(granted, expected_token, self._instance_id, now=time.time())
        self._remember(granted, ok, record)
        return _lock_result(record, outcome_key="acquired", outcome_value=ok)

    def project_lock_release(self, path: str, token: str) -> dict[str, Any]:
        """Release this instance's own lock. Never raises — a Windows
        delete-while-open failure (see `desktop_project_lock.release`'s doc)
        reports `released: False` with a reason instead."""
        granted = self._consented_write_or_none(path)
        if granted is None:
            return {"released": False, "error": "path not consented for writing"}
        released, reason = lockmod.release(granted, token)
        if released:
            self._last_known_lock_record.pop(granted, None)
            self._contended_streak.pop(granted, None)
        out: dict[str, Any] = {"released": released}
        if reason is not None:
            out["error"] = reason
        return out

    def _consented_write_or_none(self, path: str) -> str | None:
        try:
            resolved = os.path.realpath(path)
        except (OSError, ValueError):
            return None
        return consented_write_path(resolved)

    def _remember(self, granted: str, ok: bool, record: object) -> None:
        """Cache `record` for `granted` ONLY when `ok` is `True` — i.e.
        ONLY when THIS call was a genuine SUCCESS FOR THIS INSTANCE
        (acquired/refreshed/took-over its OWN lock). Round-3 fix: the
        prior version cached on ANY `LockRecord`, including a REFUSAL's
        record (which belongs to whoever currently holds the lock — not
        necessarily this instance) — see this module's "round-3
        hardening" doc section for the token-laundering path that opened.
        A no-op for a refusal, `UnverifiableLock`, or `Contended`."""
        if ok and isinstance(record, lockmod.LockRecord):
            self._last_known_lock_record[granted] = record


def _fsync_directory_best_effort(directory: str) -> None:
    """After ``os.replace`` lands the new file, best-effort ``fsync`` the
    CONTAINING directory so the renamed directory entry itself is durable
    sooner too — POSIX only; there is no directory file descriptor to open
    on Windows, and NFS/some filesystems reject it regardless. Swallowed on
    purpose: the file's own ``fsync`` (before the replace, in ``_replace``
    above) is what makes the *content* durable-ordered — this call only
    narrows the window in which the rename itself could still be lost to a
    crash, and a save must never be reported as failed over a step that is
    inherently unsupported on part of the fleet."""
    try:
        fd = os.open(directory, os.O_RDONLY)
    except (OSError, AttributeError):
        return
    try:
        os.fsync(fd)
    except (OSError, AttributeError):
        pass
    finally:
        os.close(fd)


def _lock_result(record: object, *, outcome_key: str, outcome_value: bool | None) -> dict[str, Any]:
    """Shared JSON shape for every lock bridge method above: the outcome
    under `outcome_key` (`None` for `project_lock_read`, which has no
    success/failure of its own — it only reports what's on disk), plus
    whatever record/reason is known. A `LockRecord` serializes to its
    fields; an `UnverifiableLock` OR a `Contended` (the OS lock is busy
    RIGHT NOW — see that class's doc) both serialize to
    `{"unverifiable": True, "error": ...}` — the SAME wire flag, since the
    frontend already treats it identically and conservatively either way
    ("cannot verify right now — read-only, never assume free"); the two
    are kept as DISTINCT Python types purely so this module and
    `desktop_project_lock.py` can reason about them precisely (e.g.
    `project_lock_refresh`'s bespoke "soft success" mapping for
    `Contended`, which intercepts it BEFORE it ever reaches this shared
    helper). Anything else serializes to `"record": None`."""
    out: dict[str, Any] = {outcome_key: outcome_value}
    if isinstance(record, lockmod.LockRecord):
        out["record"] = {
            "version": record.version,
            "token": record.token,
            "instanceId": record.instance_id,
            "hostname": record.hostname,
            "pid": record.pid,
            "acquiredAt": record.acquired_at,
            "heartbeatAt": record.heartbeat_at,
        }
    elif isinstance(record, (lockmod.UnverifiableLock, lockmod.Contended)):
        out["record"] = None
        out["unverifiable"] = True
        out["error"] = record.reason
    else:
        out["record"] = None
    return out
