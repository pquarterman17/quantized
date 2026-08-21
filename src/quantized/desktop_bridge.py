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
``path_status``, ``save_file_dialog``, ``open_project_file``,
``read_project_file``, ``probe_source``, ``grant_source_paths``) live on the
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
"""

from __future__ import annotations

import os
import tempfile
import time
import uuid
from typing import Any

from quantized import desktop_project_lock as lockmod
from quantized.desktop_bridge_dialogs import DesktopDialogBridge
from quantized.desktop_consent import consented_write_path
from quantized.desktop_project_file import (
    WRITE_TEMP_PREFIX,
    cleanup_stray_write_temps,
    validate_workspace_payload,
)

__all__ = ["DesktopApi"]


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
        path. ``content`` must pass ``validate_workspace_payload`` or the
        write is refused before a temp file is even opened.

        **I2 lock-token binding (P1-1):** when `lock_token` is non-empty, it
        is verified via `desktop_project_lock.token_still_valid` —
        IMMEDIATELY before the write, under the SAME exclusive-OS-lock CAS
        every other lock mutation uses (never a plain, separately-timed
        read) — this is what closes the save TOCTOU the read/classify/
        unconditional-write shape left open (a session that lost the lock
        between its last heartbeat and this save must never land its
        write). A mismatch (including an unverifiable lock file) refuses
        with a DISTINCT error string (`"error": "lock lost"`) the frontend
        recognizes and surfaces as exactly that, rather than a generic
        write failure. An EMPTY token, OR no lock file existing at all for
        `path`, skips the check entirely — the pre-I2, no lock-provider-
        wired behavior — so a caller that never acquired a lock (or the
        browser/in-memory-only path) writes exactly as before.
        """
        try:
            resolved = os.path.realpath(path)
        except (OSError, ValueError) as exc:
            return {"ok": False, "error": str(exc)}
        granted = consented_write_path(resolved)
        if granted is None:
            return {"ok": False, "error": "path not consented for writing"}
        if lock_token and not lockmod.token_still_valid(granted, lock_token):
            return {"ok": False, "error": "lock lost"}
        invalid = validate_workspace_payload(content)
        if invalid is not None:
            return {"ok": False, "error": f"refusing to write — {invalid}"}
        directory = os.path.dirname(granted) or "."
        cleanup_stray_write_temps(directory)
        tmp_path: str | None = None
        try:
            fd, tmp_path = tempfile.mkstemp(prefix=WRITE_TEMP_PREFIX, dir=directory)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(content)
                os.replace(tmp_path, granted)
                tmp_path = None  # replaced — nothing left to clean up
            finally:
                if tmp_path is not None:
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass
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
        return _lock_result(record, outcome_key="acquired", outcome_value=ok)

    def project_lock_read(self, path: str) -> dict[str, Any]:
        """Read the current lock record for `path` with no side effect —
        for a caller that wants to classify a lock (fresh/stale/none)
        without attempting to acquire it."""
        granted = self._consented_write_or_none(path)
        if granted is None:
            return {"record": None, "error": "path not consented for writing"}
        return _lock_result(lockmod.read(granted), outcome_key="acquired", outcome_value=None)

    def project_lock_refresh(self, path: str, token: str) -> dict[str, Any]:
        """Heartbeat bump for a lock this instance believes it holds. A
        token mismatch (including "no lock file" / "unverifiable") reports
        `refreshed: False` — the caller must drop to read-only, never keep
        assuming it still writes."""
        granted = self._consented_write_or_none(path)
        if granted is None:
            return {"refreshed": False, "error": "path not consented for writing"}
        ok, record = lockmod.refresh(granted, token, now=time.time())
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
        return _lock_result(record, outcome_key="acquired", outcome_value=ok)

    def project_lock_release(self, path: str, token: str) -> dict[str, Any]:
        """Release this instance's own lock. Never raises — a Windows
        delete-while-open failure (see `desktop_project_lock.release`'s doc)
        reports `released: False` with a reason instead."""
        granted = self._consented_write_or_none(path)
        if granted is None:
            return {"released": False, "error": "path not consented for writing"}
        released, reason = lockmod.release(granted, token)
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


def _lock_result(record: object, *, outcome_key: str, outcome_value: bool | None) -> dict[str, Any]:
    """Shared JSON shape for every lock bridge method above: the outcome
    under `outcome_key` (`None` for `project_lock_read`, which has no
    success/failure of its own — it only reports what's on disk), plus
    whatever record/reason is known. A `LockRecord` serializes to its
    fields; an `UnverifiableLock` serializes to `{"unverifiable": True,
    "error": ...}` (never raised, never silently treated as "no lock" — the
    frontend must treat this as cannot-verify -> read-only, same as the pure
    module's own doc requires); anything else serializes to `"record":
    None`."""
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
    elif isinstance(record, lockmod.UnverifiableLock):
        out["record"] = None
        out["unverifiable"] = True
        out["error"] = record.reason
    else:
        out["record"] = None
    return out
