"""P1.7 "Pack Project" PR 2 — atomic staging + verified source copying.

## Scope

This module is the FIRST "Pack Project" module that touches a filesystem
for real (PR 1's ``manifest.py`` only computes a plan). It copies every
``packable`` row of a dry-run manifest (:func:`quantized.portable.manifest
.build_dry_run_manifest`) into a freshly created, caller-owned TEMPORARY
staging directory, verifying each copy byte-for-byte before recording it.
It never opens an original source file for anything but reading, never
creates/writes/renames/deletes anything under an original path, and never
publishes the staging directory into the final bundle location — that is
PR 3's job (an ``os.replace``/rename of this directory, once every source
in it has been verified, onto the sibling filesystem this module
deliberately stages on).

## Why the staging dir is a SIBLING of the eventual bundle

:func:`create_staging_dir` always creates its temp directory INSIDE the
caller-supplied ``parent_dir`` (via ``tempfile.mkdtemp(dir=parent_dir)``),
never in a system temp location. PR 3 needs to rename/replace this
directory into its final bundle location atomically, which is only
possible when both live on the same filesystem — an ``os.replace`` across
filesystems is not atomic (and on POSIX, not even always possible). Making
the caller choose ``parent_dir`` as the eventual bundle's own parent
directory is what guarantees that.

## Failure model: all-or-nothing

:func:`stage_sources` copies packable rows IN MANIFEST ORDER and stops at
the very first problem of any kind (a changed/vanished source, a full
disk, a cancellation, ...). It never skips a bad file and continues with
the rest — a staging directory that is missing even one packable source
must never become publishable, so any failure (see :class:`StageError`'s
``code`` for the closed set of reasons) removes the partial destination
file if one was created, then deletes the ENTIRE staging directory via
:func:`cleanup_staging_dir` (which is always safe to call — see its own
docstring) and reports ``ok=False``. On success the staging directory is
left exactly as PR 3 needs it and ownership passes to the caller.

## originals_modified is always False

Every original path this module touches is opened with ``open(path,
"rb")`` — strictly read-only — and nothing is ever created, written,
renamed, or deleted under an original path. :class:`StageResult` carries
``originals_modified`` explicitly (always ``False``) so every caller that
reports a staging outcome states this guarantee in one place rather than
inferring it, and so a future change that ever DOES need to touch an
original path (there is no such plan) cannot silently drop the promise
without also flipping a field every consumer already reads.

## Verified copy pipeline (per file, see :func:`_stage_one_file`)

Re-probe -> compare against the manifest's recorded provenance -> stream
copy while hashing -> re-stat the source post-copy -> compare the fresh
probe's checksum (when it has one) against the computed hash -> re-read
the WRITTEN file and hash it a second time. Any disagreement anywhere in
that chain is a distinct :class:`StageError` code (see the class doc) —
never a generic failure — so a caller/UI can explain precisely what
changed. No file is ever fully read into memory: every read and write
moves at most ``chunk_bytes`` at a time.

## Cancellation

``should_cancel`` is polled cooperatively before each file and again
between every chunk of the file currently being copied, so a cancel
during a large copy leaves no partial file on disk (the same cleanup path
as any other failure runs).
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from quantized.desktop_source_probe import _CHECKSUM_CHUNK_BYTES

# `StageProgress`/`StagedFile`/`StageError` are DEFINED in `.copying` (the
# module that actually constructs them, one layer down, alongside the
# per-file copy logic) and re-exported here as this package's public
# surface -- keeping them there avoids a circular import (`.copying` needs
# them; `stage_sources` here only ever passes them through).
from .copying import (
    Probe,
    ProgressCallback,
    ShouldCancel,
    StagedFile,
    StageError,
    StageProgress,
    stage_one_file,
)
from .layout import BUNDLE_FORMAT, SUPPORTED_MANIFEST_VERSIONS, is_bundle_relative, path_key

__all__ = [
    "STAGING_PREFIX",
    "StageProgress",
    "StagedFile",
    "StageError",
    "StageResult",
    "create_staging_dir",
    "cleanup_staging_dir",
    "stage_sources",
]

# Marks a directory as one this module created and therefore may delete.
# `cleanup_staging_dir` refuses to touch anything whose basename does not
# start with this prefix -- a fixed, deliberately unusual prefix (leading
# dot + a project-specific tag) makes an accidental collision with a
# user-created directory implausible.
STAGING_PREFIX = ".qz-pack-"


@dataclass(slots=True)
class StageResult:
    """The outcome of one :func:`stage_sources` call.

    ``cleanup_ok`` is ``None`` exactly when no cleanup was attempted --
    i.e. ``ok=True`` -- because the caller (PR 3) owns the staging
    directory from that point on and must not have it deleted out from
    under it. On any failure ``cleanup_ok`` is always a concrete bool.
    """

    ok: bool
    cancelled: bool
    staging_root: str | None
    staged: list[StagedFile]
    errors: list[StageError]
    cleanup_ok: bool | None
    bytes_copied: int
    originals_modified: bool


def create_staging_dir(parent_dir: str) -> str:
    """Create a fresh, empty staging directory as a SIBLING entry inside
    ``parent_dir`` (see the module doc for why it must be a sibling of the
    eventual bundle rather than a system temp directory).

    Raises ``ValueError`` when ``parent_dir`` is not an existing real
    directory.
    """
    if not os.path.isdir(os.path.realpath(parent_dir)):
        raise ValueError(f"parent_dir is not an existing directory: {parent_dir!r}")
    return tempfile.mkdtemp(prefix=STAGING_PREFIX, dir=parent_dir)


def cleanup_staging_dir(staging_root: str) -> bool:
    """Remove ``staging_root`` and everything under it -- ONLY if it looks
    like a directory this module created.

    Refuses (returns ``False``, touches nothing) unless
    ``os.path.basename`` of its realpath starts with :data:`STAGING_PREFIX`
    and that realpath is actually a directory. Walks bottom-up
    (``os.walk(topdown=False)``) removing entries itself rather than
    calling ``shutil.rmtree`` so a symlinked subdirectory is never
    followed: its own directory entry is unlinked (not descended into),
    leaving whatever it points at completely untouched.

    Never raises -- any unexpected OS error part-way through is reported
    as ``False`` (the directory may be left partially cleaned; callers
    that need a hard guarantee should treat ``False`` as "still there,
    handle it").
    """
    try:
        real_root = os.path.realpath(staging_root)
        if not os.path.basename(real_root).startswith(STAGING_PREFIX):
            return False
        if not os.path.isdir(real_root):
            return False
        for dirpath, dirnames, filenames in os.walk(real_root, topdown=False, followlinks=False):
            for name in filenames:
                os.remove(os.path.join(dirpath, name))
            for name in dirnames:
                child = os.path.join(dirpath, name)
                if os.path.islink(child):
                    os.remove(child)  # unlink the link itself; never descend
                else:
                    os.rmdir(child)
        os.rmdir(real_root)
        return True
    except OSError:
        return False


def _fail(staging_root: str, error: StageError) -> StageResult:
    cleanup_ok = cleanup_staging_dir(staging_root)
    return StageResult(
        ok=False,
        cancelled=False,
        staging_root=None if cleanup_ok else staging_root,
        staged=[],
        errors=[error],
        cleanup_ok=cleanup_ok,
        bytes_copied=0,
        originals_modified=False,
    )


def stage_sources(
    manifest: Mapping[str, Any],
    staging_root: str,
    *,
    probe: Probe,
    progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    chunk_bytes: int = _CHECKSUM_CHUNK_BYTES,
) -> StageResult:
    """Copy every ``packable`` row of ``manifest`` into ``staging_root``,
    verifying each copy. See the module docstring for the full failure
    model, cancellation contract, and the ``originals_modified`` guarantee.

    Behaviour, in order:

    1. Validate ``manifest["format"]``/``["manifest_version"]`` (else
       ``invalid_manifest``). Validate ``staging_root``: an existing
       directory (else ``invalid_manifest`` -- a caller/usage error, not a
       trust boundary) whose basename carries :data:`STAGING_PREFIX` (else
       ``escape_rejected`` -- a real directory that exists but is not one
       this module owns, so it is refused rather than emptied).
    2. Select ``packable is True`` rows in manifest order (already
       deterministic per PR 1). Assert no two selected rows resolve to the
       same :func:`quantized.portable.layout.path_key` of their
       ``bundle_path`` and that every ``bundle_path`` is itself
       bundle-relative (else ``invalid_manifest`` -- PR 1 already
       guarantees both, this is defense-in-depth, not a real code path).
    3. Copy rows one at a time (:func:`quantized.portable.copying
       .stage_one_file` does the actual verified per-file work); stop at
       the first error or cancellation.
    4. On success: ``ok=True``, ``staging_root`` retained for the caller
       (PR 3) to publish, ``cleanup_ok=None`` (nothing was cleaned up).
    5. On any failure: remove the partial destination file (done inside
       the per-file copy itself) then delete the WHOLE staging directory
       via :func:`cleanup_staging_dir` -- a staging dir missing even one
       packable source must never be publishable -- and report
       ``ok=False`` with exactly one error (the failing file's, or a
       single ``cancelled`` entry).

    Memory: never reads or holds a whole file -- everything moves through
    ``chunk_bytes``-sized buffers. Progress ``bytes_total`` is the sum of
    every selected row's manifest ``size`` (unknown sizes count as 0 --
    packable rows always carry a size in practice, since PR 1 only
    populates ``size`` for ``status == "ok"``, but this stays defensive).
    """
    fmt = manifest.get("format")
    version = manifest.get("manifest_version")
    if fmt != BUNDLE_FORMAT or version not in SUPPORTED_MANIFEST_VERSIONS:
        return _fail(
            staging_root,
            StageError(None, None, "invalid_manifest", "unsupported manifest format or version"),
        )

    real_root = os.path.realpath(staging_root)
    if not os.path.isdir(real_root):
        return _fail(
            staging_root,
            StageError(None, None, "invalid_manifest", "staging_root is not an existing directory"),
        )
    if not os.path.basename(real_root).startswith(STAGING_PREFIX):
        return _fail(
            staging_root,
            StageError(
                None, None, "escape_rejected", "staging_root does not carry the staging prefix"
            ),
        )

    sources_raw = manifest.get("sources")
    sources = sources_raw if isinstance(sources_raw, list) else []
    selected = [row for row in sources if isinstance(row, dict) and row.get("packable") is True]

    seen: dict[str, str | None] = {}
    for row in selected:
        bundle_path = row.get("bundle_path")
        if not isinstance(bundle_path, str) or not is_bundle_relative(bundle_path):
            return _fail(
                staging_root,
                StageError(
                    row.get("source_id"),
                    bundle_path if isinstance(bundle_path, str) else None,
                    "invalid_manifest",
                    "packable source row has an invalid bundle_path",
                ),
            )
        key = path_key(bundle_path)
        if key in seen:
            return _fail(
                staging_root,
                StageError(
                    row.get("source_id"),
                    bundle_path,
                    "invalid_manifest",
                    "two packable sources share one bundle destination",
                ),
            )
        seen[key] = row.get("source_id")

    bytes_total = sum(int(row.get("size") or 0) for row in selected)

    staged: list[StagedFile] = []
    bytes_done = 0
    error: StageError | None = None
    for index, row in enumerate(selected, start=1):
        if should_cancel is not None and should_cancel():
            error = StageError(
                row.get("source_id"),
                row.get("bundle_path"),
                "cancelled",
                "staging cancelled before this source was copied",
            )
            break
        outcome = stage_one_file(
            row,
            staging_root,
            probe=probe,
            progress=progress,
            should_cancel=should_cancel,
            chunk_bytes=chunk_bytes,
            file_index=index,
            file_count=len(selected),
            bytes_total=bytes_total,
            bytes_done_before=bytes_done,
        )
        if isinstance(outcome, StageError):
            error = outcome
            break
        staged_file, bytes_done = outcome
        staged.append(staged_file)

    if error is not None:
        cleanup_ok = cleanup_staging_dir(staging_root)
        return StageResult(
            ok=False,
            cancelled=error.code == "cancelled",
            staging_root=None if cleanup_ok else staging_root,
            staged=staged,
            errors=[error],
            cleanup_ok=cleanup_ok,
            bytes_copied=bytes_done,
            originals_modified=False,
        )

    return StageResult(
        ok=True,
        cancelled=False,
        staging_root=staging_root,
        staged=staged,
        errors=[],
        cleanup_ok=None,
        bytes_copied=bytes_done,
        originals_modified=False,
    )
