"""Origin process bookkeeping shared by the axis-oracle scripts.

``export_axis_ranges.py`` (one project) and ``run_axis_oracle.py`` (many) must
agree on two things or the runner could kill the wrong process: how Origin
processes are listed, and where the exported instance's PID is recorded. Both
scripts run under ``python -I`` (no script directory on ``sys.path``), so each
inserts this directory before importing.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


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
