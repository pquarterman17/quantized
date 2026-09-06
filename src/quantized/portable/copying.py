"""P1.7 "Pack Project" PR 2 — the verified, single-source copy step.

Split out of :mod:`quantized.portable.staging` purely to stay under the
repo's 500-line god-module ceiling: :func:`stage_one_file` below is the
one function that actually touches a source file's bytes, and it earns
its own module. See ``staging.py``'s module docstring for the whole
staging pipeline's contract (failure model, cancellation, the
``originals_modified`` guarantee); this module has no policy of its own
beyond what one file's verified copy requires.

## The nine-step verified copy (mirrors ``staging.py``'s per-file ruling)

1. Re-probe the original path RIGHT NOW (never trust the manifest's
   snapshot) -- anything but ``state == "ok"`` is ``read_failed``.
2. Compare the fresh probe's size/mtime/checksum against whatever the
   manifest recorded for each field BOTH sides have -- any disagreement is
   ``changed_since_preview`` (the file changed between the dry-run preview
   and this copy, before a single byte was touched).
3. Compute the destination path and confirm its parent directory resolves
   (symlink-aware, via ``os.path.realpath`` + ``os.path.commonpath``)
   inside the staging root -- otherwise ``escape_rejected``.
4. Open the destination with ``O_CREAT | O_EXCL | O_NOFOLLOW`` -- it must
   not already exist and must not be a symlink -- otherwise
   ``destination_exists``.
5. Open the source strictly ``"rb"``, fstat it, and confirm that size
   matches the fresh probe -- otherwise ``changed_during_copy``.
6. Stream ``chunk_bytes`` at a time, hashing and writing each chunk,
   polling ``should_cancel`` between chunks; a short/long read against the
   pre-copy fstat size is ``changed_during_copy``; a write failure (a full
   disk, say) is ``write_failed``.
7. fsync + close the destination, then re-stat the SOURCE -- any
   size/mtime drift since step 5's fstat is ``changed_during_copy`` (the
   file was edited while being copied).
8. If the fresh probe carried a checksum, it must equal the hash computed
   while streaming -- otherwise ``checksum_mismatch``.
9. Re-read the WRITTEN file from disk and hash it a second time -- it must
   equal the same computed hash, catching a short write that fsync alone
   would not -- otherwise ``write_failed``.

Any failure at any step removes the partial destination file (the whole
staging directory is then torn down by the caller in ``staging.py`` --
this module never deletes anything outside the one file it is working
on).
"""

from __future__ import annotations

import errno
import hashlib
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from .layout import join_bundle_path

__all__ = [
    "Probe",
    "ProgressCallback",
    "ShouldCancel",
    "ErrorCode",
    "StageProgress",
    "StagedFile",
    "StageError",
    "stage_one_file",
]

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


def _remove_partial(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


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


def _copy_stream(
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
    hashing as it goes. Always closes ``fd`` before returning (success or
    failure) -- the destination file is never left open by this helper.
    """
    digest = hashlib.sha256()
    bytes_copied = 0
    while True:
        if should_cancel is not None and should_cancel():
            os.close(fd)
            return StageError(
                source_id, bundle_path, "cancelled", "staging cancelled mid-copy"
            )
        try:
            chunk = src.read(chunk_bytes)
        except OSError as exc:
            os.close(fd)
            return StageError(
                source_id, bundle_path, "read_failed", f"source read failed: {exc}"
            )
        if not chunk:
            break
        try:
            _write_all(fd, chunk)
        except OSError as exc:
            os.close(fd)
            return StageError(
                source_id, bundle_path, "write_failed", f"destination write failed: {exc}"
            )
        digest.update(chunk)
        bytes_copied += len(chunk)
        emit(bytes_copied)
    try:
        os.fsync(fd)
    except OSError as exc:
        os.close(fd)
        return StageError(source_id, bundle_path, "write_failed", f"fsync failed: {exc}")
    os.close(fd)
    return bytes_copied, digest.hexdigest()


def stage_one_file(
    row: Mapping[str, Any],
    staging_root: str,
    *,
    probe: Probe,
    progress: ProgressCallback | None,
    should_cancel: ShouldCancel | None,
    chunk_bytes: int,
    file_index: int,
    file_count: int,
    bytes_total: int,
    bytes_done_before: int,
) -> tuple[StagedFile, int] | StageError:
    """Copy and verify one manifest row. See the module docstring's
    nine-step pipeline. Returns ``(StagedFile, new_bytes_done)`` on
    success, a :class:`StageError` otherwise. Never raises."""
    source_id = row["source_id"]
    bundle_path = row["bundle_path"]
    original_path = row["original_path"]
    row_size = row.get("size")
    file_bytes_total = int(row_size) if isinstance(row_size, (int, float)) else 0

    def emit(phase: Literal["copying", "verifying"], file_bytes_done: int) -> None:
        if progress is None:
            return
        progress(
            StageProgress(
                phase=phase,
                source_id=source_id,
                bundle_path=bundle_path,
                file_index=file_index,
                file_count=file_count,
                file_bytes_done=file_bytes_done,
                file_bytes_total=file_bytes_total,
                bytes_done=bytes_done_before + file_bytes_done,
                bytes_total=bytes_total,
            )
        )

    # 1. re-probe now.
    probed = probe(original_path)
    state = probed.get("state")
    if state != "ok":
        return StageError(
            source_id, bundle_path, "read_failed", f"source is not readable (state={state!r})"
        )
    probed_size = probed.get("size")
    probed_mtime = probed.get("mtime")
    probed_checksum = probed.get("checksum")

    # 2. compare against the manifest's recorded provenance.
    for field, recorded, fresh in (
        ("size", row.get("size"), probed_size),
        ("mtime", row.get("mtime"), probed_mtime),
        ("checksum", row.get("checksum"), probed_checksum),
    ):
        if recorded is not None and fresh is not None and recorded != fresh:
            return StageError(
                source_id,
                bundle_path,
                "changed_since_preview",
                f"source {field} changed since the dry-run preview",
            )

    # 3. destination + containment.
    try:
        dest = join_bundle_path(staging_root, bundle_path)
    except ValueError:
        return StageError(
            source_id, bundle_path, "invalid_manifest", "bundle_path is not bundle-relative"
        )
    parent = os.path.dirname(dest)
    real_root = os.path.realpath(staging_root)
    real_parent = os.path.realpath(parent)
    try:
        escapes = os.path.commonpath([real_root, real_parent]) != real_root
    except ValueError:
        escapes = True
    if escapes:
        return StageError(
            source_id,
            bundle_path,
            "escape_rejected",
            "destination directory escapes the staging root",
        )
    os.makedirs(parent, exist_ok=True)

    # 4. create the destination, refusing to overwrite or follow a symlink.
    open_flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_BINARY", 0)
    )
    try:
        fd = os.open(dest, open_flags, 0o644)
    except FileExistsError:
        return StageError(
            source_id, bundle_path, "destination_exists", "destination already exists in staging"
        )
    except OSError as exc:
        if exc.errno in (errno.EEXIST, errno.ELOOP):  # ELOOP: symlink hit by O_NOFOLLOW
            return StageError(
                source_id,
                bundle_path,
                "destination_exists",
                "destination already exists in staging",
            )
        return StageError(
            source_id, bundle_path, "write_failed", f"could not create destination: {exc}"
        )

    # 5. open the source read-only and confirm its size against the probe.
    try:
        src = open(original_path, "rb")
    except OSError as exc:
        os.close(fd)
        _remove_partial(dest)
        return StageError(source_id, bundle_path, "read_failed", f"could not open source: {exc}")

    with src:
        try:
            pre_stat = os.fstat(src.fileno())
        except OSError as exc:
            os.close(fd)
            _remove_partial(dest)
            return StageError(
                source_id, bundle_path, "read_failed", f"could not stat source: {exc}"
            )
        if probed_size is not None and pre_stat.st_size != probed_size:
            os.close(fd)
            _remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "changed_during_copy",
                "source size differs from its pre-copy probe",
            )

        # 6. stream + hash.
        outcome = _copy_stream(
            fd,
            src,
            chunk_bytes=chunk_bytes,
            should_cancel=should_cancel,
            source_id=source_id,
            bundle_path=bundle_path,
            emit=lambda done: emit("copying", done),
        )
        if isinstance(outcome, StageError):
            _remove_partial(dest)
            return outcome
        bytes_copied, digest_hex = outcome
        if bytes_copied != pre_stat.st_size:
            _remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "changed_during_copy",
                "source yielded a different byte count than its pre-copy size",
            )

        # 7. re-stat the source post-copy.
        try:
            post_stat = os.stat(original_path)
        except OSError as exc:
            _remove_partial(dest)
            return StageError(
                source_id, bundle_path, "read_failed", f"could not re-stat source: {exc}"
            )
        if post_stat.st_size != pre_stat.st_size or post_stat.st_mtime != pre_stat.st_mtime:
            _remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "changed_during_copy",
                "source was modified while being copied",
            )

    emit("verifying", bytes_copied)

    # 8. checksum agreement with the fresh probe (when it has one).
    computed_checksum = f"sha256:{digest_hex}"
    if probed_checksum and probed_checksum != computed_checksum:
        _remove_partial(dest)
        return StageError(
            source_id,
            bundle_path,
            "checksum_mismatch",
            "computed checksum does not match the probed checksum",
        )

    # 9. re-read the WRITTEN file and hash it again.
    try:
        rehash = hashlib.sha256()
        with open(dest, "rb") as verify_f:
            while True:
                chunk = verify_f.read(chunk_bytes)
                if not chunk:
                    break
                rehash.update(chunk)
    except OSError as exc:
        _remove_partial(dest)
        return StageError(
            source_id, bundle_path, "write_failed", f"could not re-read staged file: {exc}"
        )
    if rehash.hexdigest() != digest_hex:
        _remove_partial(dest)
        return StageError(
            source_id, bundle_path, "write_failed", "staged file failed its verification re-read"
        )

    staged = StagedFile(
        source_id=source_id,
        bundle_path=bundle_path,
        bytes=bytes_copied,
        checksum=computed_checksum,
        original_path=original_path,
    )
    return staged, bytes_done_before + bytes_copied
