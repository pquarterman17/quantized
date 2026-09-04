"""Native-dialog + project-file-READ half of :mod:`quantized.desktop_bridge`'s
``DesktopApi``.

Split out once ``desktop_bridge.py`` was about to cross the repo's 500-line
god-module ceiling (``tests/test_repo_integrity.py``) — the I2 audit fix
(P0-3/P1-1, ``plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md``) adds five new
``project_lock_*`` js_api methods to that module, which would have pushed it
over.

**The seam:** everything here either invokes a native OS dialog
(``self._window.create_file_dialog``) or is the READ-side project-file path
those dialogs feed into (``open_project_file`` / ``read_project_file`` /
their shared ``_read_granted`` helper). What stays in ``desktop_bridge.py``
itself is the WRITE side — ``write_project_file`` (now also verifying a lock
token) — and the new lock bridge methods, which is the part this slice
actually needed room to grow.

This is a MIXIN, not a standalone class: ``DesktopApi`` in
``desktop_bridge.py`` inherits from :class:`DesktopDialogBridge` so
pywebview still sees ONE object at ``window.pywebview.api`` with every
method on it directly (pywebview does not support multiple ``js_api``
objects the way this split might otherwise suggest). ``self._window`` and
``self.attach()`` are provided by ``DesktopApi.__init__``/``attach`` — this
module only declares the attribute's type, exactly the same "every method
is written as if the caller were hostile; the protection is a real OS
dialog, not this class" contract ``desktop_bridge.py``'s own module doc
states, unchanged by the split.
"""

from __future__ import annotations

import os
from typing import Any

from quantized.desktop_consent import (
    clear_dir_grants,
    consented_path,
    consented_write_path,
    grant_paths,
    grant_read_dir,
    grant_write_path,
    is_consented,
    is_declared_source,
    is_dir_consented,
    set_declared_sources,
)
from quantized.desktop_project_file import extract_declared_source_paths
from quantized.desktop_source_probe import probe_source_path, volume_present

__all__ = ["DesktopDialogBridge", "IMPORT_FILE_TYPES", "PROJECT_FILE_TYPES"]

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

# The native dialog's format filter for a Quantized project (a ".dwk" is JSON
# under the hood — see lib/workspace.ts's serialization — so ".json" stays
# openable too, mirroring the frontend's ".dwk,.json" browser-input accept).
PROJECT_FILE_TYPES: tuple[str, ...] = (
    "Quantized workspaces (*.dwk;*.json)",
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


def _dialog_kind(name: str, fallback: int) -> int:
    try:
        import webview

        value = getattr(webview, name, fallback)
        return int(value) if isinstance(value, int) else fallback
    except ImportError:
        return fallback


class DesktopDialogBridge:
    """Mixin providing every native-dialog and project-READ js_api method.
    See this module's doc for why it is a mixin rather than its own exposed
    object."""

    _window: Any  # set by DesktopApi.__init__ / .attach()

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
        dialogs and a label for the working-path list. See
        `pick_relink_directory` below for the ONE folder dialog that DOES
        grant something — a deliberately separate method, not a flag on this
        one, so this docstring's "grants NO read consent" claim stays true
        for every existing caller unchanged.
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

    def pick_relink_directory(self, directory: str = "") -> dict[str, Any]:
        """Native folder dialog for the relink panel's "Browse..." control
        (C1). Unlike `pick_directory` above, the folder returned here IS
        immediately granted READ-ONLY consent to inspect itself and its
        descendants for the rest of this process, until revoked
        (`revoke_relink_dir` below; also project-change and app-exit — see
        `desktop_consent`'s module doc) — this dialog return IS the
        deliberate consent gesture, the same "the dialog itself is the
        proof" precedent `pick_files` already relies on for its own
        (per-file) grant. Never satisfies a write-consent check, never
        widens `/import`'s existing root confinement (an unrelated guard),
        and is reachable only from this native dialog's own return — a
        typed/pasted path can never produce a grant through this or any
        other method.
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
        granted = grant_read_dir(str(first))
        if granted is None:
            return {"path": None, "error": "selected path is not a readable directory"}
        return {"path": granted}

    def revoke_relink_dir(self) -> dict[str, Any]:
        """Revoke every directory grant minted by `pick_relink_directory`
        this session. Called by the frontend when the relink panel closes
        (Cancel, the window's own close, or a completed commit) so the
        read-only grant never outlives the session that asked for it.
        Idempotent — safe to call with nothing granted."""
        clear_dir_grants()
        return {"ok": True}

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
        (P1.7 box 4). See ``desktop_bridge.py``'s module doc for the full
        consent ruling; the short version is that a checksum is computed
        only when `path` is read-consented, never for the reachability
        check itself. Two independent grants can satisfy that, checked with
        equal weight: an exact per-file grant (`is_consented` — e.g. a
        relink OLD path, already declared by the open project) or a C1
        directory grant covering it (`is_dir_consented` — e.g. a relink
        CANDIDATE path under a `pick_relink_directory`-granted new root).
        Neither is a write grant; this method only ever reads."""
        try:
            resolved = os.path.realpath(path)
        except (OSError, ValueError):
            return {"state": "invalid"}
        consented = is_consented(resolved) or is_dir_consented(resolved)
        return probe_source_path(resolved, compute_checksum=consented)

    def grant_source_paths(self, paths: list[str]) -> dict[str, Any]:
        """Extend READ consent to paths the CALLER ASSERTS are a dataset's
        source in the project open in this app — NOT taken on faith (P1-A
        fix; see ``desktop_bridge.py``'s doc). Intersected against the
        server-tracked declared-source set before ever reaching
        `grant_paths`; anything not declared is silently dropped."""
        eligible: list[str] = []
        for p in paths:
            try:
                resolved = os.path.realpath(p)
            except (OSError, ValueError):
                continue
            if is_declared_source(resolved):
                eligible.append(resolved)
        return {"paths": grant_paths(eligible)}

    # -- project save destination (write itself lives in DesktopApi) --------

    def save_file_dialog(self, suggested_name: str = "") -> dict[str, Any]:
        """Open a native SAVE dialog and grant WRITE consent for the chosen
        destination — read consent is a separate, unaffected grant (see
        desktop_consent's module doc): picking where to save never authorizes
        reading anything.

        P1.2 box 4: if the chosen destination is a path the OPEN project's
        own payload declared as a dataset's ``source.path``
        (``is_declared_source``), NOTHING is granted — the user picked their
        own raw source file in the save dialog, which ``write_project_file``
        would refuse anyway, but refusing here means a stray write-consent
        grant for that path is never even minted, and the frontend gets a
        distinguishable error instead of a generic "could not grant" one.

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
        if is_declared_source(resolved):
            return {
                "path": None,
                "error": "refusing to save — that path is a data source of the open project",
            }
        granted = grant_write_path(resolved)
        if granted is None:
            return {"path": None, "error": "could not grant write consent"}
        return {"path": granted}

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
        what `grant_source_paths` enforces against; see `desktop_bridge.py`'s
        doc. Never runs on a `None`/error read, nor on a save, so a Save-As
        can't retroactively "declare" a dataset list before it's ever
        reopened.

        C1: the SAME "project change" moment also revokes every relink
        directory grant (`clear_dir_grants`) — a folder grant minted for
        project A's relink session must not silently keep covering project
        B's candidate paths after A closes and B opens."""
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
        clear_dir_grants()
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
