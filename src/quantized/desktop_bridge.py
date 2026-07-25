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
"""

from __future__ import annotations

import os
from typing import Any

from quantized.desktop_consent import grant_paths

__all__ = ["DesktopApi", "IMPORT_FILE_TYPES"]

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
        will be back. So: report the file, and separately whether its ROOT is
        currently reachable. A missing file whose root is also unreachable is
        reported as ``offline``, never as ``missing``.
        """
        try:
            resolved = os.path.realpath(path)
        except (OSError, ValueError):
            return {"state": "invalid"}
        if os.path.isfile(resolved):
            return {"state": "ok", "path": resolved}
        anchor = os.path.splitdrive(resolved)[0] or os.sep
        try:
            root_reachable = os.path.isdir(anchor)
        except OSError:
            root_reachable = False
        return {"state": "missing" if root_reachable else "offline", "path": resolved}
