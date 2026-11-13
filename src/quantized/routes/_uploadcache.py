"""Persistent, byte-bounded staging for Origin project uploads (lazy per-book
transport, ``ORIGIN_FILE_DECODE_PLAN`` #38).

``/api/parsers/upload``'s ordinary path stages the file in an ephemeral temp
dir deleted before the response returns. A lazy Origin import needs the bytes
to survive until the browser later activates a non-primary book
(``routes/books.py``), so project uploads are staged here under an opaque
token the frontend echoes back.

* **Content-hash tokens.** SHA-256 of the bytes plus the lower-cased
  extension, computed while the upload streams to disk: the same file always
  gets the same token (one copy), and a token outlives an app restart.
* **Where.** A DEDICATED directory: ``<user cache dir>/quantized/origin-uploads``
  (``platformdirs``), or ``$QZ_UPLOAD_CACHE_DIR/origin-uploads``. Layout:
  ``<token>/<basename>`` + ``index.json`` (name, size, last use) + a
  ``.quantized-upload-cache`` marker. Directories are created ``0700`` and
  files ``0600`` -- the uploads are the user's research data.
* **Bounded by bytes.** At most :data:`MAX_TOTAL_BYTES` (2 GiB); past that the
  least-recently-USED entries go first (a book fetch is a use). The entry
  just staged is never evicted by its own commit. Skipped by eviction:
  entries pinned by a running parse (``mark_in_flight``), and entries this
  process did not stage itself that were used within the last
  :data:`FOREIGN_GRACE_S` seconds (another app instance may be parsing them).
  The cache can therefore sit over budget briefly; the next commit retries.
* **Shared safely.** Every mutation runs under an OS file lock (``.lock``),
  re-reads the on-disk index and MERGES it with this process's view before
  writing, so two app instances on one directory keep each other's uploads.
* **Fails soft.** The index is a cache of what the token directories hold: if
  it cannot be written (disk full) the staged file still serves, and if it is
  missing or corrupt it is rebuilt by re-hashing the token directories.
* **Touches only its own files.** Nothing is created in, or removed from, a
  directory that lacks the marker; a non-empty directory without one is
  refused. Tokens must match ``^[0-9a-f]{64}$`` and names be plain basenames
  before any path is formed. Cleanup removes only stale (> 1 h) ``.tmp-*``
  files and token directories that fail their own hash.

``clear()`` (``DELETE /api/parsers/upload-cache``, ``qz upload-cache clear``,
Preferences > Interaction > "Origin upload cache") removes every staged upload.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import secrets
import threading
import time
from collections import Counter, OrderedDict
from pathlib import Path
from typing import Any

import platformdirs

from quantized.routes import _uploadcache_fs as fs
from quantized.routes._uploadstream import AsyncChunkReader, stream_to_path

__all__ = [
    "ENV_OVERRIDE",
    "FOREIGN_GRACE_S",
    "MAX_TOTAL_BYTES",
    "UploadCache",
    "cache_dir",
    "clear_in_flight",
    "get_cache",
    "mark_in_flight",
    "resolve_upload_token",
    "stage_upload",
    "stage_upload_stream",
]

ENV_OVERRIDE = "QZ_UPLOAD_CACHE_DIR"
#: Total on-disk budget for staged uploads: 2 GiB (2 * 1024**3 bytes).
MAX_TOTAL_BYTES = 2 * 1024**3
#: Eviction leaves another instance's entry alone this long after its last use.
FOREIGN_GRACE_S = 600.0
_APP_NAME = "quantized"
_SUBDIR = "origin-uploads"
_log = logging.getLogger(__name__)
class UploadCache:
    """One staging directory + its persisted LRU index (module docstring)."""

    def __init__(
        self,
        root: Path,
        max_bytes: int = MAX_TOTAL_BYTES,
        foreign_grace_s: float = FOREIGN_GRACE_S,
    ) -> None:
        self.root = Path(root)
        self.max_bytes = max_bytes
        self.foreign_grace_s = foreign_grace_s
        self._lock = threading.RLock()
        self._entries: OrderedDict[str, fs.Entry] = OrderedDict()
        self._pins: Counter[str] = Counter()
        self._own: set[str] = set()  # tokens this process staged or served
        with self._lock, fs.file_lock(self.root):
            self._sync(scan=True)

    # -- ownership + locking ------------------------------------------------
    def _owned(self) -> bool:
        return fs.owned_root(self.root)

    def _ensure_root(self) -> None:
        """Create the directory (0700) and its marker, or refuse a non-empty
        directory this module did not create (or one another user owns)."""
        if (self.root / fs.MARKER).exists() or self._owned():
            fs.check_private_root(self.root)  # raises for a foreign/linked root
            return
        if self.root.is_symlink() or (self.root.is_dir() and any(self.root.iterdir())):
            raise OSError(
                f"refusing to use {self.root} as the Origin upload cache: it is not empty "
                "and was not created by Quantized"
            )
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with contextlib.suppress(OSError):
            os.chmod(self.root, 0o700)
        fs.check_private_root(self.root)  # a pre-made parent-owned dir, mkdir's mode not applied
        with contextlib.suppress(FileExistsError):
            fs.private_file(self.root / fs.MARKER, b"Quantized Origin upload cache\n")

    # -- persistence --------------------------------------------------------
    def _path(self, token: str, entry: fs.Entry) -> Path:
        """``<root>/<token>/<name>``, contained: ``ValueError`` unless the
        normalized path is exactly one token directory and one file name below
        the root. Callers validate ``token`` (:data:`fs.TOKEN_RE`) and the
        index validates ``name`` (:func:`fs.valid_name`) already; this is the
        last check before the path reaches the filesystem, so a token or name
        that ever slipped past those (``..``, a separator, an absolute path)
        fails closed here instead of escaping the cache."""
        base = os.path.normpath(self.root)
        candidate = os.path.normpath(os.path.join(base, token, entry.name))
        prefix = base if base.endswith(os.sep) else base + os.sep  # "/" or "C:\\" root
        if not candidate.startswith(prefix):
            raise ValueError(f"upload cache path escapes {base}: {token!r}/{entry.name!r}")
        token_dir = os.path.dirname(candidate)
        # Exactly <base>/<token>/<name>: the depth check refuses a token with
        # a separator, the token-dir check a ".." name at a filesystem root.
        if os.path.dirname(token_dir) != base or token_dir != os.path.join(base, token):
            raise ValueError(f"malformed upload cache path: {token!r}/{entry.name!r}")
        return Path(candidate)

    def _present(self, token: str, entry: fs.Entry) -> bool:
        try:
            path = self._path(token, entry)
        except ValueError:
            return False
        try:
            # The token dir and its file themselves, never through a link.
            return (
                fs.real_dir(path.parent)
                and fs.regular_file(path)
                and path.lstat().st_size == entry.size
            )
        except OSError:
            return False

    def _sync(self, *, scan: bool = False) -> None:
        """Merge the on-disk index with this process's view (caller holds
        both locks): an entry either side knows whose file is present is
        kept, with the later ``last_used``. With ``scan`` -- or whenever the
        index is missing/corrupt -- token directories the index does not name
        are re-hashed and adopted, and stale debris is removed."""
        if not self._owned():
            self._entries = OrderedDict()
            return
        disk, ok = fs.read_index(self.root)
        merged: dict[str, fs.Entry] = {}
        # Deterministic merge order: the index's rows as written (LRU order,
        # oldest first), then tokens only this process knows (also LRU). The
        # sort below is stable, so this order is the tie-break for equal
        # ``last_used`` -- which a coarse clock produces routinely (Windows
        # time.time() on Python < 3.13 ticks every ~15.6 ms). It used to be a
        # SET, so ties fell back to hash-seed order and a restart could evict
        # the most recently used entry instead of the least.
        for token in dict.fromkeys([*disk, *self._entries]):
            mine, theirs = self._entries.get(token), disk.get(token)
            entry = theirs or mine
            assert entry is not None
            if mine is not None and theirs is not None:
                entry = fs.Entry(theirs.name, theirs.size, max(mine.last_used, theirs.last_used))
            if self._present(token, entry):
                merged[token] = entry
        if scan or not ok:
            fs.adopt_and_sweep(self.root, merged)
        self._entries = OrderedDict(sorted(merged.items(), key=lambda te: te[1].last_used))

    def _save(self) -> None:
        """Persist the index. NON-FATAL (``fs.write_index``): a staged file
        still serves from this process's view when the disk is full."""
        try:
            self._ensure_root()
        except OSError:
            _log.warning("Origin upload cache directory unavailable", exc_info=True)
            return
        fs.write_index(self.root, self._entries)

    # -- bound --------------------------------------------------------------
    def total_bytes(self) -> int:
        with self._lock:
            return sum(e.size for e in self._entries.values())

    def _evict(self, keep: str | None = None) -> None:
        """Drop least-recently-used entries until within :attr:`max_bytes`,
        skipping ``keep``, pinned entries and another instance's fresh ones."""
        total = sum(e.size for e in self._entries.values())
        now = time.time()
        for token in list(self._entries):
            if total <= self.max_bytes:
                break
            entry = self._entries[token]
            foreign_fresh = (
                token not in self._own and now - entry.last_used < self.foreign_grace_s
            )
            if token == keep or self._pins[token] > 0 or foreign_fresh:
                continue
            del self._entries[token]
            self._own.discard(token)
            total -= entry.size
            fs.remove_dir(self.root / token)

    # -- staging ------------------------------------------------------------
    def _tmp_path(self) -> Path:
        self._ensure_root()
        tmp = self.root / f"{fs.TMP_PREFIX}{secrets.token_hex(8)}"
        fs.private_file(tmp)
        return tmp

    def _commit(self, tmp: Path, name: str, token: str, *, pinned: bool) -> tuple[Path, str]:
        """Move a fully written ``tmp`` into place under ``token`` (or drop it
        when that content is already staged), pin it if asked -- before the
        eviction sweep, so its own commit can never pick it -- evict, persist.
        A failure leaves no temp file and no pin behind."""
        did_pin = False
        with self._lock:
            try:
                with fs.file_lock(self.root):
                    self._sync()
                    entry = self._entries.get(token)
                    if entry is not None and self._present(token, entry):
                        tmp.unlink(missing_ok=True)
                        entry.last_used = time.time()
                    else:
                        dest_dir = self.root / token
                        fs.remove_dir(dest_dir)  # unindexed debris under this token
                        dest_dir.mkdir(mode=0o700, exist_ok=True)
                        entry = fs.Entry(name, tmp.stat().st_size, time.time())
                        os.replace(tmp, dest_dir / name)
                        self._entries[token] = entry
                    self._entries.move_to_end(token)
                    self._own.add(token)
                    if pinned:
                        self._pins[token] += 1
                        did_pin = True
                    self._evict(keep=token)
                    self._save()
                    return self._path(token, entry), token
            except BaseException:
                if did_pin:
                    self._unpin(token)
                with contextlib.suppress(OSError):
                    tmp.unlink(missing_ok=True)
                raise

    def stage(self, name: str, content: bytes, *, pinned: bool = False) -> tuple[Path, str]:
        """Stage in-memory ``content`` as ``name``; returns ``(path, token)``."""
        name = fs.checked_name(name)
        digest = fs.new_hash()
        digest.update(content)
        tmp = self._tmp_path()
        try:
            tmp.write_bytes(content)
        except BaseException:
            with contextlib.suppress(OSError):
                tmp.unlink(missing_ok=True)
            raise
        return self._commit(tmp, name, fs.token_of(digest, name), pinned=pinned)

    async def stage_stream(
        self,
        name: str,
        source: AsyncChunkReader,
        *,
        max_bytes: int | None = None,
        pinned: bool = False,
    ) -> tuple[Path, str]:
        """Streaming :meth:`stage`: chunks are hashed as they go to disk, and
        the commit (file lock + index I/O) runs off the event loop. An
        oversize or failed upload leaves nothing behind."""
        name = fs.checked_name(name)
        digest = fs.new_hash()
        tmp = await asyncio.to_thread(self._tmp_path)
        try:
            reader = fs.HashingReader(source, digest)
            await stream_to_path(reader, tmp, filename=name, max_bytes=max_bytes)
        except BaseException:
            with contextlib.suppress(OSError):
                tmp.unlink(missing_ok=True)
            raise
        token = fs.token_of(digest, name)
        commit = asyncio.ensure_future(
            asyncio.to_thread(self._commit, tmp, name, token, pinned=pinned)
        )
        try:
            return await asyncio.shield(commit)
        except asyncio.CancelledError:
            # The worker thread still finishes; nobody will unpin for us.
            def _release(done: asyncio.Future[tuple[Path, str]]) -> None:
                if pinned and not done.cancelled() and done.exception() is None:
                    self._unpin(token)

            commit.add_done_callback(_release)
            raise

    # -- reads + pins -------------------------------------------------------
    def resolve(self, token: str) -> Path | None:
        """The staged file for ``token`` (and mark it used), or ``None`` when
        unknown, evicted, malformed, or removed out of band."""
        if not (isinstance(token, str) and fs.TOKEN_RE.fullmatch(token)):
            return None
        with self._lock, fs.file_lock(self.root):
            self._sync()
            entry = self._entries.get(token)
            if entry is None:
                return None
            try:
                path = self._path(token, entry)
            except ValueError:
                return None
            entry.last_used = time.time()
            self._entries.move_to_end(token)
            self._own.add(token)
            self._save()
            return path

    def _unpin(self, token: str) -> None:
        with self._lock:
            if self._pins[token] > 1:
                self._pins[token] -= 1
            else:
                self._pins.pop(token, None)

    def mark_in_flight(self, token: str) -> None:
        with self._lock:
            self._pins[token] += 1

    def clear_in_flight(self, token: str) -> None:
        """Unpin once its parse finished; re-run eviction, which a pinned
        entry may have held off."""
        with self._lock:
            self._unpin(token)
            if sum(e.size for e in self._entries.values()) <= self.max_bytes:
                return
            with fs.file_lock(self.root):
                self._sync()
                self._evict()
                self._save()

    def is_pinned(self, token: str) -> bool:
        with self._lock:
            return self._pins[token] > 0

    # -- housekeeping -------------------------------------------------------
    def info(self) -> dict[str, Any]:
        """Where the cache is and what it holds (for the clear confirmation)."""
        with self._lock, fs.file_lock(self.root):
            self._sync()
            return {
                "path": str(self.root),
                "entries": len(self._entries),
                "bytes": sum(e.size for e in self._entries.values()),
                "max_bytes": self.max_bytes,
            }

    def clear(self) -> dict[str, int]:
        """Remove every staged upload except ones a parse is reading right
        now, plus stale temp files. Returns ``{"removed", "bytes", "kept"}``."""
        removed = freed = 0
        with self._lock, fs.file_lock(self.root):
            self._sync(scan=True)
            for token in list(self._entries):
                if self._pins[token] > 0:
                    continue
                entry = self._entries.pop(token)
                self._own.discard(token)
                fs.remove_dir(self.root / token)
                removed += 1
                freed += entry.size
            if self._owned():
                self._save()
            return {"removed": removed, "bytes": freed, "kept": len(self._entries)}


def cache_dir() -> Path:
    """The dedicated staging directory: ``origin-uploads`` under Quantized's
    per-user cache dir, or under ``$QZ_UPLOAD_CACHE_DIR`` when set (always a
    subdirectory -- the override itself may hold other files)."""
    override = os.environ.get(ENV_OVERRIDE)
    base = Path(override) if override else Path(
        platformdirs.user_cache_dir(_APP_NAME, appauthor=False)
    )
    return base / _SUBDIR


_default: UploadCache | None = None
_default_lock = threading.Lock()


def get_cache() -> UploadCache:
    """The process-wide cache (created on first use from :func:`cache_dir`).
    Construction may re-hash unindexed files: call it off the event loop."""
    global _default
    with _default_lock:
        if _default is None or _default.root != cache_dir():
            _default = UploadCache(cache_dir())
        return _default


def stage_upload(name: str, content: bytes) -> tuple[Path, str]:
    """Stage already-in-memory ``content``; returns ``(path, token)``."""
    return get_cache().stage(name, content)


async def stage_upload_stream(
    name: str,
    source: AsyncChunkReader,
    *,
    max_bytes: int | None = None,
    pinned: bool = False,
) -> tuple[Path, str]:
    """Stream an upload into the cache (see :meth:`UploadCache.stage_stream`).
    ``pinned=True`` pins the entry atomically with committing it; the caller
    must call :func:`clear_in_flight` once its parse finishes."""
    cache = await asyncio.to_thread(get_cache)
    return await cache.stage_stream(name, source, max_bytes=max_bytes, pinned=pinned)


def resolve_upload_token(token: str) -> Path | None:
    return get_cache().resolve(token)


def mark_in_flight(token: str) -> None:
    get_cache().mark_in_flight(token)


def clear_in_flight(token: str) -> None:
    get_cache().clear_in_flight(token)
