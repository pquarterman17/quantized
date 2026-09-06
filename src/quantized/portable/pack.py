"""P1.7 "Pack Project" PR 3 — the pure orchestration entry point.

:func:`pack_project` wires PR 1's dry-run manifest, PR 2's verified staging
copy, and this PR's payload rewrite + atomic publish together into one
synchronous, callback-driven call. It touches no pywebview/bridge state of
its own — PR 4 wraps this in the bridge method and a cancellable job/state
machine; this stays pure orchestration so it is unit-testable exactly like
every other module in this package.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .copy_stream import safe_os_error
from .copying import ProgressCallback, ShouldCancel
from .grouping import Consented, Probe
from .manifest import build_dry_run_manifest
from .project_rewrite import rewrite_payload_for_bundle
from .publish import PublishResult, finalize_manifest, publish_bundle, write_bundle_files
from .staging import cleanup_staging_dir, create_staging_dir, stage_sources

__all__ = ["PackResult", "pack_project"]


@dataclass(slots=True)
class PackResult:
    """The outcome of one :func:`pack_project` call.

    ``manifest`` is whatever manifest this call got furthest with — the
    dry-run plan on an early failure (invalid project name, staging setup,
    or a staging failure), the finalized (``dry_run: False``) manifest once
    :func:`quantized.portable.publish.finalize_manifest` has run, even when
    a later step (the rewrite, the bundle-file writes, or the publish
    itself) still failed. ``errors`` is a list of ``{"code", "message"}``
    (plus, for a staging failure, ``"source_id"``/``"bundle_path"``)."""

    ok: bool
    cancelled: bool
    bundle_dir: str | None
    manifest: dict[str, Any] | None
    errors: list[dict[str, Any]] = field(default_factory=list)
    cleanup_ok: bool | None = None
    originals_modified: bool = False


def _error(code: str, message: str) -> dict[str, Any]:
    return {"code": code, "message": message}


def pack_project(
    payload: Mapping[str, Any],
    project_name: str,
    destination_dir: str,
    *,
    probe: Probe,
    consented: Consented | None = None,
    progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    packed_at: str,
) -> PackResult:
    """Pack ``payload`` as ``<project_name>.dwk`` into a fresh bundle
    directory at ``destination_dir``. Synchronous — a future job-queue
    wrapper (PR 4) is expected to run this on a worker thread and forward
    ``progress``/``should_cancel`` ticks.

    Pipeline: dry-run manifest -> staging dir (sibling of
    ``destination_dir``) -> verified copy of every packable source ->
    rewrite the payload's packed dataset sources to ``kind: "bundle"`` ->
    finalize the manifest -> write the bundle's project file and manifest
    -> one atomic publish rename. Any failure or cancellation at any step
    cleans up the staging directory (when one was created) and returns a
    structured, non-raising :class:`PackResult` — this function never lets
    an exception from a pure-computation step (a malformed project name,
    an unvalidatable rewritten payload) escape uncaught; only a genuine
    programming bug would.

    ``packed_at`` is threaded straight through to
    :func:`quantized.portable.publish.finalize_manifest` — the one
    non-deterministic field, supplied by the caller so this whole pipeline
    stays unit-testable end to end.
    """
    try:
        dry_run_manifest = build_dry_run_manifest(payload, project_name, probe, consented)
    except ValueError as exc:
        return PackResult(False, False, None, None, [_error("invalid_project_name", str(exc))])

    if os.path.lexists(destination_dir):
        # Checked BEFORE staging anything, at zero cost: `publish_bundle`'s
        # own `destination_exists` refusal (its own module doc's "never
        # overwrites" contract) still runs as a race-safe backstop right
        # before the final rename, but there is no reason to stage every
        # source into a temp directory -- copying and checksumming
        # potentially large files -- only to throw the whole staging tree
        # away on a check this cheap.
        return PackResult(
            False,
            False,
            None,
            dry_run_manifest,
            [_error("destination_exists", "destination already exists")],
        )

    parent_dir = os.path.dirname(os.path.normpath(destination_dir)) or "."
    try:
        staging_root = create_staging_dir(parent_dir)
    except ValueError as exc:
        return PackResult(
            False, False, None, dry_run_manifest, [_error("invalid_destination", str(exc))]
        )
    except OSError as exc:
        # `tempfile.mkdtemp` itself can raise OSError (a read-only parent,
        # a full disk, a permission error) -- `create_staging_dir` only
        # ever raises `ValueError` of its OWN accord (an invalid parent
        # path), so this is a genuinely different failure class. The
        # message is `strerror` only (never `str(exc)`, which for an
        # OSError includes the offending path) so a permission/disk error
        # never leaks the staging parent's filesystem layout into a
        # structured, potentially-logged result.
        message = exc.strerror or "staging directory could not be created"
        return PackResult(
            False, False, None, dry_run_manifest, [_error("staging_failed", message)]
        )

    stage_result = stage_sources(
        dry_run_manifest,
        staging_root,
        probe=probe,
        progress=progress,
        should_cancel=should_cancel,
    )
    if not stage_result.ok:
        errors = [
            {
                "code": e.code,
                "message": e.message,
                "source_id": e.source_id,
                "bundle_path": e.bundle_path,
            }
            for e in stage_result.errors
        ]
        return PackResult(
            ok=False,
            cancelled=stage_result.cancelled,
            bundle_dir=None,
            manifest=dry_run_manifest,
            errors=errors,
            cleanup_ok=stage_result.cleanup_ok,
        )

    try:
        rewritten_payload = rewrite_payload_for_bundle(
            payload, dry_run_manifest, stage_result.staged, staging_root=staging_root
        )
    except ValueError as exc:
        cleanup_ok = cleanup_staging_dir(staging_root)
        return PackResult(
            False,
            False,
            None,
            dry_run_manifest,
            [_error("rewrite_failed", str(exc))],
            cleanup_ok,
        )

    manifest = finalize_manifest(dry_run_manifest, stage_result.staged, packed_at=packed_at)
    project = manifest.get("project")
    project_file = project.get("project_file") if isinstance(project, dict) else None
    if not isinstance(project_file, str) or not project_file:
        cleanup_ok = cleanup_staging_dir(staging_root)
        return PackResult(
            False,
            False,
            None,
            manifest,
            [_error("invalid_manifest", "manifest has no project_file name")],
            cleanup_ok,
        )

    try:
        write_bundle_files(
            staging_root,
            project_file=project_file,
            packed_payload_json=_dumps(rewritten_payload),
            manifest=manifest,
        )
    except OSError as exc:
        # `safe_os_error`, never `str(exc)`: an `OSError` from writing the
        # bundle's project file or manifest embeds `exc.filename` -- the
        # absolute staging path -- and this result is structured, possibly
        # logged, output (review finding, PR #307).
        cleanup_ok = cleanup_staging_dir(staging_root)
        return PackResult(
            False, False, None, manifest, [_error("write_failed", safe_os_error(exc))], cleanup_ok
        )
    except (TypeError, ValueError) as exc:
        # `_dumps(rewritten_payload)` (this call, evaluated before
        # `write_bundle_files` itself runs) and `write_bundle_files`'s own
        # `manifest_json(manifest)` are both a `json.dumps` underneath --
        # a non-JSON-serializable value anywhere in the rewritten payload
        # (e.g. a stray `bytes` field) raises `TypeError`, not `OSError`,
        # and would otherwise escape this function entirely as an
        # uncaught exception instead of a structured `PackResult`.
        cleanup_ok = cleanup_staging_dir(staging_root)
        return PackResult(
            False, False, None, manifest, [_error("serialize_failed", str(exc))], cleanup_ok
        )

    publish_result: PublishResult = publish_bundle(staging_root, destination_dir)
    if not publish_result.ok:
        error = publish_result.error or _error("publish_failed", "publish failed")
        return PackResult(
            False, False, None, manifest, [error], publish_result.cleanup_ok
        )

    return PackResult(True, False, publish_result.bundle_dir, manifest, [], None, False)


def _dumps(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload)
