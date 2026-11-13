"""Persistent, byte-bounded staging for Origin project uploads (lazy per-book
transport, ``ORIGIN_FILE_DECODE_PLAN`` #38).

``/api/parsers/upload``'s ordinary path stages the file in an ephemeral
``tempfile.TemporaryDirectory`` that is deleted before the response returns --
fine for a one-shot full import, but a lazy import needs the bytes to survive
until the browser later activates a non-primary book and fetches its full
data (``routes/books.py``). Origin project uploads are staged here instead,
under an opaque token the frontend echoes back on that fetch.

Survives what the old in-memory token map did not (audit 2026-11: a lazy book
became unrecoverable -- 404 "upload expired" -- after an app restart, or after
eight more uploads):

* **Content-hash tokens.** The token is the SHA-256 of the file's bytes plus
  its lower-cased extension, so re-uploading the same file yields the same
  token (one copy on disk) and a token stays meaningful across restarts.
* **On disk, with a persisted index.** Files live in Quantized's own per-user
  CACHE dir (``platformdirs``; ``QZ_UPLOAD_CACHE_DIR`` overrides it, as the
  tests do) at ``<root>/<token>/<basename>``, and ``index.json`` records
  each entry's name, size and last use. A new :class:`UploadCache` over the
  same directory -- the next app start -- resolves every token the previous
  one staged.
* **Bounded by bytes, not count.** At most :data:`MAX_TOTAL_BYTES` (2 GiB) of
  staged uploads are kept; past that the least-recently-USED entries go first
  (a book fetch counts as a use). The entry just staged is never evicted by
  its own commit, so one upload larger than the whole budget still lands
  (and goes when the next upload arrives).

Entries whose parse is still running are pinned (``mark_in_flight``) and
skipped by eviction -- several uploads can be staged while an earlier one's
parse is still reading its file (``routes/parsers.py`` runs it in a
threadpool), and unlinking it then would fail a valid upload.

Never touches anything it did not create: tokens are checked against
``^[0-9a-f]{64}$`` and names must be plain basenames before any path is
formed, and cleanup only removes token-named directories and this module's
own ``.tmp-*`` staging files inside its root.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import secrets
import threading
import time
from collections import Counter, OrderedDict
from dataclasses import dataclass
from pathlib import Path

import platformdirs

from quantized.routes._uploadstream import AsyncChunkReader, stream_to_path

__all__ = [
    "ENV_OVERRIDE",
    "MAX_TOTAL_BYTES",
    "UploadCache",
    "clear_in_flight",
    "get_cache",
    "mark_in_flight",
    "resolve_upload_token",
    "stage_upload",
    "stage_upload_stream",
]

ENV_OVERRIDE = "QZ_UPLOAD_CACHE_DIR"
#: Total on-disk budget for staged uploads (documented limit).
MAX_TOTAL_BYTES = 2 * 1024**3
_APP_NAME = "quantized"
_SUBDIR = "origin-uploads"
_INDEX = "index.json"
_TMP_PREFIX = ".tmp-"
_TOKEN_RE = re.compile(r"[0-9a-f]{64}")
_HASH_CHUNK = 1 << 20


@dataclass
class _Entry:
    name: str
    size: int
    last_used: float


def _valid_name(name: object) -> bool:
    return (
        isinstance(name, str)
        and name not in ("", ".", "..")
        and Path(name).name == name
        and "\x00" not in name
        and not name.startswith(_TMP_PREFIX)
    )


def _file_token(path: Path, name: str) -> str:
    """SHA-256 of the file's bytes plus its lower-cased extension (the
    extension drives format dispatch, so the same bytes under ``.opj`` and
    ``.opju`` stay distinct entries)."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(_HASH_CHUNK):
            h.update(chunk)
    h.update(b"\x00" + Path(name).suffix.lower().encode("utf-8", "replace"))
    return h.hexdigest()


class UploadCache:
    """One staging directory + its persisted LRU index (module docstring)."""

    def __init__(self, root: Path, max_bytes: int = MAX_TOTAL_BYTES) -> None:
        self.root = Path(root)
        self.max_bytes = max_bytes
        self._lock = threading.RLock()
        self._entries: OrderedDict[str, _Entry] = OrderedDict()
        self._pins: Counter[str] = Counter()
        self._load()

    # -- persistence ------------------------------------------------------
    def _path(self, token: str, entry: _Entry) -> Path:
        return self.root / token / entry.name

    def _load(self) -> None:
        """Read the index, keeping only entries whose file is still there
        with its recorded size; then sweep token dirs the index no longer
        names and stale ``.tmp-*`` files (a crash mid-stage)."""
        try:
            raw = json.loads((self.root / _INDEX).read_text("utf-8"))
        except (OSError, ValueError):
            raw = {}
        rows = raw.get("entries", {}) if isinstance(raw, dict) else {}
        loaded: list[tuple[str, _Entry]] = []
        for token, row in (rows.items() if isinstance(rows, dict) else []):
            if not (isinstance(token, str) and _TOKEN_RE.fullmatch(token)):
                continue
            if not isinstance(row, dict) or not _valid_name(row.get("name")):
                continue
            size, used = row.get("size"), row.get("last_used")
            if not isinstance(size, int) or not isinstance(used, (int, float)):
                continue
            entry = _Entry(str(row["name"]), size, float(used))
            path = self._path(token, entry)
            if path.is_file() and path.stat().st_size == size:
                loaded.append((token, entry))
        loaded.sort(key=lambda te: te[1].last_used)
        self._entries = OrderedDict(loaded)
        self._sweep_orphans()

    def _sweep_orphans(self) -> None:
        if not self.root.is_dir():
            return
        for child in self.root.iterdir():
            orphan = _TOKEN_RE.fullmatch(child.name) and child.name not in self._entries
            if child.is_dir() and orphan:
                self._remove_dir(child)
            elif child.is_file() and child.name.startswith(_TMP_PREFIX):
                with contextlib.suppress(OSError):
                    child.unlink()

    def _save(self) -> None:
        """Write the index atomically (temp file + ``os.replace``)."""
        self.root.mkdir(parents=True, exist_ok=True)
        rows = {
            t: {"name": e.name, "size": e.size, "last_used": e.last_used}
            for t, e in self._entries.items()
        }
        tmp = self.root / f"{_TMP_PREFIX}index-{secrets.token_hex(4)}"
        tmp.write_text(json.dumps({"version": 1, "entries": rows}), "utf-8")
        os.replace(tmp, self.root / _INDEX)

    @staticmethod
    def _remove_dir(directory: Path) -> None:
        """Remove a token directory this cache created (its one file)."""
        for child in directory.iterdir() if directory.is_dir() else []:
            with contextlib.suppress(OSError):
                child.unlink()
        with contextlib.suppress(OSError):
            directory.rmdir()

    # -- bound ------------------------------------------------------------
    def total_bytes(self) -> int:
        with self._lock:
            return sum(e.size for e in self._entries.values())

    def _evict(self, keep: str | None = None) -> None:
        """Drop least-recently-used, unpinned entries (never ``keep``) until
        the total is within :attr:`max_bytes`. Pinned entries may leave the
        cache briefly over budget; ``clear_in_flight`` retries."""
        total = sum(e.size for e in self._entries.values())
        for token in list(self._entries):
            if total <= self.max_bytes:
                break
            if token == keep or self._pins[token] > 0:
                continue
            entry = self._entries.pop(token)
            total -= entry.size
            self._remove_dir(self.root / token)

    # -- public API -------------------------------------------------------
    def _commit(self, tmp: Path, name: str, *, pinned: bool) -> tuple[Path, str]:
        """Move a fully written ``tmp`` file into place under its content
        token (or drop it when that content is already staged), pin it if
        asked -- atomically with registering it, so its own eviction sweep can
        never pick it -- then evict and persist."""
        token = _file_token(tmp, name)
        with self._lock:
            entry = self._entries.get(token)
            if entry is not None and self._path(token, entry).is_file():
                tmp.unlink(missing_ok=True)
                entry.last_used = time.time()
            else:
                dest_dir = self.root / token
                dest_dir.mkdir(parents=True, exist_ok=True)
                entry = _Entry(name, tmp.stat().st_size, time.time())
                os.replace(tmp, dest_dir / name)
                self._entries[token] = entry
            self._entries.move_to_end(token)
            if pinned:
                self._pins[token] += 1
            self._evict(keep=token)
            self._save()
            return self._path(token, entry), token

    def _tmp_path(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        return self.root / f"{_TMP_PREFIX}{secrets.token_hex(8)}"

    def stage(self, name: str, content: bytes, *, pinned: bool = False) -> tuple[Path, str]:
        """Stage in-memory ``content`` as ``name``; returns ``(path, token)``."""
        name = _checked_name(name)
        tmp = self._tmp_path()
        tmp.write_bytes(content)
        return self._commit(tmp, name, pinned=pinned)

    async def stage_stream(
        self,
        name: str,
        source: AsyncChunkReader,
        *,
        max_bytes: int | None = None,
        pinned: bool = False,
    ) -> tuple[Path, str]:
        """Streaming :meth:`stage`: chunks go straight to disk; an oversize
        upload leaves nothing behind and raises ``UploadTooLargeError``."""
        name = _checked_name(name)
        tmp = self._tmp_path()
        try:
            await stream_to_path(source, tmp, filename=name, max_bytes=max_bytes)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return self._commit(tmp, name, pinned=pinned)

    def resolve(self, token: str) -> Path | None:
        """The staged file for ``token`` (and mark it used), or ``None`` when
        unknown, evicted, malformed, or removed out of band."""
        if not (isinstance(token, str) and _TOKEN_RE.fullmatch(token)):
            return None
        with self._lock:
            entry = self._entries.get(token)
            if entry is None:
                return None
            path = self._path(token, entry)
            if not path.is_file():
                del self._entries[token]
                self._save()
                return None
            entry.last_used = time.time()
            self._entries.move_to_end(token)
            self._save()
            return path

    def mark_in_flight(self, token: str) -> None:
        with self._lock:
            self._pins[token] += 1

    def clear_in_flight(self, token: str) -> None:
        """Unpin once its parse finished; re-run eviction, which a pinned
        entry may have held off."""
        with self._lock:
            if self._pins[token] > 0:
                self._pins[token] -= 1
            if self._pins[token] <= 0:
                del self._pins[token]
            before = len(self._entries)
            self._evict()
            if len(self._entries) != before:
                self._save()

    def is_pinned(self, token: str) -> bool:
        with self._lock:
            return self._pins[token] > 0


def _checked_name(name: str) -> str:
    base = Path(name).name
    if not _valid_name(base):
        raise ValueError(f"invalid upload name: {name!r}")
    return base


def cache_dir() -> Path:
    """Quantized's per-user cache dir for staged uploads (``QZ_UPLOAD_CACHE_DIR``
    overrides it)."""
    override = os.environ.get(ENV_OVERRIDE)
    if override:
        return Path(override)
    return Path(platformdirs.user_cache_dir(_APP_NAME, appauthor=False)) / _SUBDIR


_default: UploadCache | None = None
_default_lock = threading.Lock()


def get_cache() -> UploadCache:
    """The process-wide cache (created on first use from :func:`cache_dir`)."""
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
    return await get_cache().stage_stream(name, source, max_bytes=max_bytes, pinned=pinned)


def resolve_upload_token(token: str) -> Path | None:
    return get_cache().resolve(token)


def mark_in_flight(token: str) -> None:
    get_cache().mark_in_flight(token)


def clear_in_flight(token: str) -> None:
    get_cache().clear_in_flight(token)
