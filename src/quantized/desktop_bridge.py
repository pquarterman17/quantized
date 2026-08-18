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

``window.pywebview.api`` (this class) is the pywebview half of the
shell-agnostic frontend contract in ``frontend/src/lib/desktopBridge.ts``
(``openFiles`` / ``openProject`` / ``saveProjectAs`` / ``saveProjectTo`` /
``probe``). The js_api methods below are the snake_case wire format those
functions call:

* ``probe()`` -> capability dict (``shell``, ``canPickFiles``, ...).
* ``pick_files(directory, multiple)`` -> ``{"paths": [...]}`` (import flow).
* ``pick_directory(directory)`` -> ``{"path": ...}`` (working-directory flow).
* ``path_status(path)`` -> ``{"state": "ok"|"missing"|"offline"|"invalid"}``.
* ``save_file_dialog(suggested_name)`` -> ``{"path": ...}``, grants WRITE
  consent for the chosen destination.
* ``write_project_file(path, content)`` -> ``{"ok": bool, "path"?: ...}``,
  writes ONLY to a write-consented path (temp file + ``os.replace``).
* ``open_project_file(directory)`` -> ``{"path": ..., "content": ...}``,
  native OPEN dialog + an in-process read of the chosen project file; grants
  READ consent for it.
* ``read_project_file(path)`` -> ``{"path": ..., "content": ...}``, re-reads
  a path already covered by a read OR write grant from earlier this
  process — no new dialog (the Recent Projects reopen path).
* ``probe_source(path)`` -> reachability + optional checksum for P1.7
  relink (see "P1.7" section below for the consent ruling).
* ``grant_source_paths(paths)`` -> ``{"paths": [...]}``, extends read
  consent to a project's own already-recorded source paths (P1.7).

**``null`` vs. cancel, everywhere in this contract:** every dialog method
here returns a well-formed dict even on cancel or on a recoverable dialog
failure (``{"path": None}``, optionally with an ``"error"`` string) — it
never raises into JS. The FRONTEND is what turns that into the two distinct
outcomes callers must not conflate: a missing/broken bridge method reports
``null`` ("no usable bridge — fall back to the browser input/download"),
while a well-formed cancel result reports ``[]`` (list calls) or a distinct
cancel value (single-result calls) meaning "the user backed out — do
NOTHING, never fall back". See ``desktopBridge.ts``'s own module doc for the
exact frontend-side rule; this module only needs to never collapse "cancel"
and "error" into an exception, so the frontend has something to inspect.

**Write consent, the new rule this slice adds:** a path is writable through
``write_project_file`` ONLY when ``save_file_dialog`` (or, in tests, a
directly-called ``desktop_consent.grant_write_path``) returned it THIS
process. Read consent (from ``pick_files``/``open_project_file``) does NOT
double as write consent, and vice versa — see ``desktop_consent``'s module
doc for why the two grant kinds are kept apart. There is still, deliberately,
no HTTP route that grants either kind: every grant originates from a modal
OS dialog the js_api bridge itself invoked, so a hostile page loaded in the
window can request `write_project_file` all it wants and it will refuse
every path it did not itself get back from a real dialog.

**Explicitly deferred (not this slice):**

* **Tauri wiring.** ``desktopBridge.ts``'s ``shell`` discriminant already
  types ``"tauri"`` and ``"browser"`` alongside ``"pywebview"``, but nothing
  here implements a Tauri backend — that needs its own contract PR, because
  Tauri's IPC crosses a process boundary with a different consent story
  (Rust-side dialog plugin, not an in-process Python object) than this
  same-process pywebview bridge.
* **Project identity / dirty-state tracking** (open path, unsaved-changes
  indicator, "Save" vs. "Save As") — P1.2's. This slice's ``saveProjectTo``
  exists in the frontend contract and is exercised at the bridge-client
  level, but nothing in this PR calls it from a UI command yet; the one
  wired File-menu save command always goes through ``saveProjectAs``
  (native "Save As" every time), matching today's single "Save workspace"
  command having no separate "Save" affordance to begin with.
* **Packaged Windows/macOS E2E** covering the full native lifecycle —
  P1.1's own checklist owner item, unblocked by this slice but not shipped
  by it (this PR's tests run the bridge logic against ``FakeWindow``, never
  a packaged app).

## P1.7: source probing + the consent ruling for relink

``probe_source(path)`` and ``grant_source_paths(paths)`` (below) exist for
project portability / source relinking (PRIMARY_SOFTWARE_AUDIT_PLAN.md's
P1.7): distinguishing missing / offline / changed / permission-denied source
states, and computing the checksum a "did this source's CONTENT change"
verdict needs (``lib/relink.ts``'s ``sourceChangeVerdict``).

**The ruling (P1-A fix, adversarial review round; full mechanics in
``desktop_consent.py``'s "declared sources" section).** A checksum reads a
file's full bytes — bigger than the consent-free ``path_status`` reachability
check above — but a fresh OPEN dialog per relinked file would make relinking
hundreds of datasets pop hundreds of dialogs. An EARLIER version of
``grant_source_paths`` was a bare passthrough to ``grant_paths`` reasoning
"the frontend only ever asks for its own project's sources" — that reasoning
does not hold (the frontend's argument is caller-supplied input like any
other), and made this method an unconditional, un-gated arbitrary-file-read-
consent oracle: any JS in the window, no dialog, no project even open, could
self-grant read consent for any path (e.g. a user's SSH key).

The fix reuses (does NOT invent a parallel kind of) ``desktop_consent``'s
existing read-grant store, gated by a NEW server-tracked *declared-source
set*: ``_read_granted`` (below — ``open_project_file``/``read_project_file``,
both reached only via a real native OPEN dialog) records exactly what a
just-opened project's OWN payload names as dataset sources
(``set_declared_sources``); ``grant_source_paths`` intersects its request
against that set before ever calling ``grant_paths``, silently dropping
anything the currently-open project didn't itself declare. The frontend's
argument list is a REQUEST against backend-tracked state, never an authority
— no HTTP route, no separate js_api, can add to that set directly. Residual,
accepted scope: whatever the OPENED project's own payload declares is still
eligible (same trust act as ``pick_files`` granting whatever a user
physically selected, applied to content instead of selection) — this fix
closes the unconditional oracle, not full sandboxing against a hostile
payload's own declared paths.

``probe_source`` itself still computes a checksum ONLY when the resolved
path is ALREADY read-consented (``desktop_consent.is_consented``) at call
time — a path nobody granted gets state/size/mtime only, never content.
"""

from __future__ import annotations

import os
import tempfile
from typing import Any

from quantized.desktop_consent import (
    consented_path,
    consented_write_path,
    grant_paths,
    grant_write_path,
    is_consented,
    is_declared_source,
    set_declared_sources,
)
from quantized.desktop_project_file import (
    WRITE_TEMP_PREFIX,
    cleanup_stray_write_temps,
    extract_declared_source_paths,
    validate_workspace_payload,
)
from quantized.desktop_source_probe import probe_source_path, volume_present

__all__ = ["DesktopApi", "IMPORT_FILE_TYPES", "PROJECT_FILE_TYPES"]

# Shown in the native dialog's format dropdown. Mirrors the frontend's
# IMPORT_ACCEPT list; "All files" stays LAST but present, because an instrument
# writing an unregistered extension is common and a dialog that cannot open it
# would be worse than a permissive filter.
IMPORT_FILE_TYPES: tuple[str, ...] = (
    (
        "Data files (*.dat;*.csv;*.txt;*.tsv;*.xy;*.xye;*.raw;*.brml;*.xrdml;"
        "*.opj;*.opju;*.h5;*.hdf5;*.nxs;*.spc;*.dx;*.jdx;*.cif;*.refl;*.ogs)"
    ),
    "Origin projects (*.opj;*.opju)",
    "All files (*.*)",
)

# pywebview's documented dialog-kind constants. Resolved from the module when
# it is importable, with these as the fallback, because `webview` is an OPTIONAL
# extra (`pip install quantized[desktop]`): requiring it merely to name a
# constant would make this whole module unimportable — and untestable — on a
# plain install, even though the only part that genuinely needs pywebview is the
# window object the launcher injects.
_OPEN_DIALOG_DEFAULT = 10
_FOLDER_DIALOG_DEFAULT = 20
_SAVE_DIALOG_DEFAULT = 30

# The native dialog's format filter for a Quantized project (a ".dwk" is JSON
# under the hood — see lib/workspace.ts's serialization — so ".json" stays
# openable too, mirroring the frontend's ".dwk,.json" browser-input accept).
PROJECT_FILE_TYPES: tuple[str, ...] = (
    "Quantized workspaces (*.dwk;*.json)",
    "All files (*.*)",
)


def _dialog_kind(name: str, fallback: int) -> int:
    try:
        import webview

        value = getattr(webview, name, fallback)
        return int(value) if isinstance(value, int) else fallback
    except ImportError:
        return fallback


class DesktopApi:
    """The object pywebview exposes at ``window.pywebview.api``.

    Every method is callable from the page, so each one is written as if the
    caller were hostile. The protection is not in this class: opening a modal
    OS dialog requires a human to choose a file, and nothing here can grant
    consent for a path the dialog did not return.
    """

    def __init__(self) -> None:
        self._window: Any = None

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

    # -- dialogs ------------------------------------------------------------

    def pick_files(self, directory: str = "", multiple: bool = True) -> dict[str, Any]:
        """Open a native open-file dialog; return the chosen paths.

        The returned paths are CONSENTED as a side effect, which is what lets
        the ordinary import route read them even from a network share outside
        the allowed roots. They are returned already ``realpath``-normalized so
        the frontend sends back exactly the string the guard will match.

        Cancelling is not an error: it returns an empty list, because a user
        backing out of a dialog is a normal outcome and should not surface as a
        failure toast.
        """
        if self._window is None:
            return {"paths": [], "error": "no window attached"}
        try:
            chosen = self._window.create_file_dialog(
                _dialog_kind("OPEN_DIALOG", _OPEN_DIALOG_DEFAULT),
                directory=directory or os.getcwd(),
                allow_multiple=multiple,
                file_types=IMPORT_FILE_TYPES,
            )
        except Exception as exc:  # noqa: BLE001 - reported to JS, never raised into it
            return {"paths": [], "error": str(exc)}
        if not chosen:
            return {"paths": []}  # cancelled
        return {"paths": grant_paths(list(chosen))}

    def pick_directory(self, directory: str = "") -> dict[str, Any]:
        """Open a native folder dialog — the working-directory selector.

        A directory grants NO read consent by itself (consent is per file, see
        desktop_consent), so this only supplies a starting point for later file
        dialogs and a label for the working-path list.
        """
        if self._window is None:
            return {"path": None, "error": "no window attached"}
        try:
            chosen = self._window.create_file_dialog(
                _dialog_kind("FOLDER_DIALOG", _FOLDER_DIALOG_DEFAULT),
                directory=directory or os.getcwd(),
            )
        except Exception as exc:  # noqa: BLE001
            return {"path": None, "error": str(exc)}
        if not chosen:
            return {"path": None}  # cancelled
        first = chosen[0] if isinstance(chosen, (list, tuple)) else chosen
        try:
            return {"path": os.path.realpath(str(first))}
        except (OSError, ValueError) as exc:
            return {"path": None, "error": str(exc)}

    # -- path status --------------------------------------------------------

    def path_status(self, path: str) -> dict[str, Any]:
        """Distinguish "missing" from "temporarily offline" (#31).

        A vanished network share and a deleted file look identical to a naive
        ``exists()`` check, and treating the first as the second is how an app
        talks a user into re-picking or discarding a source that is fine and
        will be back. So a file is only ``missing`` when the volume it lives on
        is demonstrably present; when the volume itself is gone, that is
        ``offline`` and nothing downstream should offer to clean it up.
        """
        try:
            resolved = os.path.realpath(path)
        except (OSError, ValueError):
            return {"state": "invalid"}
        if os.path.isfile(resolved):
            return {"state": "ok", "path": resolved}
        return {
            "state": "missing" if volume_present(resolved) else "offline",
            "path": resolved,
        }

    # -- source probing / relink (P1.7) --------------------------------------

    def probe_source(self, path: str) -> dict[str, Any]:
        """Reachability + fingerprint of a dataset's recorded SOURCE path, for
        relink's missing/offline/changed/permission-denied distinction
        (P1.7 box 4). A superset of `path_status` above: same state values
        PLUS `permission_denied`, and — only when `path` is already READ-
        consented this process — a `checksum` a caller can diff against a
        dataset's recorded provenance to answer "did the content change".
        See this module's own doc for the full consent ruling; the short
        version is that `is_consented` gates the checksum, never the
        reachability check (which stays as unguarded as `path_status`
        always was)."""
        try:
            resolved = os.path.realpath(path)
        except (OSError, ValueError):
            return {"state": "invalid"}
        return probe_source_path(resolved, compute_checksum=is_consented(resolved))

    def grant_source_paths(self, paths: list[str]) -> dict[str, Any]:
        """Extend READ consent to paths the CALLER ASSERTS are a dataset's
        source in the project open in this app — NOT taken on faith (P1-A
        fix; see this module's doc). Intersected against the server-tracked
        declared-source set (populated only from a payload THIS process
        itself read via a real dialog, `_read_granted`) before ever
        reaching `grant_paths`; anything not declared is silently dropped."""
        eligible: list[str] = []
        for p in paths:
            try:
                resolved = os.path.realpath(p)
            except (OSError, ValueError):
                continue
            if is_declared_source(resolved):
                eligible.append(resolved)
        return {"paths": grant_paths(eligible)}

    # -- project save (P1.1 C2) ----------------------------------------------

    def save_file_dialog(self, suggested_name: str = "") -> dict[str, Any]:
        """Open a native SAVE dialog and grant WRITE consent for the chosen
        destination — read consent is a separate, unaffected grant (see
        desktop_consent's module doc): picking where to save never authorizes
        reading anything.

        Cancelling returns ``{"path": None}``, same non-error convention as
        every other dialog method here."""
        if self._window is None:
            return {"path": None, "error": "no window attached"}
        try:
            chosen = self._window.create_file_dialog(
                _dialog_kind("SAVE_DIALOG", _SAVE_DIALOG_DEFAULT),
                save_filename=suggested_name or "workspace.dwk",
                file_types=PROJECT_FILE_TYPES,
            )
        except Exception as exc:  # noqa: BLE001 - reported to JS, never raised into it
            return {"path": None, "error": str(exc)}
        if not chosen:
            return {"path": None}  # cancelled
        first = chosen[0] if isinstance(chosen, (list, tuple)) else chosen
        try:
            resolved = os.path.realpath(str(first))
        except (OSError, ValueError) as exc:
            return {"path": None, "error": str(exc)}
        granted = grant_write_path(resolved)
        if granted is None:
            return {"path": None, "error": "could not grant write consent"}
        return {"path": granted}

    def write_project_file(self, path: str, content: str) -> dict[str, Any]:
        """Write ``content`` to ``path`` IN-PROCESS — never through an HTTP
        route, which is what keeps desktop_consent's "no HTTP route grants
        (or spends) consent" boundary intact for writes too.

        Refuses any path that was not returned by ``save_file_dialog`` this
        process — the new rule this slice adds; a stray path from anywhere
        else in the JS layer must not be writable just because it was asked
        for. The write itself is temp-file-plus-``os.replace`` (same
        directory, so the replace is atomic on a normal filesystem) so a
        crash mid-write cannot leave a half-written ``.dwk`` at the real
        path.

        P1.2 box 2 adds a VALIDATION gate ahead of the replace: ``content``
        must pass ``validate_workspace_payload`` or the write is refused
        before a temp file is even opened — a bad payload can never
        overwrite a good project file, and whatever was previously at
        ``path`` is left byte-identical.

        P1.2 (adversarial review round) also sweeps stale ``.qz-write-*``
        temp files out of the TARGET directory before creating a new one —
        the crash window this docstring used to punt to "P1.2" (a process
        killed between the temp write succeeding and ``os.replace`` running)
        left an anonymous half-written file behind forever, since nothing
        ever looked for one. The prefix is exclusively ours, so anything
        matching it in a write-consented directory is safe to remove; the
        sweep is best-effort (``cleanup_stray_write_temps`` never raises)
        so a failed cleanup — a permissions error, a race with another
        process — can never turn an otherwise-successful save into a
        reported failure."""
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

    # -- project open (P1.1 C3's "minimal read path") ------------------------

    def _read_granted(self, path: str) -> dict[str, Any]:
        """Shared by `open_project_file` (after a fresh pick) and
        `read_project_file` (an already-consented path, no new dialog):
        read `path` IN-PROCESS if EITHER a read or a write grant covers it —
        a project saved earlier this session is reopenable without a second
        dialog even though `save_file_dialog` only ever granted WRITE.

        P1.7 (P1-A fix): a successful read here IS a project open/reopen, so
        it also records what that payload declares as its dataset sources
        (`set_declared_sources`, wholesale-replacing any prior project's) —
        what `grant_source_paths` enforces against; see this module's doc.
        Never runs on a `None`/error read, nor on a save, so a Save-As can't
        retroactively "declare" a dataset list before it's ever reopened."""
        try:
            resolved = os.path.realpath(path)
        except (OSError, ValueError) as exc:
            return {"path": None, "error": str(exc)}
        granted = consented_path(resolved) or consented_write_path(resolved)
        if granted is None:
            return {"path": None, "error": "path not consented — use the dialog"}
        try:
            with open(granted, encoding="utf-8") as f:
                content = f.read()
        except OSError as exc:
            return {"path": granted, "error": str(exc)}
        set_declared_sources(extract_declared_source_paths(content))
        return {"path": granted, "content": content}

    def open_project_file(self, directory: str = "") -> dict[str, Any]:
        """Native OPEN dialog filtered to project files, then an in-process
        read of the chosen file. The read stays off HTTP entirely (no new
        route needed to serve project bytes) — this IS "the bridge's open
        returning the file content" the frontend contract calls for."""
        if self._window is None:
            return {"path": None, "error": "no window attached"}
        try:
            chosen = self._window.create_file_dialog(
                _dialog_kind("OPEN_DIALOG", _OPEN_DIALOG_DEFAULT),
                directory=directory or os.getcwd(),
                allow_multiple=False,
                file_types=PROJECT_FILE_TYPES,
            )
        except Exception as exc:  # noqa: BLE001
            return {"path": None, "error": str(exc)}
        if not chosen:
            return {"path": None}  # cancelled
        first = chosen[0] if isinstance(chosen, (list, tuple)) else chosen
        granted = grant_paths([str(first)])
        if not granted:
            return {"path": None, "error": "selected path is not a readable file"}
        return self._read_granted(granted[0])

    def read_project_file(self, path: str) -> dict[str, Any]:
        """Re-read an already-consented project path with NO new dialog —
        reopening a Recent Projects entry from earlier this session. Consent
        is per-process (desktop_consent's module doc), so a lapsed grant
        (e.g. after an app restart) reports an error here rather than
        silently reading; the frontend degrades to the ordinary dialog, the
        same way a missing/offline Recent entry does for datasets."""
        return self._read_granted(path)
