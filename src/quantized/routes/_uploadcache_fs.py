"""Filesystem primitives of the Origin upload cache (``_uploadcache.py``,
split out under the module-size ceiling): entry/name/token rules, hashing,
private (0600) file creation, the cross-process file lock, and the index
read / write / rebuild helpers. No cache policy lives here.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import re
import secrets
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from quantized.routes._uploadstream import AsyncChunkReader

INDEX = "index.json"
MARKER = ".quantized-upload-cache"
LOCK = ".lock"
TMP_PREFIX = ".tmp-"
TOKEN_RE = re.compile(r"[0-9a-f]{64}")
_HASH_CHUNK = 1 << 20
STALE_S = 3600  # an unindexed .tmp-* file / token dir older than this is debris
_log = logging.getLogger(__name__)


@dataclass
class Entry:
    name: str
    size: int
    last_used: float


def valid_name(name: object) -> bool:
    return (
        isinstance(name, str)
        and name not in ("", ".", "..")
        and Path(name).name == name
        and "\x00" not in name
        and not name.startswith(".")
    )


def checked_name(name: str) -> str:
    base = Path(name).name
    if not valid_name(base):
        raise ValueError(f"invalid upload name: {name!r}")
    return base


def new_hash() -> Any:
    return hashlib.sha256()


def token_of(digest: Any, name: str) -> str:
    """Finish a content hash into a token: the extension is part of the key
    (it drives format dispatch, so ``.opj`` and ``.opju`` stay distinct)."""
    digest.update(b"\x00" + Path(name).suffix.lower().encode("utf-8", "replace"))
    return str(digest.hexdigest())


def file_token(path: Path, name: str) -> str:
    digest = new_hash()
    with path.open("rb") as f:
        while chunk := f.read(_HASH_CHUNK):
            digest.update(chunk)
    return token_of(digest, name)


class HashingReader:
    """An ``AsyncChunkReader`` that hashes what passes through it, so the
    token is known when the last chunk lands -- no second read of the file."""

    def __init__(self, source: AsyncChunkReader, digest: Any) -> None:
        self._source, self._digest = source, digest

    async def read(self, size: int = -1) -> bytes:
        chunk = await self._source.read(size)
        self._digest.update(chunk)
        return chunk


def private_file(path: Path, data: bytes = b"") -> None:
    """Create ``path`` exclusively with mode 0600 and write ``data``."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)


def _lock_fd(fd: int) -> None:
    if sys.platform == "win32":
        import msvcrt

        msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
    else:
        import fcntl

        fcntl.flock(fd, fcntl.LOCK_EX)


def _unlock_fd(fd: int) -> None:
    if sys.platform == "win32":
        import msvcrt

        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(fd, fcntl.LOCK_UN)


@contextlib.contextmanager
def file_lock(root: Path) -> Iterator[None]:
    """Exclusive cross-process lock on ``.lock`` (best effort: a
    directory that is absent, unowned or unlockable proceeds unlocked)."""
    fd: int | None = None
    if (root / MARKER).is_file():
        try:
            fd = os.open(root / LOCK, os.O_RDWR | os.O_CREAT, 0o600)
            _lock_fd(fd)
        except OSError:
            if fd is not None:
                os.close(fd)
            fd = None
    try:
        yield
    finally:
        if fd is not None:
            with contextlib.suppress(OSError):
                _unlock_fd(fd)
            os.close(fd)



def read_index(root: Path) -> tuple[dict[str, Entry], bool]:
    """``(rows, ok)``: the validated on-disk index; ``ok`` is False when
    it is missing, unreadable or not the expected shape."""
    try:
        raw = json.loads((root / INDEX).read_text("utf-8"))
    except (OSError, ValueError):
        return {}, False
    rows = raw.get("entries") if isinstance(raw, dict) else None
    if not isinstance(rows, dict):
        return {}, False
    out: dict[str, Entry] = {}
    for token, row in rows.items():
        if not (isinstance(token, str) and TOKEN_RE.fullmatch(token)):
            continue
        if not isinstance(row, dict) or not valid_name(row.get("name")):
            continue
        size, used = row.get("size"), row.get("last_used")
        if isinstance(size, int) and isinstance(used, (int, float)):
            out[token] = Entry(str(row["name"]), size, float(used))
    return out, True



def adopt_and_sweep(root: Path, merged: dict[str, Entry]) -> None:
    """Re-hash and adopt token directories ``merged`` does not name (their
    token must equal their own content hash); remove stale temp files and
    stale directories that fail it. Fresh ones are left alone."""
    now = time.time()
    for child in list(root.iterdir()):
        try:
            age = now - child.stat().st_mtime
            if child.is_file() and child.name.startswith(TMP_PREFIX):
                if age > STALE_S:  # a fresh one may still be streaming
                    child.unlink()
                continue
            if not (child.is_dir() and TOKEN_RE.fullmatch(child.name)):
                continue  # the marker, the lock, the index: not ours to judge
            if child.name in merged:
                continue
            files = [f for f in child.iterdir() if f.is_file()]
            if len(files) == 1 and valid_name(files[0].name):
                if file_token(files[0], files[0].name) == child.name:
                    stat = files[0].stat()
                    merged[child.name] = Entry(files[0].name, stat.st_size, stat.st_mtime)
                    continue
            if age > STALE_S:  # never a fresh dir: another instance may be mid-commit
                remove_dir(child)
        except OSError:
            continue



def write_index(root: Path, entries: dict[str, Entry]) -> None:
    """Write the index atomically. NON-FATAL: on any OS error (disk full,
    read-only) the staged files still serve from this process's view and
    the next successful save, or a rebuild, catches the index up."""
    tmp: Path | None = None
    try:
        rows = {
            t: {"name": e.name, "size": e.size, "last_used": e.last_used}
            for t, e in entries.items()
        }
        tmp = root / f"{TMP_PREFIX}index-{secrets.token_hex(4)}"
        private_file(tmp, json.dumps({"version": 1, "entries": rows}).encode("utf-8"))
        os.replace(tmp, root / INDEX)
        tmp = None
    except OSError:
        _log.warning("could not write the Origin upload cache index", exc_info=True)
    finally:
        if tmp is not None:
            with contextlib.suppress(OSError):
                tmp.unlink()


def remove_dir(directory: Path) -> None:
    """Remove a token directory this cache created (its one file)."""
    for child in directory.iterdir() if directory.is_dir() else []:
        with contextlib.suppress(OSError):
            child.unlink()
    with contextlib.suppress(OSError):
        directory.rmdir()
