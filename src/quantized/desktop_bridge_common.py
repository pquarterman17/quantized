"""Tiny helpers shared by more than one desktop-bridge mixin.

Both :mod:`quantized.desktop_bridge_dialogs` (``DesktopDialogBridge``) and
:mod:`quantized.desktop_bridge_pack` (``DesktopPackBridge``) need to resolve
pywebview's dialog-kind constants the same best-effort way (``webview`` is
an OPTIONAL extra — see either module's own doc for why the fallback
matters). Before this module existed each one carried its own private copy
of ``_dialog_kind``/``_FOLDER_DIALOG_DEFAULT``; review finding #10
(P1.7 "Pack Project" PR 4) promotes the one implementation here instead so
neither reaches across the other's underscore-prefixed surface, and a
future dialog kind is added in exactly one place.
"""

from __future__ import annotations

__all__ = [
    "FOLDER_DIALOG_DEFAULT",
    "OPEN_DIALOG_DEFAULT",
    "SAVE_DIALOG_DEFAULT",
    "dialog_kind",
]

# pywebview's documented dialog-kind constants. Resolved from the module
# when it is importable, with these as the fallback, because `webview` is
# an OPTIONAL extra (`pip install quantized[desktop]`): requiring it merely
# to name a constant would make an importing module untestable on a plain
# install, even though the only part that genuinely needs pywebview is the
# window object the launcher injects.
OPEN_DIALOG_DEFAULT = 10
FOLDER_DIALOG_DEFAULT = 20
SAVE_DIALOG_DEFAULT = 30


def dialog_kind(name: str, fallback: int) -> int:
    """Resolve ``webview.<name>`` when the optional ``webview`` package is
    installed and defines an int-valued attribute of that name; otherwise
    ``fallback``."""
    try:
        import webview

        value = getattr(webview, name, fallback)
        return int(value) if isinstance(value, int) else fallback
    except ImportError:
        return fallback
