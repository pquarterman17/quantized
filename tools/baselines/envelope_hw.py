"""Best-effort hardware/environment fingerprint for a performance-envelope run.

Stdlib only (no psutil): ``platform`` + ``os`` cover CPU/OS/Python; total RAM
uses a small per-OS ``ctypes``/``os.sysconf`` probe and is omitted (not
guessed) when neither path is available.
"""

from __future__ import annotations

import os
import platform
import sys
from typing import Any

__all__ = ["hardware_block"]


def _total_ram_mb() -> float | None:
    """Total physical RAM in MB, stdlib-only, or ``None`` if unobtainable."""
    if sys.platform == "win32":
        try:
            import ctypes

            class _MemoryStatusEx(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = _MemoryStatusEx()
            stat.dwLength = ctypes.sizeof(_MemoryStatusEx)
            kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            if kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return stat.ullTotalPhys / (1024 * 1024)
            return None
        except Exception:  # noqa: BLE001 - best-effort only
            return None
    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        page_count = os.sysconf("SC_PHYS_PAGES")
        return (page_size * page_count) / (1024 * 1024)
    except (ValueError, OSError, AttributeError):
        return None


def hardware_block() -> dict[str, Any]:
    """One JSON-safe dict describing the machine this run executed on."""
    block: dict[str, Any] = {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor() or None,
        "logical_cores": os.cpu_count(),
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
    }
    ram_mb = _total_ram_mb()
    if ram_mb is not None:
        block["ram_total_mb"] = round(ram_mb, 1)
    return block
