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
import stat
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


def regular_file(path: Path) -> bool:
    """``path`` itself is a regular file -- a symlink is NOT followed (the
    cache never makes links; one planted in it could point anywhere)."""
    try:
        return stat.S_ISREG(path.lstat().st_mode)
    except OSError:
        return False


def real_dir(path: Path) -> bool:
    """``path`` itself is a directory, not a symlink to one."""
    try:
        return stat.S_ISDIR(path.lstat().st_mode)
    except OSError:
        return False


def check_private_root(root: Path) -> None:
    """Refuse a cache root that is not this user's own private directory.

    POSIX: the root must be a real directory (not a symlink) owned by the
    current user; group/other permission bits are tightened to 0700 rather
    than trusted, since a pre-made world-writable directory would let another
    user swap the staged files a parser later opens. Windows has no POSIX
    owner/mode to check (the per-user profile directory is already private)."""
    if sys.platform == "win32":
        return
    st = root.lstat()
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
        raise OSError(f"refusing to use {root} as the Origin upload cache: not a real directory")
    if st.st_uid != os.getuid():
        raise OSError(f"refusing to use {root} as the Origin upload cache: owned by another user")
    if st.st_mode & 0o077:
        os.chmod(root, 0o700)


def owned_root(root: Path) -> bool:
    """``root`` carries the cache marker AND is this user's own real
    directory: only then does the cache lock, sweep or write in it."""
    if not regular_file(root / MARKER):
        return False
    try:
        check_ok = sys.platform == "win32" or (real_dir(root) and root.lstat().st_uid == os.getuid())
    except OSError:
        return False
    return check_ok


def private_file(path: Path, data: bytes = b"") -> None:
    """Create ``path`` exclusively with mode 0600 and write ``data`` (never
    through a symlink: ``O_EXCL`` refuses an existing name of any kind)."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
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
    if owned_root(root):
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
            st = child.lstat()  # never follow a link: it could point anywhere
            if stat.S_ISLNK(st.st_mode):
                continue  # the cache makes no links; not ours to judge or follow
            age = now - st.st_mtime
            if stat.S_ISREG(st.st_mode) and child.name.startswith(TMP_PREFIX):
                if age > STALE_S:  # a fresh one may still be streaming
                    child.unlink()
                continue
            if not (stat.S_ISDIR(st.st_mode) and TOKEN_RE.fullmatch(child.name)):
                continue  # the marker, the lock, the index: not ours to judge
            if child.name in merged:
                continue
            files = [f for f in child.iterdir() if regular_file(f)]
            if len(files) == 1 and valid_name(files[0].name):
                if file_token(files[0], files[0].name) == child.name:
                    fst = files[0].lstat()
                    merged[child.name] = Entry(files[0].name, fst.st_size, fst.st_mtime)
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
    """Remove a token directory this cache created (its one file). A symlink
    in its place is removed as a LINK -- never followed into its target."""
    if directory.is_symlink():
        with contextlib.suppress(OSError):
            directory.unlink()
        return
    for child in directory.iterdir() if real_dir(directory) else []:
        with contextlib.suppress(OSError):
            child.unlink()  # unlinks a link itself, never its target
    with contextlib.suppress(OSError):
        directory.rmdir()
