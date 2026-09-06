"""P1.7 "Pack Project" PR 2 — the verified, single-source copy step.

Split out of :mod:`quantized.portable.staging` purely to stay under the
repo's 500-line god-module ceiling: :func:`stage_one_file` below is the
one function that actually touches a source file's bytes, and it earns
its own module. See ``staging.py``'s module docstring for the whole
staging pipeline's contract (failure model, cancellation, the
``originals_modified`` guarantee); this module has no policy of its own
beyond what one file's verified copy requires. The shared result/error
types and the actual chunked read-hash-write loop live one layer further
down, in :mod:`quantized.portable.copy_stream` (split out for the same
500-line reason) and are re-exported here as part of this module's public
surface.

## The ten-step verified copy (mirrors ``staging.py``'s per-file ruling)

1. Re-probe the original path RIGHT NOW (never trust the manifest's
   snapshot) -- anything but ``state == "ok"`` is ``read_failed``.
2. Compare the fresh probe's size/mtime/checksum against whatever the
   manifest recorded for each field BOTH sides have -- any disagreement is
   ``changed_since_preview`` (the file changed between the dry-run preview
   and this copy, before a single byte was touched).
3. Compute the destination path and confirm its parent directory resolves
   (symlink-aware, via ``os.path.realpath`` + ``os.path.commonpath``)
   inside the staging root -- otherwise ``escape_rejected``.
4. Reject a destination that is already a symlink (portably, before ever
   calling ``os.open`` -- see the inline comment at that check), then open
   the destination with ``O_CREAT | O_EXCL | O_NOFOLLOW`` -- it must not
   already exist -- otherwise ``destination_exists``.
5. Open the source strictly ``"rb"``, fstat it, and confirm that size
   matches the fresh probe -- otherwise ``changed_during_copy``. Also
   compare this fstat's IDENTITY (``os.fstat``'s ``st_dev``/``st_ino``,
   see :func:`quantized.portable.copy_stream.file_identity`) against the
   fresh probe's, when the probe supplies one -- a separate signal from
   the size comparison, catching a replace between the step-1 probe and
   this ``open`` even when sizes happen to match; also ``changed_during_copy``.
6. Stream ``chunk_bytes`` at a time, hashing and writing each chunk,
   polling ``should_cancel`` between chunks; a short/long read against the
   pre-copy fstat size is ``changed_during_copy``; a write failure (a full
   disk, say) is ``write_failed``.
7. fsync + close the destination, then re-stat the SOURCE -- any
   size/mtime drift since step 5's fstat is ``changed_during_copy`` (the
   file was edited while being copied). Also compare this re-stat's
   IDENTITY against step 5's pre-copy fstat identity (review finding on
   #306) -- catches the pathname being atomically replaced (``os.replace``)
   mid-copy by a different, same-size file whose mtime was then restored to
   match: invisible to the size/mtime comparison, and, for a checksum-less
   (legacy/unverified, explicitly packable) source, invisible to steps 8-9
   too, since there is no checksum to compare against. When either side's
   identity is unknown (a platform/filesystem that leaves ``st_dev``/
   ``st_ino`` as ``0`` -- see :func:`quantized.portable.copy_stream
   .identity_changed`), this check never fires and size/mtime remain the
   only guard, as they were before this check existed.
8. The MANIFEST's recorded checksum (``row["checksum"]``, taken at dry-run
   preview time), when it is a non-empty string, must equal the hash
   computed while streaming -- otherwise ``changed_since_preview``. This is
   the check that catches a same-length, same-mtime rewrite that a
   ``compute_checksum=False`` probe's size/mtime-only re-probe (step 2)
   cannot see: without it, a rewritten file whose mtime was restored to its
   original value would sail through as an unmodified source.
9. The FRESH PROBE's own checksum (when the probe computed one), a
   completely separate signal from step 8, must also equal the hash
   computed while streaming -- otherwise ``checksum_mismatch``. Because
   step 8 already gives ``stage_sources`` a full content check against the
   manifest, callers SHOULD pass a probe with ``compute_checksum=False`` to
   ``stage_sources`` (see its docstring) -- this step then simply never
   fires (no probed checksum to compare), and every source is read once
   during streaming instead of twice.
10. Re-read the WRITTEN file from disk and hash it a second time -- it must
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
from collections.abc import Mapping
from typing import Any, Literal

from .copy_stream import (
    ErrorCode,
    Probe,
    ProgressCallback,
    ShouldCancel,
    StagedFile,
    StageError,
    StageProgress,
    coerce_size,
    copy_stream,
    file_identity,
    identity_changed,
    remove_partial,
    safe_os_error,
)
from .layout import join_bundle_path

__all__ = [
    "Probe",
    "ProgressCallback",
    "ShouldCancel",
    "ErrorCode",
    "StageProgress",
    "StagedFile",
    "StageError",
    "coerce_size",
    "stage_one_file",
]


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
    ten-step pipeline. Returns ``(StagedFile, new_bytes_done)`` on success,
    a :class:`StageError` otherwise for every failure mode that pipeline
    enumerates. Not exception-free, though: ``row`` is trusted to carry
    ``source_id``/``bundle_path``/``original_path`` (a missing key raises
    ``KeyError``), and ``os.makedirs`` on step 3's destination parent can
    raise (e.g. a regular file already occupying that path) -- callers
    (:func:`quantized.portable.staging.stage_sources`) are the ones that
    catch and translate those into a structured failure plus a cleaned-up
    staging directory (review finding #2)."""
    source_id = row["source_id"]
    bundle_path = row["bundle_path"]
    original_path = row["original_path"]
    file_bytes_total = coerce_size(row.get("size"))

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
    # `os.path.islink` is checked FIRST, portably (review finding #4):
    # `O_NOFOLLOW` (below) does not stop `O_CREAT | O_EXCL` from following a
    # DANGLING symlink on Windows, where it would silently create the file
    # at the link's target instead of refusing -- `islink` catches a
    # dangling or live symlink at `dest` on every platform, before `os.open`
    # ever runs. `O_NOFOLLOW` is kept too, where available, as defense in
    # depth against a symlink planted in the TOCTOU window between the two.
    if os.path.islink(dest):
        return StageError(
            source_id, bundle_path, "destination_exists", "destination already exists in staging"
        )
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
            source_id,
            bundle_path,
            "write_failed",
            f"could not create destination: {safe_os_error(exc)}",
        )

    # 5. open the source read-only and confirm its size against the probe.
    try:
        src = open(original_path, "rb")
    except OSError as exc:
        os.close(fd)
        remove_partial(dest)
        return StageError(
            source_id, bundle_path, "read_failed", f"could not open source: {safe_os_error(exc)}"
        )

    with src:
        try:
            pre_stat = os.fstat(src.fileno())
        except OSError as exc:
            os.close(fd)
            remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "read_failed",
                f"could not stat source: {safe_os_error(exc)}",
            )
        if probed_size is not None and pre_stat.st_size != probed_size:
            os.close(fd)
            remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "changed_during_copy",
                "source size differs from its pre-copy probe",
            )
        pre_identity = file_identity(pre_stat)

        # 5b. when the fresh probe itself carries an identity (`dev`/`ino`
        # -- optional, not every `Probe` populates them), compare it against
        # this open descriptor's own fstat identity too: a separate signal
        # from the size check just above, catching a replace that happened
        # between the probe call (step 1) and this `open` (step 5) even when
        # the replacement's size happens to match.
        probed_dev = probed.get("dev")
        probed_ino = probed.get("ino")
        if (
            isinstance(probed_dev, int)
            and isinstance(probed_ino, int)
            and identity_changed(pre_identity, (probed_dev, probed_ino))
        ):
            os.close(fd)
            remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "changed_during_copy",
                "source identity differs from its pre-copy probe",
            )

        # 6. stream + hash.
        outcome = copy_stream(
            fd,
            src,
            chunk_bytes=chunk_bytes,
            should_cancel=should_cancel,
            source_id=source_id,
            bundle_path=bundle_path,
            emit=lambda done: emit("copying", done),
        )
        if isinstance(outcome, StageError):
            remove_partial(dest)
            return outcome
        bytes_copied, digest_hex = outcome
        if bytes_copied != pre_stat.st_size:
            remove_partial(dest)
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
            remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "read_failed",
                f"could not re-stat source: {safe_os_error(exc)}",
            )
        if post_stat.st_size != pre_stat.st_size or post_stat.st_mtime != pre_stat.st_mtime:
            remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "changed_during_copy",
                "source was modified while being copied",
            )

        # 7b. identity (review finding on #306): a same-size rewrite with
        # its mtime restored to match is invisible to the size/mtime check
        # just above -- and, for a checksum-less (legacy/unverified) source,
        # there is no manifest checksum (step 8) to fall back on either, so
        # the open descriptor still streamed the OLD file's bytes while the
        # pathname now names a different one. Comparing the pre-copy fstat
        # identity (captured before a single byte was read) against this
        # post-copy stat of the pathname is what catches that. See
        # `identity_changed`'s docstring for the documented "unknown
        # identity" fallback this deliberately never raises a false
        # failure on.
        if identity_changed(pre_identity, file_identity(post_stat)):
            remove_partial(dest)
            return StageError(
                source_id,
                bundle_path,
                "changed_during_copy",
                "source identity changed while being copied",
            )

    emit("verifying", bytes_copied)

    computed_checksum = f"sha256:{digest_hex}"

    # 8. checksum agreement with the MANIFEST's recorded provenance (review
    # finding #1). This is the check that actually verifies content against
    # what the dry-run preview recorded -- step 2 above only compared the
    # FRESH PROBE's checksum (which a `compute_checksum=False` probe never
    # even supplies) against the manifest's, so without this a same-length
    # rewrite with its mtime restored would sail through undetected all the
    # way to a "successfully staged" result.
    manifest_checksum = row.get("checksum")
    if (
        isinstance(manifest_checksum, str)
        and manifest_checksum
        and manifest_checksum != computed_checksum
    ):
        remove_partial(dest)
        return StageError(
            source_id,
            bundle_path,
            "changed_since_preview",
            "source checksum differs from the manifest's recorded checksum",
        )

    # 9. checksum agreement with the fresh probe (when it has one) -- a
    # SEPARATE signal from step 8's manifest checksum. See the module
    # docstring: passing a `compute_checksum=False` probe to `stage_sources`
    # skips this check entirely (there is no probed checksum to compare),
    # relying on step 8 alone for content verification and reading every
    # source only once.
    if probed_checksum and probed_checksum != computed_checksum:
        remove_partial(dest)
        return StageError(
            source_id,
            bundle_path,
            "checksum_mismatch",
            "computed checksum does not match the probed checksum",
        )

    # 10. re-read the WRITTEN file and hash it again.
    try:
        rehash = hashlib.sha256()
        with open(dest, "rb") as verify_f:
            while True:
                chunk = verify_f.read(chunk_bytes)
                if not chunk:
                    break
                rehash.update(chunk)
    except OSError as exc:
        remove_partial(dest)
        return StageError(
            source_id,
            bundle_path,
            "write_failed",
            f"could not re-read staged file: {safe_os_error(exc)}",
        )
    if rehash.hexdigest() != digest_hex:
        remove_partial(dest)
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
