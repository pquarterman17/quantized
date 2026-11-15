"""Origin process bookkeeping shared by the Origin COM scripts.

``export_axis_ranges.py`` (one project), ``run_axis_oracle.py`` (many) and
``export_origin_graphs.py`` must agree on how Origin processes are listed,
where the exported instance's PID is recorded, and that a process is only ever
killed by that EXACT recorded PID. Killing by image name (``taskkill /IM
Origin64.exe``) would also close every Origin window the owner has open. The
scripts run under ``python -I`` or directly, so each inserts this directory
before importing.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

_T = TypeVar("_T")


def origin_pids() -> set[int]:
    """PIDs of every running ``Origin*`` process (empty off Windows)."""
    if os.name != "nt":
        return set()
    out = subprocess.run(
        ["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, check=False
    ).stdout
    pids: set[int] = set()
    for line in out.splitlines():
        cols = [c.strip('"') for c in line.split('","')]
        if len(cols) > 1 and cols[0].lower().startswith("origin"):
            pids.add(int(cols[1].strip('"')))
    return pids


def pid_file(out: Path) -> Path:
    """Sidecar naming the Origin instance THIS export started (see the runner)."""
    return out.with_suffix(".pid")


def read_pids(sidecar: Path) -> list[int]:
    """PIDs recorded in a ``.pid`` sidecar; ``[]`` when it is missing, empty,
    partial or not a list of ints. A hung export may have died mid-write, and an
    unreadable sidecar must mean "no exact PID" (kill nothing), never a crash
    that leaves a hung Origin running unrecorded."""
    try:
        pids = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(pids, list) or not all(type(p) is int for p in pids):
        return []
    return pids


def kill_origin_pid(pid: int) -> bool:
    """Force-kill exactly ``pid``, and only while it is still an Origin process
    (a stale PID may since belong to something else). Never by image name."""
    if pid not in origin_pids():
        return False
    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, check=False)
    return True


def dispatch_recording_pid(dispatch: Callable[[], _T], sidecar: Path) -> tuple[_T, list[int]]:
    """Run ``dispatch`` (a COM ``DispatchEx``) and record the Origin PID that
    appeared across it in ``sidecar``, BEFORE the caller loads anything, so a
    hang inside ``Load`` still leaves an exact target. Two new PIDs in that
    window (the owner opened Origin at the same moment) is ambiguous: record
    none, and nothing will be killed."""
    before = origin_pids()
    app = dispatch()
    new = sorted(origin_pids() - before)
    pids = new if len(new) == 1 else []
    sidecar.write_text(json.dumps(pids), encoding="utf-8")
    return app, pids


def kill_recorded_origin(sidecar: Path) -> list[int]:
    """Kill the instance(s) a PREVIOUS run recorded in ``sidecar`` and then
    forget them. Returns the PIDs killed. An Origin nobody here recorded (the
    owner's own) is never touched."""
    killed = [p for p in read_pids(sidecar) if kill_origin_pid(p)]
    sidecar.unlink(missing_ok=True)
    return killed
