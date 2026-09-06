"""P1.7 "Pack Project" PR 2 — low-level streaming/verification primitives.

Split out of :mod:`quantized.portable.copying` purely to keep both modules
under the repo's 500-line god-module ceiling: this module holds the shared
result/error types, the manifest-``size`` coercion helper, and the actual
chunked read-hash-write loop (:func:`copy_stream`); :mod:`.copying` holds
only the ten-step per-file orchestration
(:func:`quantized.portable.copying.stage_one_file`) that calls into it. See
``staging.py``'s module docstring for the whole staging pipeline's contract
(failure model, cancellation, the ``originals_modified`` guarantee) — this
module, like ``copying.py``, has no policy of its own beyond what one
file's verified copy requires.
"""

from __future__ import annotations

import errno
import hashlib
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

__all__ = [
    "Probe",
    "ProgressCallback",
    "ShouldCancel",
    "ErrorCode",
    "StageProgress",
    "StagedFile",
    "StageError",
    "FileIdentity",
    "coerce_size",
    "safe_os_error",
    "remove_partial",
    "file_identity",
    "identity_changed",
    "copy_stream",
]

FileIdentity = tuple[int, int]

Probe = Callable[[str], Mapping[str, Any]]

ErrorCode = Literal[
    "changed_since_preview",
    "changed_during_copy",
    "read_failed",
    "write_failed",
    "checksum_mismatch",
    "destination_exists",
    "escape_rejected",
    "invalid_manifest",
    "cancelled",
]


@dataclass(slots=True)
class StageProgress:
    """One progress tick, emitted at most once per chunk (``phase=
    "copying"``) plus once per file when its post-copy verification starts
    (``phase="verifying"``). ``file_index`` is 1-based."""

    phase: Literal["copying", "verifying"]
    source_id: str
    bundle_path: str
    file_index: int
    file_count: int
    file_bytes_done: int
    file_bytes_total: int
    bytes_done: int
    bytes_total: int


ProgressCallback = Callable[[StageProgress], None]
ShouldCancel = Callable[[], bool]


@dataclass(slots=True)
class StagedFile:
    """One successfully copied-and-verified source. ``checksum`` is the
    ``"sha256:<hex>"`` of the bytes actually written (and re-read back),
    not merely the bytes read from the source -- computed once during the
    copy and confirmed again by the write-verification re-read."""

    source_id: str
    bundle_path: str
    bytes: int
    checksum: str
    original_path: str


@dataclass(slots=True)
class StageError:
    """One failure. ``message`` never includes an absolute path (original
    or staging) -- ``source_id``/``bundle_path`` are what identify which
    row failed; a message names states/reasons only."""

    source_id: str | None
    bundle_path: str | None
    code: ErrorCode
    message: str


def coerce_size(value: Any) -> int:
    """Coerce a manifest row's ``size`` field to a non-negative ``int``,
    tolerating a missing/``None``/non-numeric value (a malformed or
    hand-edited manifest row) by treating it as ``0`` rather than raising --
    the one shared implementation :mod:`quantized.portable.staging` and
    :mod:`quantized.portable.copying` both use, so
    ``bytes_total``/``file_bytes_total`` can never raise ``ValueError`` on a
    row like ``{"size": "n/a"}`` (review finding #7)."""
    return int(value) if isinstance(value, (int, float)) else 0


def safe_os_error(exc: OSError) -> str:
    """A description of ``exc`` that never includes a path -- ``str(exc)``
    on an ``OSError`` raised by a path-taking call (``open``, ``os.stat``,
    ...) embeds ``exc.filename``, which is an absolute original-source or
    staging path; a :class:`StageError` message must never leak one (review
    finding #3). Uses ``exc.strerror`` (the OS's own text for the errno)
    when present, falling back to the errno's symbolic name, then the
    exception's type name."""
    if exc.strerror:
        return exc.strerror
    if exc.errno is not None:
        code = errno.errorcode.get(exc.errno)
        if code:
            return code
    return type(exc).__name__


def remove_partial(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def file_identity(st: os.stat_result) -> FileIdentity:
    """``(st_dev, st_ino)`` from a ``stat``/``fstat`` result -- a source's
    identity fingerprint, stable across an already-open descriptor and a
    later re-``stat`` of its pathname, that a pathname's size and mtime
    alone cannot provide: an atomic replace (``os.replace``) of the
    pathname with a same-size file whose mtime is then restored to match
    is invisible to size/mtime but changes this pair.

    Python populates both fields on every major platform for a regular
    file, Windows included (``st_dev`` is the volume serial number,
    ``st_ino`` the file index) -- but a ``0`` on either axis means this
    platform/filesystem left the field unpopulated. See
    :func:`identity_changed` for how that case is handled."""
    return (st.st_dev, st.st_ino)


def identity_changed(before: FileIdentity, after: FileIdentity) -> bool:
    """``True`` only when ``before`` and ``after`` are BOTH fully known
    (neither axis of either pair is ``0``) and they disagree.

    Documented conservative fallback: when either identity carries a ``0``
    on any axis (the platform/filesystem never populated ``st_dev``/
    ``st_ino`` for that stat), identity is treated as UNKNOWN and this
    always returns ``False`` -- never a false mismatch. In that case
    identity contributes nothing and callers fall back to size/mtime (plus,
    when present, a manifest checksum) as their only guard, exactly as
    before this check existed."""
    before_dev, before_ino = before
    after_dev, after_ino = after
    if before_dev == 0 or before_ino == 0 or after_dev == 0 or after_ino == 0:
        return False
    return before != after


def _write_all(fd: int, data: bytes) -> None:
    """``os.write`` is not guaranteed to write the whole buffer in one
    call -- loop until every byte is accepted, or raise."""
    view = memoryview(data)
    total = 0
    while total < len(view):
        n = os.write(fd, view[total:])
        if n <= 0:
            raise OSError("short write: os.write accepted 0 bytes")
        total += n


def copy_stream(
    fd: int,
    src: Any,
    *,
    chunk_bytes: int,
    should_cancel: ShouldCancel | None,
    source_id: str,
    bundle_path: str,
    emit: Callable[[int], None],
) -> tuple[int, str] | StageError:
    """Stream ``src`` into the already-open destination fd ``fd``,
    hashing as it goes. Always closes ``fd`` before returning OR raising --
    the destination file is never left open by this helper. The raising
    case matters on Windows (CI, #306): a caller-supplied ``emit``/
    ``should_cancel`` callback that raises used to unwind past the open
    descriptor, and Windows refuses to delete an open file, so the
    staging-directory cleanup that follows reported ``cleanup_ok=False``
    and the partial copy was leaked. POSIX unlinks open files happily,
    which is why the leak was invisible there.
    """
    closed = False

    def _close() -> None:
        nonlocal closed
        if not closed:
            closed = True
            os.close(fd)

    try:
        return _copy_stream_body(
            fd,
            src,
            chunk_bytes=chunk_bytes,
            should_cancel=should_cancel,
            source_id=source_id,
            bundle_path=bundle_path,
            emit=emit,
            close=_close,
        )
    finally:
        _close()


def _copy_stream_body(
    fd: int,
    src: Any,
    *,
    chunk_bytes: int,
    should_cancel: ShouldCancel | None,
    source_id: str,
    bundle_path: str,
    emit: Callable[[int], None],
    close: Callable[[], None],
) -> tuple[int, str] | StageError:
    digest = hashlib.sha256()
    bytes_copied = 0
    while True:
        if should_cancel is not None and should_cancel():
            close()
            return StageError(source_id, bundle_path, "cancelled", "staging cancelled mid-copy")
        try:
            chunk = src.read(chunk_bytes)
        except OSError as exc:
            close()
            return StageError(
                source_id, bundle_path, "read_failed", f"source read failed: {safe_os_error(exc)}"
            )
        if not chunk:
            break
        try:
            _write_all(fd, chunk)
        except OSError as exc:
            close()
            return StageError(
                source_id,
                bundle_path,
                "write_failed",
                f"destination write failed: {safe_os_error(exc)}",
            )
        digest.update(chunk)
        bytes_copied += len(chunk)
        emit(bytes_copied)
    try:
        os.fsync(fd)
    except OSError as exc:
        close()
        return StageError(
            source_id, bundle_path, "write_failed", f"fsync failed: {safe_os_error(exc)}"
        )
    close()
    return bytes_copied, digest.hexdigest()
