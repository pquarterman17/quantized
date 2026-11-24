"""Opt-in right-click "Convert with Quantized" entry (``qz convert
--install-context-menu`` / ``--uninstall-context-menu``).

Both run ``qz convert --gui <file>`` (:mod:`quantized.convert_gui_launch`).

* **Windows**: ``HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\QuantizedConvert``
  (current user only: no administrator rights, no ``HKLM``, nothing for other
  accounts). On Windows 11 it is under "Show more options". The command uses
  ``pythonw.exe`` (no console window) next to the interpreter that installed
  Quantized. The registry is reached through an injected ``winreg``-shaped
  module so tests never touch the real one.
* **Linux**: a Nautilus script (``~/.local/share/nautilus/scripts``) and a
  hidden ``.desktop`` entry for "Open With" under ``~/.local/share/applications``.
* macOS and others: unsupported (said plainly, nothing written).

Install is idempotent; uninstall removes exactly what install wrote and is
quiet when nothing is there. Installers are not touched: this is a command the
user runs once, on purpose.
"""

from __future__ import annotations

import os
import shlex
import shutil
import sys
from pathlib import Path
from typing import Any

__all__ = [
    "MENU_LABEL",
    "WIN_KEY",
    "UnsupportedPlatformError",
    "gui_argv",
    "install",
    "install_linux",
    "install_windows",
    "uninstall",
    "uninstall_linux",
    "uninstall_windows",
]

MENU_LABEL = "Convert with Quantized"
WIN_KEY = r"Software\Classes\*\shell\QuantizedConvert"
_LINUX_SCRIPT = "Convert with Quantized"
_LINUX_DESKTOP = "quantized-convert.desktop"


class UnsupportedPlatformError(RuntimeError):
    """The OS has no supported file-manager integration."""


def gui_argv(*, windows: bool = False) -> list[str]:
    """The program and leading arguments that start the quick converter
    (the file path is appended by the caller): the ``qz`` script if it is on
    PATH, else this interpreter with ``-m quantized.cli``. On Windows
    ``pythonw.exe`` is preferred so no console window stays open."""
    if windows:
        exe = Path(sys.executable)
        pyw = exe.with_name("pythonw.exe")
        py = str(pyw if pyw.is_file() else exe)
        return [py, "-m", "quantized.cli", "convert", "--gui"]
    qz = shutil.which("qz")
    head = [qz] if qz else [sys.executable, "-m", "quantized.cli"]
    return [*head, "convert", "--gui"]


def _win_command(argv: list[str]) -> str:
    """The registry command line: every part quoted, then ``"%1"``."""
    return " ".join(f'"{a}"' for a in argv) + ' "%1"'


def install_windows(winreg: Any, argv: list[str] | None = None) -> list[str]:
    """Write the HKCU keys through ``winreg``; return what was written."""
    command = _win_command(argv if argv is not None else gui_argv(windows=True))
    root = winreg.HKEY_CURRENT_USER
    with winreg.CreateKeyEx(root, WIN_KEY, 0, winreg.KEY_WRITE) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, MENU_LABEL)
        winreg.SetValueEx(key, "MultiSelectModel", 0, winreg.REG_SZ, "Single")
    with winreg.CreateKeyEx(root, WIN_KEY + r"\command", 0, winreg.KEY_WRITE) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, command)
    return [f"HKEY_CURRENT_USER\\{WIN_KEY}", f"HKEY_CURRENT_USER\\{WIN_KEY}\\command = {command}"]


def uninstall_windows(winreg: Any) -> list[str]:
    """Delete the HKCU keys install wrote (the ``command`` subkey first);
    return what was removed (empty when nothing was installed)."""
    root = winreg.HKEY_CURRENT_USER
    removed: list[str] = []
    for sub in (WIN_KEY + r"\command", WIN_KEY):
        try:
            winreg.DeleteKey(root, sub)
        except FileNotFoundError:
            continue
        removed.append(f"HKEY_CURRENT_USER\\{sub}")
    return removed


def _linux_dirs(home: Path) -> tuple[Path, Path]:
    data = Path(os.environ.get("XDG_DATA_HOME") or home / ".local" / "share")
    return data / "nautilus" / "scripts", data / "applications"


def install_linux(home: Path | None = None, argv: list[str] | None = None) -> list[str]:
    """Write the Nautilus script and the "Open With" entry; return the paths."""
    scripts, apps = _linux_dirs(home or Path.home())
    cmd = argv if argv is not None else gui_argv()
    scripts.mkdir(parents=True, exist_ok=True)
    apps.mkdir(parents=True, exist_ok=True)
    script = scripts / _LINUX_SCRIPT
    script.write_text(
        "#!/bin/sh\n# Installed by `qz convert --install-context-menu`.\n"
        f'exec {shlex.join(cmd)} "$@"\n',
        encoding="utf-8",
    )
    script.chmod(0o755)
    desktop = apps / _LINUX_DESKTOP
    desktop.write_text(
        "[Desktop Entry]\nType=Application\nName=Convert with Quantized\n"
        f"Exec={shlex.join(cmd)} %F\nTerminal=false\nNoDisplay=true\n"
        "MimeType=application/octet-stream;text/plain;text/csv;application/x-hdf5;\n",
        encoding="utf-8",
    )
    return [str(script), str(desktop)]


def uninstall_linux(home: Path | None = None) -> list[str]:
    """Remove the two files install wrote; return those that existed."""
    scripts, apps = _linux_dirs(home or Path.home())
    removed: list[str] = []
    for path in (scripts / _LINUX_SCRIPT, apps / _LINUX_DESKTOP):
        if path.is_file():
            path.unlink()
            removed.append(str(path))
    return removed


def _winreg() -> Any:
    import winreg  # type: ignore[import-not-found,unused-ignore]  # noqa: PLC0415 - Windows only

    return winreg


def install(platform: str | None = None) -> list[str]:
    """Install for the current OS (``platform`` overrides ``sys.platform``)."""
    plat = platform or sys.platform
    if plat == "win32":
        return install_windows(_winreg())
    if plat.startswith("linux"):
        return install_linux()
    raise UnsupportedPlatformError(
        f"no right-click integration for {plat!r} (Windows and Linux/Nautilus only); "
        "use `qz convert --gui FILE` instead"
    )


def uninstall(platform: str | None = None) -> list[str]:
    """Remove what :func:`install` wrote on the current OS."""
    plat = platform or sys.platform
    if plat == "win32":
        return uninstall_windows(_winreg())
    if plat.startswith("linux"):
        return uninstall_linux()
    raise UnsupportedPlatformError(f"no right-click integration for {plat!r}")
