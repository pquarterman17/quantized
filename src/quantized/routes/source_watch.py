"""Thin route: has a dataset's source file changed? (gap audit 5 lane J, item 10)

Origin's Data Connector "auto-update" re-imports when its file changes, which
is how people watch a running PPMS measurement. The browser-side watcher
(``frontend/src/lib/sourceWatch.ts``) polls this route -- poll-based like the
job queue, no WebSocket -- and re-reads through ``/api/parsers/import``'s live
mode (``routes/_liveimport.py``). This route only STATS: it never reads a byte.

Each requested path gets the same containment test ``routes/parsers.py``'s
``/import`` applies (an allowed data root, or a path the user picked in a native
dialog), so the route cannot be used to probe the rest of the filesystem; a
path outside both answers ``outside`` and nothing else about it. ``stamp`` is
``_liveimport.source_stamp``: mtime, size and identity (inode + ctime), so a
file replaced by one of the same size and timestamp still reads as changed. A
network share may serve cached attributes for several seconds (SMB/NFS
attribute caching); the watcher's polling cannot beat that.

HUNG SHARES. ``os.stat`` (and ``os.path.realpath``) on a dropped network share
can block for minutes, so:

* every stat runs on its own daemon thread, never on an anyio worker (a hung
  one would starve every sync route) and never on the event loop;
* concurrent stats are capped PER VOLUME (``_volume_key``: a drive letter, a
  UNC share, else the longest mount point in ``/proc/self/mounts``, else the
  path's first two components), so hung stats on one share can never use up
  the capacity a healthy volume needs -- a volume with nothing hung always
  proceeds;
* a path over its volume's cap is retried as slots free, within the answer
  deadline, so many files on one healthy volume are all answered;
* an in-flight stat is SHARED by every request for the same path (two windows
  watching one file wait on one thread, instead of the second being refused);
* a stat that has not answered within ``ANSWER_TIMEOUT_S`` is reported
  ``pending`` -- no answer YET, which is not the same as unreachable. The
  watcher reports a file unreachable only after it stays pending for several
  polls. The key is the requested path's own spelling (``abspath``), because
  resolving symlinks is itself a filesystem call that can hang -- so a symlink
  into a hung share counts against the volume holding the LINK. In-flight stats
  are shared per path, so it takes ``PER_VOLUME_INFLIGHT`` distinct such links
  to fill that volume's slots.
"""

from __future__ import annotations

import asyncio
import errno
import os
import stat as stat_mod
import threading
import time
from concurrent.futures import Future
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.data_roots import allowed_data_prefixes
from quantized.desktop_consent import consented_path
from quantized.io.live_text import source_stamp

router = APIRouter(prefix="/api/source-watch", tags=["import"])

# More than any one project watches; a longer list is refused (422), not cut.
MAX_WATCHED_PATHS = 64
MAX_PATH_CHARS = 4096
#: Concurrent stats on ONE volume; a hung share can hold at most this many threads.
PER_VOLUME_INFLIGHT = 8
ANSWER_TIMEOUT_S = 3.0
_RETRY_S = 0.02
_MOUNTS_TTL_S = 30.0


class SourceStatRequest(BaseModel):
    paths: list[Annotated[str, Field(max_length=MAX_PATH_CHARS)]] = Field(
        max_length=MAX_WATCHED_PATHS
    )


class SourceStat(BaseModel):
    path: str
    # ok: a readable regular file; missing: no such file (deleted or moved);
    # denied: present but unreadable; outside: not under an allowed root and
    # not a path the user picked natively; not_file: a directory or device;
    # offline: the volume holding it reported an error; pending: the stat has
    # not answered yet (a slow or hung share); invalid: unusable path.
    state: Literal[
        "ok", "missing", "denied", "outside", "not_file", "offline", "pending", "invalid"
    ]
    stamp: str | None = None


class SourceStatResponse(BaseModel):
    entries: list[SourceStat]


_lock = threading.Lock()
_inflight: dict[str, Future[SourceStat]] = {}
_per_volume: dict[str, int] = {}
_mounts: tuple[float, tuple[str, ...]] = (-_MOUNTS_TTL_S, ())


def _mount_points() -> tuple[str, ...]:
    """Mount points, longest first, from procfs (which never blocks on a share)."""
    global _mounts
    now = time.monotonic()
    if now - _mounts[0] < _MOUNTS_TTL_S:
        return _mounts[1]
    points: tuple[str, ...] = ()
    try:
        with open("/proc/self/mounts", encoding="utf-8", errors="replace") as fh:  # noqa: PTH123
            found = {line.split()[1].replace("\\040", " ") for line in fh if len(line.split()) > 1}
        points = tuple(sorted(found, key=len, reverse=True))
    except OSError:
        pass  # not Linux: the component fallback below
    _mounts = (now, points)
    return points


def _volume_key(path: str) -> str:
    """Which volume ``path`` (absolute, unresolved) is on, without touching it."""
    drive, rest = os.path.splitdrive(path)
    if drive:  # "C:" or "\\\\server\\share" (Windows)
        return drive.lower()
    for mount in _mount_points():
        if path == mount or path.startswith(mount.rstrip("/") + "/"):
            return mount
    parts = [p for p in rest.split(os.sep) if p]
    return os.sep + os.sep.join(parts[:2])


def _stat_one(path: str) -> SourceStat:
    try:
        resolved = os.path.realpath(path)
    except (OSError, ValueError, ArithmeticError):
        return SourceStat(path=path, state="invalid")
    # Inline containment guard, as in routes/parsers.py's /import.
    if resolved.startswith(allowed_data_prefixes()):
        safe = resolved
    else:
        granted = consented_path(resolved)
        if granted is None:
            return SourceStat(path=path, state="outside")
        safe = granted
    try:
        st = os.stat(safe)
    except (FileNotFoundError, NotADirectoryError):
        return SourceStat(path=path, state="missing")  # NotADirectory: a parent is now a file
    except PermissionError:
        return SourceStat(path=path, state="denied")
    except ValueError:
        return SourceStat(path=path, state="invalid")
    except OSError as exc:
        if exc.errno in (errno.ENAMETOOLONG, errno.ELOOP):
            return SourceStat(path=path, state="invalid")
        return SourceStat(path=path, state="offline")  # ESTALE / EIO / a dropped share
    if not stat_mod.S_ISREG(st.st_mode):
        return SourceStat(path=path, state="not_file")
    return SourceStat(path=path, state="ok", stamp=source_stamp(st))


def _submit(path: str) -> Future[SourceStat] | None:
    """The in-flight stat of ``path`` (shared), or a new one on its own daemon
    thread; ``None`` when its volume already has ``PER_VOLUME_INFLIGHT`` stuck."""
    key = os.path.normcase(os.path.abspath(path))
    volume = _volume_key(os.path.abspath(path))
    with _lock:
        running = _inflight.get(key)
        if running is not None:
            return running
        if _per_volume.get(volume, 0) >= PER_VOLUME_INFLIGHT:
            return None
        _per_volume[volume] = _per_volume.get(volume, 0) + 1
        fut: Future[SourceStat] = Future()
        _inflight[key] = fut

    def run() -> None:
        try:
            fut.set_result(_stat_one(path))
        except BaseException as exc:  # noqa: BLE001 -- a Future carries it to the awaiting request
            fut.set_exception(exc)
        finally:
            with _lock:
                _inflight.pop(key, None)
                left = _per_volume.get(volume, 1) - 1
                if left > 0:
                    _per_volume[volume] = left
                else:
                    _per_volume.pop(volume, None)

    threading.Thread(target=run, daemon=True, name="qz-source-watch").start()
    return fut


def _answer(path: str, fut: Future[SourceStat] | None) -> SourceStat:
    if fut is None or not fut.done():
        return SourceStat(path=path, state="pending")
    if fut.exception() is not None:
        return SourceStat(path=path, state="offline")
    res = fut.result()
    # A stat shared with another request answers in THIS request's spelling.
    return res if res.path == path else res.model_copy(update={"path": path})


@router.post("/stat", response_model=SourceStatResponse)
async def stat_sources(req: SourceStatRequest) -> SourceStatResponse:
    """The state and change stamp of each watched source file, in request order.

    A path whose volume is at its cap is submitted again as soon as a slot
    frees (a healthy volume's stats finish in microseconds), until the answer
    deadline; only then is it reported ``pending``. The request POLLS its
    stats' futures (every ``_RETRY_S``) instead of awaiting wrapped ones: a
    wrapper adds a done-callback to the thread's future, and a hung stat shared
    by every poll would collect one per request for as long as it hangs."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + ANSWER_TIMEOUT_S
    futures: list[Future[SourceStat] | None] = [None] * len(req.paths)
    while True:
        futures = [
            f if f is not None else _submit(p) for p, f in zip(req.paths, futures, strict=True)
        ]
        if all(f is not None and f.done() for f in futures) or loop.time() >= deadline:
            break
        await asyncio.sleep(_RETRY_S)
    return SourceStatResponse(
        entries=[_answer(p, f) for p, f in zip(req.paths, futures, strict=True)]
    )
