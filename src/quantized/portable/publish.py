"""P1.7 "Pack Project" PR 3 — atomic bundle publication and validation.

## The publish contract

A bundle only ever comes into existence at its final destination through
ONE atomic ``os.rename`` of a fully-written STAGING directory
(:mod:`quantized.portable.staging`'s ``create_staging_dir``/``stage_sources``
have already copied and verified every packable source into it by the time
this module runs). Nothing here ever writes directly at the destination,
and nothing here ever partially publishes: :func:`publish_bundle` either
renames a complete tree into place in one syscall, or leaves the
destination completely absent and cleans the staging directory up.

**Why a sibling staging dir makes the safe fallback trivial.**
:func:`quantized.portable.staging.create_staging_dir` always stages inside
the destination's OWN parent directory, so ``os.rename``/``os.replace``
between them is same-filesystem by construction — the one failure mode
that would otherwise force a "fall back to copy-tree" branch (cross-device
rename, ``EXDEV``) cannot happen here. That leaves only permission/race
errors as realistic ``OSError`` causes, and refusing (never partially
copying, never silently retrying with a different strategy) is the safe
answer to those: an incomplete package must never be represented as a
success, and copy-then-delete would itself be a second, non-atomic
publish attempt with its own half-finished failure mode. So the
documented fallback on ANY ``os.rename`` failure is simply: clean up the
staging directory and report ``publish_failed`` — never copy-tree, never
partial-publish.

**The manifest is the completion marker, written LAST.**
:func:`write_bundle_files` writes the packed project file first, then
``quantized-bundle.json`` — deliberately last — so a crash between the two
writes leaves a staging directory with no manifest at all, which
:func:`validate_bundle` (and :func:`publish_bundle`'s own
``incomplete_staging`` check) can recognize and refuse to publish, rather
than a bundle that LOOKS complete but is missing its project file.

## Atomic single-file writes

:func:`atomic_replace_file` is the ONE atomic single-file write sequence
this module and :mod:`quantized.desktop_bridge`'s ``write_project_file``
both use (extracted here so neither duplicates it): ``tempfile.mkstemp`` in
the destination's own directory, write, ``flush`` + ``fsync``, then
``os.replace`` onto the final name, then a best-effort directory ``fsync``.
A failure at any step removes the partial temp file; nothing is ever left
half-written at the destination name itself.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from quantized.desktop_project_file import WRITE_TEMP_PREFIX

from .copy_stream import safe_os_error
from .copying import StagedFile
from .layout import (
    BUNDLE_FORMAT,
    MANIFEST_FILENAME,
    SUPPORTED_MANIFEST_VERSIONS,
    is_bundle_relative,
    join_bundle_path,
    sanitize_component,
)
from .manifest import manifest_json
from .staging import cleanup_staging_dir

__all__ = [
    "PublishResult",
    "BundleCheck",
    "atomic_replace_file",
    "finalize_manifest",
    "write_bundle_files",
    "publish_bundle",
    "validate_bundle",
]

_CHECKSUM_CHUNK_BYTES = 1024 * 1024


def _fsync_directory_best_effort(directory: str) -> None:
    """Best-effort ``fsync`` of ``directory`` after an ``os.replace`` lands
    a new file — POSIX only; there is no directory file descriptor to open
    on Windows, and NFS/some filesystems reject it regardless. Swallowed on
    purpose: the file's own ``fsync`` (before the replace, in
    :func:`atomic_replace_file`) is what makes the *content*
    durable-ordered — this only narrows the window in which the rename
    itself could still be lost to a crash, and a write must never be
    reported as failed over a step that is inherently unsupported on part
    of the fleet."""
    try:
        fd = os.open(directory, os.O_RDONLY)
    except (OSError, AttributeError):
        return
    try:
        os.fsync(fd)
    except (OSError, AttributeError):
        pass
    finally:
        os.close(fd)


def atomic_replace_file(directory: str, dest_path: str, content: str, *, temp_prefix: str) -> None:
    """Write ``content`` (str, UTF-8) to ``dest_path`` atomically: a temp
    file created with ``temp_prefix`` inside ``directory`` (which must be
    ``dest_path``'s own directory, so the final ``os.replace`` is a same-
    filesystem rename), flushed and ``fsync``ed before the replace, with a
    best-effort directory ``fsync`` after. On any failure the partial temp
    file is removed and the exception propagates — ``dest_path`` is left
    exactly as it was before this call."""
    tmp_path: str | None
    fd, tmp_path = tempfile.mkstemp(prefix=temp_prefix, dir=directory)
    try:
        # `newline="\n"`: on Windows, Python's default text-mode newline
        # translation would rewrite every "\n" the caller supplies to
        # "\r\n" on write, breaking the canonical (LF-only) manifest bytes
        # `manifest_json`/`_dumps` produce -- a bundle packed on Windows
        # would then fail a byte-exact re-serialization check on any
        # platform. Universal-newline translation is for TEXT a human
        # might edit with a platform-native editor; this is a machine-
        # written, machine-read JSON document, so it always gets exactly
        # the bytes it was given.
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, dest_path)
        tmp_path = None  # replaced -- nothing left to clean up
        _fsync_directory_best_effort(directory)
    finally:
        if tmp_path is not None:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def finalize_manifest(
    dry_run_manifest: Mapping[str, Any], staged: Sequence[StagedFile], *, packed_at: str
) -> dict[str, Any]:
    """The dry-run manifest, turned into the final published one: ``dry_run:
    False``, ``packed_at`` stamped (the ONE non-deterministic field —
    supplied by the caller so this stays unit-testable), each staged
    source row gains ``"packed": {"checksum", "bytes"}``, every other row
    gets ``"packed": null``, and ``summary["packed"]`` counts them."""
    manifest: dict[str, Any] = copy.deepcopy(dict(dry_run_manifest))
    manifest["dry_run"] = False
    manifest["packed_at"] = packed_at
    staged_by_bundle_path = {s.bundle_path: s for s in staged}
    sources_raw = manifest.get("sources")
    rows = sources_raw if isinstance(sources_raw, list) else []
    packed_count = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        bundle_path = row.get("bundle_path")
        staged_file = (
            staged_by_bundle_path.get(bundle_path) if isinstance(bundle_path, str) else None
        )
        if staged_file is not None:
            row["packed"] = {"checksum": staged_file.checksum, "bytes": staged_file.bytes}
            packed_count += 1
        else:
            row["packed"] = None
    summary = manifest.get("summary")
    if isinstance(summary, dict):
        summary["packed"] = packed_count
    else:
        manifest["summary"] = {"packed": packed_count}
    return manifest


def write_bundle_files(
    staging_root: str,
    *,
    project_file: str,
    packed_payload_json: str,
    manifest: Mapping[str, Any],
) -> None:
    """Write the packed project file, then — LAST, on purpose (see the
    module docstring) — ``quantized-bundle.json`` into ``staging_root``.
    Both writes go through :func:`atomic_replace_file`. Raises
    ``FileExistsError`` if either target name already exists in staging
    (staging is fresh and ours; this is a defensive assertion, never a
    real code path)."""
    project_path = os.path.join(staging_root, project_file)
    manifest_path = os.path.join(staging_root, MANIFEST_FILENAME)
    if os.path.lexists(project_path):
        raise FileExistsError(f"staging directory already has a project file: {project_file!r}")
    if os.path.lexists(manifest_path):
        raise FileExistsError(
            f"staging directory already has a manifest: {MANIFEST_FILENAME!r}"
        )
    atomic_replace_file(
        staging_root, project_path, packed_payload_json, temp_prefix=WRITE_TEMP_PREFIX
    )
    atomic_replace_file(
        staging_root, manifest_path, manifest_json(manifest), temp_prefix=WRITE_TEMP_PREFIX
    )


@dataclass(slots=True)
class PublishResult:
    """The outcome of one :func:`publish_bundle` call. ``cleanup_ok`` is a
    concrete bool whenever ``ok`` is ``False`` (a cleanup was always
    attempted on a refusal/failure) and ``None`` on success (the staging
    directory no longer exists — it WAS the published bundle)."""

    ok: bool
    bundle_dir: str | None
    error: dict[str, str] | None
    cleanup_ok: bool | None
    originals_modified: bool = False


def _refuse(staging_root: str, code: str, message: str) -> PublishResult:
    cleanup_ok = cleanup_staging_dir(staging_root)
    return PublishResult(
        ok=False,
        bundle_dir=None,
        error={"code": code, "message": message},
        cleanup_ok=cleanup_ok,
    )


def publish_bundle(staging_root: str, destination_dir: str) -> PublishResult:
    """Publish a fully-staged bundle by renaming ``staging_root`` onto
    ``destination_dir`` in ONE atomic ``os.rename`` — see the module
    docstring for the full rationale (sibling staging makes cross-device
    rename impossible by construction, so refuse-and-clean is the only
    safe fallback on any remaining ``OSError``).

    Refuses (staging cleaned, destination never touched) when:
      * ``destination_dir`` already exists (``destination_exists`` — this
        PR never overwrites);
      * ``destination_dir``'s parent is not the same directory
        ``staging_root`` lives in (``invalid_destination``);
      * ``staging_root`` has no completion marker yet
        (``incomplete_staging`` — see the module docstring's "manifest
        last" rule).

    On an ``OSError`` from ``os.rename`` itself (permission, a race — never
    ``EXDEV``, by construction): ``publish_failed``, staging cleaned,
    destination absent.
    """
    if os.path.lexists(destination_dir):
        return _refuse(staging_root, "destination_exists", "destination already exists")
    dest_parent = os.path.dirname(os.path.realpath(destination_dir))
    staging_parent = os.path.realpath(os.path.dirname(staging_root))
    if dest_parent != staging_parent:
        return _refuse(
            staging_root,
            "invalid_destination",
            "staging directory must be a sibling of the destination",
        )
    if not os.path.isfile(os.path.join(staging_root, MANIFEST_FILENAME)):
        return _refuse(
            staging_root, "incomplete_staging", "staging directory has no completion marker"
        )
    # Audit finding (P1.7 PR 5): the `lexists` check above and `os.rename`
    # below are NOT one atomic operation -- on POSIX, `os.rename` onto an
    # existing EMPTY directory silently succeeds and replaces it (unlike a
    # non-empty one, which raises `ENOTEMPTY`). A directory created in the
    # split second between the check and the rename (another process, a
    # concurrent pack run racing for the same path, a user's own `mkdir`)
    # would otherwise be silently absorbed -- contradicting this function's
    # own "never overwrites" contract for the specific case of an empty
    # directory. `os.mkdir` is a genuine atomic existence check (it raises
    # `FileExistsError` for ANY pre-existing entry at that path, file or
    # directory, empty or not) where a second `lexists` call would not be,
    # so it is used here as a reservation: once it succeeds, nothing else
    # can have raced ahead of it, and the immediately-following `os.rename`
    # (replacing our own just-created empty directory) closes the window to
    # the two syscalls between them -- as tight as pure Python's `os` module
    # permits without a platform-specific syscall. On Windows this is a
    # no-op hardening: `os.rename` there already refuses outright whenever
    # `destination_dir` exists at all (file or directory, empty or not), so
    # the POSIX-only empty-directory race described above cannot occur on
    # that platform in the first place.
    try:
        os.mkdir(destination_dir)
    except FileExistsError:
        return _refuse(staging_root, "destination_exists", "destination already exists")
    except OSError as exc:
        return _refuse(staging_root, "publish_failed", safe_os_error(exc))
    try:
        os.rename(staging_root, destination_dir)
    except OSError as exc:
        # Undo our own reservation so a failed publish truly leaves the
        # destination completely absent, matching the module doc's promise
        # -- best-effort: if this itself fails there is nothing further to
        # do that would not risk deleting something a third party legitimately
        # created there since.
        try:
            os.rmdir(destination_dir)
        except OSError:
            pass
        # `safe_os_error`, never `str(exc)`: an `OSError` from `os.rename`
        # carries BOTH `filename` and `filename2` -- the absolute staging
        # and destination paths -- and this result is structured, possibly
        # logged, output (review finding, PR #307).
        return _refuse(staging_root, "publish_failed", safe_os_error(exc))
    return PublishResult(ok=True, bundle_dir=destination_dir, error=None, cleanup_ok=None)


@dataclass(slots=True)
class BundleCheck:
    """The outcome of :func:`validate_bundle`. ``manifest`` is the parsed
    manifest dict when it could be read at all (even an unsupported-version
    or otherwise incomplete one — "for display only"), ``None`` only when
    the manifest file itself is missing or unreadable."""

    complete: bool
    manifest: dict[str, Any] | None
    problems: list[dict[str, str]]


def _is_valid_bundle_filename(name: str) -> bool:
    """Is ``name`` safe to join onto ``bundle_dir`` as the packed project
    file? Must be a SINGLE path component — no ``/`` or ``\\`` (a manifest
    is untrusted input; a hand-edited or malicious
    ``manifest["project"]["project_file"]`` of ``"/etc/passwd"`` or
    ``"../../x.dwk"`` must never be joined onto ``bundle_dir`` and reported
    ``complete=True``, nor a missing OUTSIDE path echoed back in
    ``project_file_missing``'s detail) — not ``"."``/``".."``, already a
    portable name in :func:`quantized.portable.layout.sanitize_component`'s
    own sense (rejects illegal characters, a reserved device name, a
    trailing dot/space, or an over-long name), and ending in ``.dwk``
    (case-insensitive)."""
    if "/" in name or "\\" in name:
        return False
    if name in (".", ".."):
        return False
    if sanitize_component(name) != (name, None):
        return False
    return name.lower().endswith(".dwk")


def _hash_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(_CHECKSUM_CHUNK_BYTES)
            if not chunk:
                break
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def validate_bundle(bundle_dir: str, *, verify_checksums: bool = False) -> BundleCheck:
    """Is ``bundle_dir`` a complete, openable portable bundle? Never
    raises. ``problems`` entries never carry an absolute path — only
    bundle-relative names or manifest field values, so this is safe to
    surface straight to a UI or log line.

    A ``manifest_missing``/``manifest_invalid``/``not_a_bundle``/
    ``unsupported_manifest_version`` finding is terminal (returned
    immediately, since nothing further can be checked meaningfully);
    every other finding (``incomplete``, ``project_file_missing``,
    ``project_file_invalid``, ``escape_rejected``, ``source_missing``,
    ``source_unreadable``, ``source_size_mismatch``,
    ``source_checksum_mismatch``) accumulates in ``problems`` so a caller
    sees the whole picture at once. ``complete`` is ``True`` only when
    ``problems`` is empty."""
    manifest_path = os.path.join(bundle_dir, MANIFEST_FILENAME)
    if not os.path.isfile(manifest_path):
        return BundleCheck(False, None, [{"code": "manifest_missing", "detail": MANIFEST_FILENAME}])
    try:
        with open(manifest_path, encoding="utf-8") as f:
            raw = f.read()
        manifest = json.loads(raw)
    except OSError as exc:
        # `safe_os_error`, never `str(exc)`: a permission/I-O error opening
        # or reading the manifest embeds `exc.filename` -- the absolute
        # bundle-relative-in-name-only path this function's own docstring
        # promises never to leak (review finding, PR #307).
        return BundleCheck(
            False, None, [{"code": "manifest_invalid", "detail": safe_os_error(exc)}]
        )
    except ValueError as exc:
        # `json.JSONDecodeError` (a `ValueError`) message is a line/column
        # position and a snippet of the malformed JSON text itself -- never
        # a filesystem path -- so `str(exc)` is safe here.
        return BundleCheck(False, None, [{"code": "manifest_invalid", "detail": str(exc)}])
    if not isinstance(manifest, dict):
        return BundleCheck(
            False, None, [{"code": "manifest_invalid", "detail": "manifest is not a JSON object"}]
        )
    if manifest.get("format") != BUNDLE_FORMAT:
        return BundleCheck(
            False, manifest, [{"code": "not_a_bundle", "detail": "unexpected manifest format"}]
        )
    version = manifest.get("manifest_version")
    if version not in SUPPORTED_MANIFEST_VERSIONS:
        return BundleCheck(
            False,
            manifest,
            [{"code": "unsupported_manifest_version", "detail": str(version)}],
        )

    problems: list[dict[str, str]] = []
    if manifest.get("dry_run") is not False:
        problems.append({"code": "incomplete", "detail": "manifest is still a dry-run plan"})

    project = manifest.get("project")
    project_file = project.get("project_file") if isinstance(project, dict) else None
    if isinstance(project_file, str):
        if not _is_valid_bundle_filename(project_file):
            # Never echo the value that failed the check -- it may be an
            # absolute path or a traversal outside the bundle.
            problems.append({"code": "project_file_invalid", "detail": "<invalid>"})
        elif not os.path.isfile(os.path.join(bundle_dir, project_file)):
            problems.append({"code": "project_file_missing", "detail": project_file})
    else:
        problems.append({"code": "project_file_missing", "detail": "<unnamed>"})

    sources_raw = manifest.get("sources")
    for row in sources_raw if isinstance(sources_raw, list) else []:
        if not isinstance(row, dict):
            continue
        packed = row.get("packed")
        if not isinstance(packed, dict):
            continue  # not staged this run -- nothing on disk to verify
        bundle_path = row.get("bundle_path")
        if not isinstance(bundle_path, str) or not is_bundle_relative(bundle_path):
            detail = bundle_path if isinstance(bundle_path, str) else "<invalid>"
            problems.append({"code": "escape_rejected", "detail": detail})
            continue
        try:
            real_path = join_bundle_path(bundle_dir, bundle_path)
        except ValueError:
            problems.append({"code": "escape_rejected", "detail": bundle_path})
            continue
        if not os.path.isfile(real_path):
            problems.append({"code": "source_missing", "detail": bundle_path})
            continue
        # "Never raises" (the docstring's promise) covers this whole block:
        # a `NaN`/non-finite `"bytes"` value makes `int(expected_bytes)`
        # raise `ValueError`, and `os.path.getsize`/`_hash_file` can raise
        # `OSError` on a race (removed between the `isfile` check above and
        # here) or a permission/I-O error reading the file's bytes for the
        # checksum -- either way this is a real, reportable problem
        # (`source_unreadable`), never an uncaught exception.
        try:
            expected_bytes = packed.get("bytes")
            actual_bytes = os.path.getsize(real_path)
            if isinstance(expected_bytes, (int, float)) and int(expected_bytes) != actual_bytes:
                problems.append({"code": "source_size_mismatch", "detail": bundle_path})
                continue
            if verify_checksums:
                expected_checksum = packed.get("checksum")
                if isinstance(expected_checksum, str) and expected_checksum:
                    if _hash_file(real_path) != expected_checksum:
                        problems.append(
                            {"code": "source_checksum_mismatch", "detail": bundle_path}
                        )
        except (OSError, ValueError):
            problems.append({"code": "source_unreadable", "detail": bundle_path})

    return BundleCheck(complete=not problems, manifest=manifest, problems=problems)
