"""One owned Origin COM instance, killed by its exact PID no matter how we exit.

Why this exists: on 2026-11-15 a Python-side ``timeout`` killed a COM script
and orphaned an ``Origin64.exe -Embedding`` that nothing then cleaned up. Every
safeguard below targets that failure:

* **Refuse to start beside another Origin.** Only one instance may run on the
  machine (parallel lanes share it, and ``Origin.ApplicationSI`` would attach
  to the owner's window). :func:`assert_no_origin` is called before dispatch.
* **Record exactly which process we started** -- the single new Origin PID
  that appears across ``Dispatch("Origin.Application")``, confirmed by its
  ``-Embedding`` command line, plus its creation time. The record goes to a
  sidecar file BEFORE any work, so a later run can clean up after a hard kill.
* **Kill only that PID**, and only while it is still the same process (PID
  and creation time both match). Never by image name: that would close the
  owner's own Origin.
* **Three kill paths**: the context manager's ``finally``, an ``atexit`` hook,
  and a Windows job object with ``KILL_ON_JOB_CLOSE`` -- the last one fires
  even when this interpreter is itself terminated (``TerminateProcess`` skips
  ``atexit``), which is exactly how the 2026-11-15 orphan happened.
* **Per-item deadline**: :meth:`OriginSession.deadline` arms a watchdog that
  kills the instance when one build hangs. The blocked COM call then raises,
  the caller records the timeout and starts a fresh session.

Only ``Origin.Application`` is ever dispatched (see CLAUDE.md "Origin COM
oracle runs").
"""

from __future__ import annotations

import atexit
import ctypes
import json
import os
import subprocess
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROGID = "Origin.Application"  # NEVER "Origin.ApplicationSI"


class OriginBusyError(RuntimeError):
    """Another Origin process is running; this harness will not start beside it."""


@dataclass(frozen=True)
class OwnedProcess:
    pid: int
    created: int  # FILETIME ticks; distinguishes a recycled PID

    def to_json(self) -> str:
        return json.dumps({"pid": self.pid, "created": self.created})

    @staticmethod
    def from_json(text: str) -> OwnedProcess | None:
        try:
            raw = json.loads(text)
            return OwnedProcess(int(raw["pid"]), int(raw["created"]))
        except (ValueError, KeyError, TypeError):
            return None


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


def assert_no_origin() -> None:
    running = origin_pids()
    if running:
        raise OriginBusyError(f"Origin already running (PIDs {sorted(running)}); refusing")


def process_created(pid: int) -> int | None:
    """Creation FILETIME of ``pid`` via ``GetProcessTimes`` (None if gone)."""
    if os.name != "nt":
        return None
    k32 = ctypes.windll.kernel32  # type: ignore[attr-defined,unused-ignore]
    handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return None
    try:
        times = [ctypes.c_ulonglong() for _ in range(4)]
        if not k32.GetProcessTimes(handle, *[ctypes.byref(t) for t in times]):
            return None
        return int(times[0].value)
    finally:
        k32.CloseHandle(handle)


def command_line(pid: int) -> str:
    """The process command line (PowerShell CIM; '' when unavailable)."""
    out = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            f'(Get-CimInstance Win32_Process -Filter "ProcessId={int(pid)}").CommandLine',
        ],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    return out.strip()


def is_same_process(owned: OwnedProcess) -> bool:
    return owned.pid in origin_pids() and process_created(owned.pid) == owned.created


def kill_owned(owned: OwnedProcess) -> bool:
    """Force-kill exactly ``owned`` if it is still that same Origin process."""
    if not is_same_process(owned):
        return False
    subprocess.run(["taskkill", "/F", "/PID", str(owned.pid)], capture_output=True, check=False)
    return True


def kill_stale(sidecar: Path) -> bool:
    """Kill an instance a PREVIOUS (hard-killed) run recorded, then forget it."""
    if not sidecar.exists():
        return False
    owned = OwnedProcess.from_json(sidecar.read_text(encoding="utf-8"))
    killed = kill_owned(owned) if owned else False
    sidecar.unlink(missing_ok=True)
    return killed


def _bind_to_job(pid: int) -> Any:
    """Put ``pid`` in a KILL_ON_JOB_CLOSE job owned by this interpreter, so
    Windows kills Origin when we die by any route. Best effort: returns the job
    handle (keep it alive) or None."""
    try:
        import win32api
        import win32con
        import win32job
    except ImportError:
        return None
    try:
        job = win32job.CreateJobObject(None, "")
        info = win32job.QueryInformationJobObject(job, win32job.JobObjectExtendedLimitInformation)
        info["BasicLimitInformation"]["LimitFlags"] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        win32job.SetInformationJobObject(job, win32job.JobObjectExtendedLimitInformation, info)
        access = win32con.PROCESS_TERMINATE | win32con.PROCESS_SET_QUOTA
        proc = win32api.OpenProcess(access, False, pid)
        win32job.AssignProcessToJobObject(job, proc)
        return job
    except Exception:  # noqa: BLE001 - job binding is a bonus layer, not required
        return None


class OriginSession:
    """``with OriginSession(sidecar) as s: s.lt("...")`` -- one owned instance."""

    def __init__(self, sidecar: Path) -> None:
        self.sidecar = sidecar
        self.app: Any = None
        self.owned: OwnedProcess | None = None
        self.job: Any = None
        self.timed_out = False

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> OriginSession:
        import win32com.client

        kill_stale(self.sidecar)
        assert_no_origin()
        before = origin_pids()
        self.app = win32com.client.Dispatch(PROGID)
        new = sorted(origin_pids() - before)
        if len(new) != 1:
            self.app = None
            raise OriginBusyError(f"expected one new Origin PID, saw {new}; refusing")
        pid = new[0]
        created = process_created(pid)
        if created is None or "-embedding" not in command_line(pid).lower():
            raise OriginBusyError(f"PID {pid} is not an -Embedding Origin we started")
        self.owned = OwnedProcess(pid, created)
        self.sidecar.parent.mkdir(parents=True, exist_ok=True)
        self.sidecar.write_text(self.owned.to_json(), encoding="utf-8")
        self.job = _bind_to_job(pid)
        atexit.register(self.close)
        self.app.Visible = 0
        return self

    def close(self) -> None:
        """Exit politely, then kill the exact PID if it lingers. Idempotent."""
        owned, self.owned = self.owned, None
        app, self.app = self.app, None
        if app is not None and owned is not None and is_same_process(owned):
            try:
                app.Exit()
            except Exception:  # noqa: BLE001 - already dead or hung; kill below
                pass
        if owned is not None:
            kill_owned(owned)
        self.sidecar.unlink(missing_ok=True)
        self.job = None

    def __enter__(self) -> OriginSession:
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.close()

    @contextmanager
    def deadline(self, seconds: float) -> Iterator[None]:
        """Kill the instance if the body runs longer than ``seconds``."""
        owned = self.owned

        def fire() -> None:
            self.timed_out = True
            if owned is not None:
                kill_owned(owned)

        timer = threading.Timer(seconds, fire)
        timer.daemon = True
        timer.start()
        try:
            yield
        finally:
            timer.cancel()

    def load_oc(self, source: Path, workdir: Path) -> bool:
        """Compile an Origin C file. Copied to ``workdir`` with CRLF endings
        and loaded by a BACKSLASH path: a forward-slash path / LF-only file
        returned 3 (failure) from ``run.LoadOC`` on Origin 2026b Student."""
        workdir.mkdir(parents=True, exist_ok=True)
        dst = workdir / source.name
        text = source.read_text(encoding="utf-8").replace("\r\n", "\n")
        dst.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
        win_path = str(dst.resolve()).replace("/", "\\")
        return self.ltn(f'run.LoadOC("{win_path}", 16)') == 0

    # -- LabTalk helpers ---------------------------------------------------
    def lt(self, cmd: str) -> bool:
        return bool(self.app.Execute(cmd))

    def ltn(self, expr: str, sentinel: float = -987654.0) -> float | None:
        """Evaluate a numeric LabTalk expression (None when it did not set)."""
        self.lt(f"double __d = {sentinel};")
        self.lt(f"__d = {expr};")
        val = float(self.app.LTVar("__d"))
        return None if val == sentinel else val

    def lts(self, expr: str) -> str:
        """Evaluate a LabTalk string expression, e.g. ``'%Z'`` or ``layer.x.label$``."""
        self.lt('string __s$ = "";')
        self.lt(f"__s$ = {expr};")
        return str(self.app.LTStr("__s$"))
