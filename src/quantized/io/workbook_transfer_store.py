"""Guarded, expiring on-disk store for LARGE cross-instance workbook transfer
packages (LIBRARY_WORKBOOK_UX_PLAN, "Cross-session workbook transfer
requirements" box 5 and PR I's booked file-based fallback -- "Group F").

Workbook Copy/Paste (``frontend/src/lib/workbookTransfer.ts``) puts a
versioned JSON package on the system clipboard as text. Up to the inline
bound (``MAX_TRANSFER_PACKAGE_CHARS``, 8 M characters) that is unchanged.
Above it, the source instance stores the package HERE and puts only a small
descriptor (id + token + size + expiry + a human summary line) on the
clipboard; the destination instance -- a separate Quantized process with its
own backend, possibly on another port -- reads the descriptor and fetches the
package back through its OWN backend. That is why this store is a shared
on-disk directory, never process memory: two backends on one machine share
nothing else.

Pure library (``io`` layer): bytes in, bytes out. ``routes/workbook_transfer``
is the thin HTTP adapter. No fastapi/pydantic import here.

## Write authority (the PR I "write-consent" deferral, answered)

PR I deferred this fallback because "new filesystem-write authority needs its
own adversarially-reviewed contract ... backend-verifiable rather than
caller-asserted" (its plan-doc entry; the ``grant_source_paths`` precedent,
where caller-asserted PATHS were the hazard). The authority granted here is
deliberately narrower than that, and every limit is enforced by this module,
never trusted from the caller:

* **No caller-chosen path, ever.** A store request carries only bytes. The
  directory is Quantized's own per-user CACHE dir (``platformdirs``, the
  same library ``io/import_filters.py`` uses for the config dir), never a
  location next to user data; the file name is ``<id>.qzxfer`` where ``id``
  is 128 random bits minted HERE. Fetch/delete ids are checked against
  ``^[0-9a-f]{32}$`` (``fullmatch``) BEFORE any path is formed, so ``..``,
  separators, drive letters, and NUL can never reach the filesystem.
* **Never touches anything it did not create.** Cleanup and eviction only
  consider names matching this module's own two patterns (``<id>.qzxfer`` and
  ``.qzxfer-tmp-*.part``) inside that one directory; nothing is recursed into
  and nothing else is deleted. It cannot be pointed at a user file.
* **Bounded.** ``MIN_PACKAGE_BYTES`` <= one package <= ``MAX_PACKAGE_BYTES``;
  the directory <= ``MAX_TOTAL_BYTES`` (oldest evicted first, by BYTES only)
  and ``MAX_ENTRIES`` unexpired packages -- a store past the entry cap is
  REFUSED (``StoreFull``), never made room for by evicting a live copy, so a
  burst of small junk stores cannot wipe a user's real one; the minimum size
  keeps junk from taking slots cheaply. Every package expires
  ``DEFAULT_TTL_SECONDS`` after it was stored.
* **Read needs the token.** A package is released only to a caller holding
  its 256-bit token, compared in constant time against a SHA-256 of it (the
  token itself is never written to disk). The route takes the token in a
  header, never the URL, so it cannot land in an access log.

So a user consents to this write the same way they consent to the clipboard
write it replaces: by pressing Copy. It is the same class of write
``routes/_uploadcache.py`` (server-named, bounded staging copies) and
``io/import_filters.py`` (app-owned config file) already perform from HTTP
routes, and ``tests/test_write_sites.py`` lists it with that justification.

## Lifetime: 24 h

The transport is a clipboard, whose content outlives no working session in
practice: copy in one window, paste in another minutes later. 24 h covers
"copied before lunch, pasted after the afternoon meeting" and an overnight
machine sleep; anything older is almost certainly a stale clipboard, and the
package on disk is a full copy of scientific data the user did not ask to
keep. The directory bound makes the disk cost finite regardless of TTL.

## Concurrency (two processes, one directory)

Publishing is atomic: the package is written and ``fsync``-ed to a temp file
in the same directory, then renamed into place with a no-replace rename
(``portable.atomic_rename``; plain ``os.replace`` after an existence check
where the platform has none). A reader therefore sees a whole package or
none -- a crash mid-write leaves only a ``.part`` temp file, which is never
served and is swept once older than ``TEMP_GRACE_SECONDS`` (never sooner, so
another process's in-progress write is not deleted under it). Every removal
tolerates the file already being gone (another process cleaned it first) or
being in use (Windows): cleanup is idempotent and retried on the next store.
Admission (bound check, eviction, publish, and a post-publish trim) runs
under one process-wide lock and counts this process's other IN-FLIGHT
writes as spoken for (it evicts for them; it never refuses over them), so
within one process the published total never exceeds ``MAX_TOTAL_BYTES``
and the unexpired count never exceeds
``MAX_ENTRIES``. Across processes there is no shared lock: P processes
admitting at the same instant can each see room, so the directory can
transiently exceed ``MAX_TOTAL_BYTES`` by at most (P - 1) x
(``MAX_PACKAGE_BYTES`` + ``HEADER_BYTES``) and ``MAX_ENTRIES`` by P - 1. The
byte overshoot lasts only until the last of them finishes: each trims the
oldest OTHER packages back under the byte cap after publishing.

A package-named file whose header this build does not recognise (a newer
build's format sharing the directory, say) is left alone until its mtime is
older than the TTL -- never deleted on sight. Only a header of THIS format
and version whose payload length disagrees with it counts as corrupt.

## Streaming, never buffering

Neither direction holds a whole package in memory (ROBUSTNESS_PLAN #3):
:meth:`TransferStore.begin` returns a :class:`PendingPackage` the route
writes body chunks into (the byte cap is checked per chunk), and
:meth:`TransferStore.open_package` returns a handle positioned at the
payload for a chunked response. The header is a FIXED ``HEADER_BYTES``
block (JSON padded with spaces, newline-terminated), reserved up front and
filled in at commit once the size is known (``io/workbook_transfer_header``).
"""

from __future__ import annotations

import contextlib
import hmac
import os
import secrets
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

import platformdirs

from quantized.io.workbook_transfer_header import (
    HEADER_BYTES,
    PACKAGE_SUFFIX,
    CleanupReport,
    EmptyPackage,
    InvalidPackageId,
    PackageExpired,
    PackageNotFound,
    PackageTooLarge,
    PackageTooSmall,
    StoredPackage,
    StoreFull,
    TransferStoreError,
    encode_header,
    is_valid_package_id,
    token_digest,
)
from quantized.io.workbook_transfer_header import Entry as _Entry
from quantized.io.workbook_transfer_header import is_package_name as _is_package_name
from quantized.io.workbook_transfer_header import read_entry as _read_entry
from quantized.portable.atomic_rename import NoReplaceUnsupported, rename_noreplace

__all__ = [
    "DEFAULT_TTL_SECONDS",
    "MAX_PACKAGE_BYTES",
    "MAX_TOTAL_BYTES",
    "MIN_PACKAGE_BYTES",
    "CleanupReport",
    "EmptyPackage",
    "InvalidPackageId",
    "PackageExpired",
    "PackageNotFound",
    "PackageTooLarge",
    "PackageTooSmall",
    "PendingPackage",
    "StoreFull",
    "StoredPackage",
    "TransferStore",
    "TransferStoreError",
    "cleanup_transfer_dir",
    "is_valid_package_id",
    "transfer_dir",
]

ENV_OVERRIDE = "QZ_TRANSFER_DIR"
_APP_NAME = "quantized"
_SUBDIR = "workbook-transfer"

TEMP_PREFIX = ".qzxfer-tmp-"
TEMP_SUFFIX = ".part"

DEFAULT_TTL_SECONDS = 24 * 3600
# 16x the 8 M-character inline clipboard bound. JSON.parse of the package and
# the parseWorkspace re-validation each hold a copy in the destination's JS
# heap, so this stays well inside a browser's practical string/heap limits.
MAX_PACKAGE_BYTES = 128_000_000
MAX_TOTAL_BYTES = 512_000_000  # four max-size packages
MAX_ENTRIES = 32
# The client stores only packages over 8 M characters (smaller ones travel
# inline on the clipboard), so 1 MB is an eighth of the smallest real one.
MIN_PACKAGE_BYTES = 1_000_000
TEMP_GRACE_SECONDS = 3600
_ID_ATTEMPTS = 4

# One admission at a time per process, and the byte count of every write
# still streaming in this process (temp path -> header + payload so far).
_ADMIT_LOCK = threading.Lock()
_IN_FLIGHT: dict[str, int] = {}


def transfer_dir() -> Path:
    """Quantized's own per-user cache directory for transfer packages. Not
    created here (a read-only probe must not create it). ``QZ_TRANSFER_DIR``
    overrides it -- tests point it at a temp dir, like ``QZ_CONFIG_DIR``."""
    override = os.environ.get(ENV_OVERRIDE)
    if override:
        return Path(override)
    return Path(platformdirs.user_cache_dir(_APP_NAME, appauthor=False)) / _SUBDIR


def _new_id() -> str:
    return secrets.token_hex(16)


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _remove(path: Path) -> bool:
    """Best-effort unlink: False when already gone (another process won the
    race) or in use (Windows); the next cleanup retries."""
    try:
        path.unlink()
    except OSError:
        return False
    return True


class PendingPackage:
    """A package being written: :meth:`write` chunks, then :meth:`commit`
    (publish atomically) or :meth:`abort` (remove the temp file). Nothing is
    visible to readers until commit."""

    def __init__(self, store: TransferStore, fh: BinaryIO, tmp: str) -> None:
        self._store = store
        self._fh = fh
        self._tmp = tmp
        self.size = 0
        self._done = False

    def write(self, chunk: bytes) -> None:
        self.size += len(chunk)
        if self.size > self._store.max_package_bytes:
            self.abort()
            raise PackageTooLarge(
                f"transfer package is over the {self._store.max_package_bytes}-byte limit"
            )
        self._fh.write(chunk)
        with _ADMIT_LOCK:
            _IN_FLIGHT[self._tmp] = HEADER_BYTES + self.size

    def commit(self) -> StoredPackage:
        store = self._store
        try:
            if self.size == 0:
                raise EmptyPackage("transfer package is empty")
            if self.size < store.min_package_bytes:
                raise PackageTooSmall(
                    f"transfer package is under the {store.min_package_bytes}-byte minimum"
                )
            now = store.clock()
            token = store.new_token()
            expires = now + store.ttl_seconds
            header = encode_header(created_at=now, expires_at=expires, size=self.size, token=token)
            self._fh.seek(0)
            self._fh.write(header)
            self._fh.flush()
            os.fsync(self._fh.fileno())
            self._fh.close()
            package_id = store.admit(self._tmp, HEADER_BYTES + self.size)
        except BaseException:
            self.abort()
            raise
        self._done = True  # admit() already released the in-flight entry
        return StoredPackage(package_id, token, self.size, now, expires)

    def abort(self) -> None:
        """Idempotent: close and remove the temp file."""
        if self._done:
            return
        self._done = True
        with _ADMIT_LOCK:
            _IN_FLIGHT.pop(self._tmp, None)
        with contextlib.suppress(OSError):
            self._fh.close()
        with contextlib.suppress(OSError):
            os.unlink(self._tmp)


class TransferStore:
    """One directory of transfer packages. Cheap to construct; holds no
    state beyond its configuration, so any number of instances (in any
    number of processes) may share one directory."""

    def __init__(
        self,
        root: Path,
        *,
        clock: Callable[[], float] = time.time,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        max_package_bytes: int = MAX_PACKAGE_BYTES,
        max_total_bytes: int = MAX_TOTAL_BYTES,
        max_entries: int = MAX_ENTRIES,
        min_package_bytes: int = MIN_PACKAGE_BYTES,
        new_id: Callable[[], str] = _new_id,
        new_token: Callable[[], str] = _new_token,
    ) -> None:
        if max_package_bytes + HEADER_BYTES > max_total_bytes or max_entries < 1:
            raise ValueError("transfer store bounds cannot hold a single package")
        self.root = Path(root)
        self.clock = clock
        self.ttl_seconds = float(ttl_seconds)
        self.max_package_bytes = max_package_bytes
        self.max_total_bytes = max_total_bytes
        self.max_entries = max_entries
        self.min_package_bytes = min_package_bytes
        self.new_id = new_id
        self.new_token = new_token

    # -- public API ---------------------------------------------------------

    def begin(self) -> PendingPackage:
        """Start writing a package (sweeping expired ones first)."""
        self.root.mkdir(parents=True, exist_ok=True)
        self.cleanup()
        fd, tmp = tempfile.mkstemp(prefix=TEMP_PREFIX, suffix=TEMP_SUFFIX, dir=self.root)
        fh = os.fdopen(fd, "wb")
        pending = PendingPackage(self, fh, tmp)
        try:
            fh.write(b" " * HEADER_BYTES)  # reserved; filled in at commit
        except BaseException:
            pending.abort()
            raise
        return pending

    def put(self, data: bytes) -> StoredPackage:
        """Store in-memory ``data`` atomically; return its fresh id + token."""
        if len(data) > self.max_package_bytes:  # refuse before touching disk
            raise PackageTooLarge(
                f"transfer package is over the {self.max_package_bytes}-byte limit"
            )
        if not data:
            raise EmptyPackage("transfer package is empty")
        if len(data) < self.min_package_bytes:
            raise PackageTooSmall(
                f"transfer package is under the {self.min_package_bytes}-byte minimum"
            )
        pending = self.begin()
        pending.write(data)
        return pending.commit()

    def open_package(self, package_id: str, token: str) -> tuple[BinaryIO, int]:
        """An open handle positioned at the payload, and its size; the caller
        closes it. Raises InvalidPackageId / PackageNotFound / PackageExpired
        (an expired package is removed on the way out)."""
        entry = self._lookup(package_id, token)
        try:
            fh = entry.path.open("rb")
        except OSError as exc:  # evicted/cleaned by another process just now
            raise PackageNotFound("transfer package not found") from exc
        fh.seek(HEADER_BYTES)
        return fh, entry.size

    def get(self, package_id: str, token: str) -> bytes:
        """The whole payload (tests and small callers; the route streams)."""
        fh, size = self.open_package(package_id, token)
        with fh:
            payload = fh.read()
        if len(payload) != size:
            raise PackageNotFound("transfer package not found")
        return payload

    def delete(self, package_id: str, token: str) -> None:
        """Remove a package early (its token required). An already-expired
        package is gone either way, so that is not an error here."""
        try:
            entry = self._lookup(package_id, token)
        except PackageExpired:
            return
        _remove(entry.path)

    def cleanup(self) -> CleanupReport:
        """Remove expired and corrupt packages, foreign package-named files
        and temp files once old enough (TTL / ``TEMP_GRACE_SECONDS``). Never
        raises for a file another process removed first; never touches a
        name that is not ours."""
        if not self.root.is_dir():
            return CleanupReport()
        now = self.clock()
        expired = stale = corrupt = 0
        for path in self._listing():
            name = path.name
            if name.startswith(TEMP_PREFIX) and name.endswith(TEMP_SUFFIX):
                if _older_than(path, now, TEMP_GRACE_SECONDS) and _remove(path):
                    stale += 1
            elif _is_package_name(name):
                entry = _read_entry(path)
                if entry == "corrupt":
                    corrupt += _remove(path)
                elif entry == "foreign":
                    stale += _older_than(path, now, self.ttl_seconds) and _remove(path)
                elif isinstance(entry, _Entry) and now >= entry.expires_at:
                    expired += _remove(path)
        return CleanupReport(expired, stale, corrupt)

    def admit(self, tmp: str, incoming: int) -> str:
        """Publish a finished temp file of ``incoming`` bytes within bounds:
        refuse past the entry cap, evict oldest by bytes, publish, then trim
        any cross-process overshoot. Serialized per process (module doc)."""
        with _ADMIT_LOCK:
            _IN_FLIGHT.pop(tmp, None)
            reserved = sum(_IN_FLIGHT.values())
            self._make_room(incoming, reserved)
            package_id = self.publish(tmp)
            self._trim(keep=package_id)
        return package_id

    def _live(self) -> list[_Entry]:
        """Unexpired packages, oldest first."""
        now = self.clock()
        found = [_read_entry(p) for p in self._listing() if _is_package_name(p.name)]
        live = [e for e in found if isinstance(e, _Entry) and now < e.expires_at]
        return sorted(live, key=lambda e: (e.created_at, e.package_id))

    def _make_room(self, incoming: int, reserved: int) -> None:
        """Refuse past the entry cap; else evict oldest by bytes so this file
        AND this process's other in-flight writes (``reserved``) fit. The
        reservation only ever evicts -- it never refuses: first to commit
        wins, and ``incoming`` alone always fits an empty store."""
        entries = self._live()
        if len(entries) >= self.max_entries:
            raise StoreFull(f"transfer store is full ({len(entries)} unexpired packages)")
        total = sum(HEADER_BYTES + e.size for e in entries)
        while entries and total + incoming + reserved > self.max_total_bytes:
            oldest = entries.pop(0)
            _remove(oldest.path)
            total -= HEADER_BYTES + oldest.size

    def _trim(self, keep: str) -> None:
        entries = self._live()
        total = sum(HEADER_BYTES + e.size for e in entries)
        for oldest in [e for e in entries if e.package_id != keep]:
            if total <= self.max_total_bytes:
                break
            _remove(oldest.path)
            total -= HEADER_BYTES + oldest.size

    def publish(self, tmp: str) -> str:
        """Rename a finished temp file to a fresh, unused id's name. A
        collision (astronomically unlikely with 128 random bits, but the id
        generator is injectable) mints another id; nothing is overwritten."""
        for _ in range(_ID_ATTEMPTS):
            package_id = self.new_id()
            dest = str(self._path_for(package_id))
            try:
                rename_noreplace(tmp, dest)
            except FileExistsError:
                continue
            except NoReplaceUnsupported:
                if os.path.lexists(dest):
                    continue
                os.replace(tmp, dest)
            return package_id
        raise TransferStoreError("could not allocate a unique transfer package id")

    # -- internals ----------------------------------------------------------

    def _listing(self) -> list[Path]:
        try:
            return list(self.root.iterdir())
        except OSError:
            return []

    def _path_for(self, package_id: str) -> Path:
        if not is_valid_package_id(package_id):
            raise InvalidPackageId("invalid transfer package id")
        return self.root / f"{package_id}{PACKAGE_SUFFIX}"

    def _lookup(self, package_id: str, token: str) -> _Entry:
        path = self._path_for(package_id)
        entry = _read_entry(path)
        # One answer for "absent" and "wrong token": no existence oracle.
        # The digest compare runs whether or not the file exists.
        stored = entry.token_sha256 if isinstance(entry, _Entry) else "0" * 64
        matched = hmac.compare_digest(token_digest(str(token)), stored)
        if not isinstance(entry, _Entry) or not matched:
            raise PackageNotFound("transfer package not found")
        if self.clock() >= entry.expires_at:
            _remove(entry.path)
            raise PackageExpired("transfer package expired")
        return entry


def _older_than(path: Path, now: float, seconds: float) -> bool:
    try:
        return now - path.stat().st_mtime > seconds
    except OSError:
        return False


def cleanup_transfer_dir(root: Path | None = None) -> CleanupReport:
    """Startup sweep: clean an EXISTING transfer dir; never create one."""
    directory = transfer_dir() if root is None else root
    if not directory.is_dir():
        return CleanupReport()
    return TransferStore(directory).cleanup()
