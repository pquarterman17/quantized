"""P1.7 "Pack Project" PR 4 — the pywebview bridge orchestrating PR 1-3's
pure pipeline (:mod:`quantized.portable.manifest`/``.staging``/``.publish``/
``.pack``) behind the six js_api methods below.

``DesktopPackBridge`` is a MIXIN added to ``DesktopApi``'s bases in
``desktop_bridge.py`` (one-line change), exactly the same "one object at
``window.pywebview.api``, several cohesive mixins" shape
``desktop_bridge_dialogs.DesktopDialogBridge`` already established — see
that module's own doc for the split rationale, unchanged here.

## The security boundary, method by method

Every method returns a plain dict, never raises into JS (a genuine
programming bug aside), and never puts an absolute filesystem path inside
an ``error``/``message`` string — only bundle-relative names, source ids,
or error codes, matching every other bridge method's "report, don't leak a
path into text" rule. The frontend's own argument list (a token, a
destination string, project JSON) is a REQUEST against this module's own
state, never an authority of its own — the same ruling
``desktop_bridge_dialogs.grant_source_paths`` already applies to its
caller-supplied path list.

- ``pick_pack_destination`` opens a native folder dialog and — the ONE
  consent-MINTING call in this module — grants a WRITE-DIRECTORY consent
  (``grant_write_dir``) for the chosen folder: the bundle is created
  INSIDE it. Clears every existing write-dir grant FIRST (a destination
  picked but never started must not accumulate — ``desktop_consent``'s doc).
- ``pack_preview`` requires that grant (``is_write_dir_consented``) before
  computing anything, then builds a dry-run manifest (PR 1) gated by
  ``_eligible`` — a path is eligible only when it is ALREADY read-consented
  (``is_consented``), covered by a read-only directory grant
  (``is_dir_consented``), or declared by the OPEN project's own payload
  (``is_declared_source``) — the same trust ``grant_source_paths`` already
  extends to a project's own declared sources, never the frontend's say-so
  alone. Nothing is granted here (``manifest.py``'s "grants nothing" rule);
  the actual read grant is minted only at ``pack_start``.
- ``pack_start`` re-verifies the caller against the STORED preview (token
  AND a fresh ``sha256`` of ``content`` — either mismatching is
  ``stale_preview``, never a silent re-plan against different data), mints
  real read consent for the eligible-but-not-yet-granted sources it is
  about to copy, remembers exactly which paths it minted, then spawns the
  copy/publish pipeline (``pack.pack_project``, PR 3's pure orchestration)
  on a daemon thread. Every outcome — success, failure, cancellation — the
  thread's own ``finally`` revokes EXACTLY those minted grants
  (``revoke_paths``) and clears the write-directory grant, so a pack
  operation's read/write footprint never outlives it.
- ``pack_status``/``pack_cancel``/``pack_reset`` touch no filesystem and
  mint/spend no consent — pure reads/mutations of this instance's own
  in-memory job record, one ``threading.Lock`` guarding every access.

**Why ``pack_start`` re-derives ``_eligible`` rather than trusting the
preview's ``packable`` flags verbatim.** Content is verified
byte-identical to preview (the ``sha256`` check), but consent is
process-global mutable state that can move between the two calls — a
declared-source set can be replaced by a project reopen, a directory grant
revoked by a relink panel closing. Passing the SAME predicate as
``consented=`` to ``pack_project`` (which rebuilds its own manifest from
the payload) means the real pack can never copy more than preview showed —
never widening "the manifest grants nothing" to "whatever was eligible a
moment ago still is".

**Progress/stage modeling.** ``pack_project`` only ever calls its progress
callback during PR 2's staged copy (``"copying"``/``"verifying"`` ticks) —
never for the rewrite/finalize/write/publish steps that follow inside the
same synchronous call. This module infers ``"publishing"`` the moment the
LAST source's ``"verifying"`` tick lands (or immediately, with nothing to
stage) — an honest approximation, not a tick ``pack_project`` itself emits.
"""

from __future__ import annotations

import hashlib
import os
import threading
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from quantized.desktop_consent import (
    clear_write_dir_grants,
    grant_paths,
    grant_write_dir,
    is_consented,
    is_declared_source,
    is_dir_consented,
    is_write_dir_consented,
    revoke_paths,
)
from quantized.desktop_project_file import parse_workspace_payload
from quantized.desktop_source_probe import probe_source_path
from quantized.portable.copy_stream import StageProgress
from quantized.portable.manifest import Consented, Probe, build_dry_run_manifest, manifest_json
from quantized.portable.pack import PackResult, pack_project

__all__ = ["DesktopPackBridge"]

# The exact sentence every terminal `pack_status` error carries — see this
# module's doc: a pack operation never touches an original file or the open
# project until its own atomic publish rename, so this is true for every
# failure/cancellation this module can ever report.
_NOTHING_MODIFIED_NOTE = "No original files or project were modified."

# pywebview's documented folder-dialog constant, resolved the same
# best-effort way `desktop_bridge_dialogs._dialog_kind` already does —
# duplicated here (rather than importing that module's underscore-prefixed
# helper) because it is a tiny, self-contained lookup and this module
# should not reach across a sibling's private surface for it.
_FOLDER_DIALOG_DEFAULT = 20


def _dialog_kind(name: str, fallback: int) -> int:
    try:
        import webview

        value = getattr(webview, name, fallback)
        return int(value) if isinstance(value, int) else fallback
    except ImportError:
        return fallback


def _resolve_or_none(path: str) -> str | None:
    try:
        return os.path.realpath(path)
    except (OSError, ValueError):
        return None


def _err(code: str, message: str) -> dict[str, Any]:
    """Shared shape for every synchronous rejection below — never carries
    ``originals_modified``/``note`` (those belong to ``pack_status``'s
    terminal ``errors`` list, see ``_error_row``): a rejection here means
    nothing ever started, so there is nothing to reassure the caller about."""
    return {"ok": False, "error": {"code": code, "message": message}}


def _eligible(path: str) -> bool:
    """A source path is eligible to be probed/packed when it is already
    read-consented, covered by a read-only directory grant, or declared by
    the currently open project's own payload — see this module's doc."""
    resolved = _resolve_or_none(path)
    if resolved is None:
        return False
    return is_consented(resolved) or is_dir_consented(resolved) or is_declared_source(resolved)


def _probe_checksummed(path: str) -> dict[str, Any]:
    """The PREVIEW probe: computes a checksum only for an eligible source —
    the same "a bigger ask than the reachability check" gating
    ``desktop_source_probe``'s own module doc already applies to
    ``probe_source``."""
    resolved = _resolve_or_none(path)
    if resolved is None:
        return {"state": "invalid"}
    return probe_source_path(resolved, compute_checksum=_eligible(path))


def _probe_no_checksum(path: str) -> dict[str, Any]:
    """The PACK-TIME probe (``pack_start``): never computes a checksum —
    see ``portable.copying``'s own doc for why a caller SHOULD pass
    ``compute_checksum=False`` to the staging pipeline (the copy itself
    hashes every byte exactly once; a second, probe-side hash would read
    each source twice for no extra safety)."""
    resolved = _resolve_or_none(path)
    if resolved is None:
        return {"state": "invalid"}
    return probe_source_path(resolved, compute_checksum=False)


def _empty_progress() -> dict[str, Any]:
    return {
        "current_file": None,
        "completed_files": 0,
        "total_files": 0,
        "bytes_copied": 0,
        "bytes_total": 0,
        "stage": None,
    }


def _initial_progress(manifest: Mapping[str, Any]) -> dict[str, Any]:
    sources_raw = manifest.get("sources")
    sources = sources_raw if isinstance(sources_raw, list) else []
    packable = [r for r in sources if isinstance(r, dict) and r.get("packable")]
    total_files = len(packable)
    bytes_total = sum(int(r.get("size") or 0) for r in packable)
    # Nothing to stage at all -- go straight to "publishing" (the
    # rewrite/finalize/write/publish steps still run even with zero
    # sources, e.g. an all-embedded project).
    stage = "publishing" if total_files == 0 else "copying"
    return {
        "current_file": None,
        "completed_files": total_files if total_files == 0 else 0,
        "total_files": total_files,
        "bytes_copied": 0,
        "bytes_total": bytes_total,
        "stage": stage,
    }


class DesktopPackBridge:
    """Mixin providing every "Pack Project" js_api method. See this
    module's doc for the full consent/security ruling."""

    _window: Any  # set by DesktopApi.__init__ / .attach()

    def __init__(self) -> None:
        # One in-flight (or just-finished) pack job per process -- there is
        # only ever one desktop window, so one job record is all this
        # bridge ever needs. Guarded by `_pack_lock` end to end: every read
        # in `pack_status` and every write from the worker thread's
        # progress callback/completion takes it, so a poll can never
        # observe a torn update.
        self._pack_lock = threading.Lock()
        self._pack_phase: str = "idle"
        self._pack_preview: dict[str, Any] | None = None
        self._pack_progress: dict[str, Any] = _empty_progress()
        self._pack_warnings: list[Any] = []
        self._pack_errors: list[dict[str, Any]] = []
        self._pack_result: PackResult | None = None
        self._pack_cleanup_ok: bool | None = None
        self._pack_cancel_event: threading.Event | None = None
        # Exactly the read-consent grants THIS operation minted (never a
        # pre-existing grant) -- see `pack_start`'s doc for why only these
        # are revoked when the operation ends.
        self._pack_granted_paths: list[str] = []

    # -- destination pick (mints the ONE new consent kind) -------------------

    def pick_pack_destination(self, directory: str = "") -> dict[str, Any]:
        """Native folder dialog for "Pack Project" — the chosen folder is
        where the bundle directory gets CREATED, and this is the one
        gesture that mints a write-directory grant for it
        (``desktop_consent.grant_write_dir``). Clears every existing
        write-directory grant FIRST — see ``desktop_consent``'s module doc
        for why a destination picked but never started must never
        accumulate."""
        if self._window is None:
            return {"path": None, "error": "no window attached"}
        try:
            chosen = self._window.create_file_dialog(
                _dialog_kind("FOLDER_DIALOG", _FOLDER_DIALOG_DEFAULT),
                directory=directory or os.getcwd(),
            )
        except Exception as exc:  # noqa: BLE001 - reported to JS, never raised into it
            return {"path": None, "error": str(exc)}
        if not chosen:
            return {"path": None}  # cancelled
        first = chosen[0] if isinstance(chosen, (list, tuple)) else chosen
        clear_write_dir_grants()
        granted = grant_write_dir(str(first))
        if granted is None:
            return {"path": None, "error": "selected path is not a writable directory"}
        return {"path": granted}

    # -- preview (read-only planning; grants nothing) -------------------------

    def pack_preview(
        self, content: str, project_name: str, destination_parent: str
    ) -> dict[str, Any]:
        """Dry-run plan for packing ``content`` as ``<project_name>.dwk``
        into a fresh bundle directory inside ``destination_parent``. Grants
        nothing (see ``manifest.py``'s own "the manifest grants nothing"
        ruling) — the actual read grant is minted only at ``pack_start``."""
        payload, err = parse_workspace_payload(content)
        if payload is None:
            return _err("invalid_project", err or "invalid project")
        destination_parent_resolved = _resolve_or_none(destination_parent)
        if destination_parent_resolved is None:
            return _err("destination_not_consented", "destination is not consented")
        if not is_write_dir_consented(destination_parent_resolved):
            return _err("destination_not_consented", "destination is not consented")
        probe: Probe = _probe_checksummed
        consented: Consented = _eligible
        try:
            dry_run_manifest = build_dry_run_manifest(payload, project_name, probe, consented)
        except ValueError as exc:
            return _err("invalid_project_name", str(exc))

        project = dry_run_manifest["project"]
        sanitized_name = project["name"] if isinstance(project, dict) else project_name
        bundle_dir = os.path.join(destination_parent_resolved, sanitized_name)
        content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
        manifest_str = manifest_json(dry_run_manifest)
        token = hashlib.sha256(
            (content_sha256 + manifest_str + bundle_dir).encode("utf-8")
        ).hexdigest()[:32]

        with self._pack_lock:
            self._pack_preview = {
                "token": token,
                "content_sha256": content_sha256,
                "manifest": dry_run_manifest,
                "bundle_dir": bundle_dir,
                "destination_parent": destination_parent_resolved,
                "project_name": project_name,
            }

        sources_raw = dry_run_manifest.get("sources")
        sources = sources_raw if isinstance(sources_raw, list) else []
        blockers = [row for row in sources if isinstance(row, dict) and not row.get("packable")]
        return {
            "ok": True,
            "token": token,
            "manifest": dry_run_manifest,
            "destination": {"bundle_dir": bundle_dir, "exists": os.path.lexists(bundle_dir)},
            "warnings": dry_run_manifest.get("warnings", []),
            "blockers": blockers,
        }

    # -- start (the ONE call that mints real read consent + touches disk) ----

    def pack_start(self, token: str, content: str) -> dict[str, Any]:
        """Start the actual copy/publish pipeline on a daemon worker
        thread. See this module's doc for the full stale-preview /
        consent-minting / revoke-on-completion contract."""
        with self._pack_lock:
            if self._pack_phase in ("packing", "cancelling"):
                return {"ok": False, "error": {"code": "already_running"}}
            preview = self._pack_preview
            if preview is None or preview["token"] != token:
                return _err("stale_preview", "preview is missing or stale — preview again")
            content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
            if content_sha256 != preview["content_sha256"]:
                return _err("stale_preview", "project content changed since preview")
            bundle_dir = preview["bundle_dir"]
            if os.path.lexists(bundle_dir):
                return _err("destination_exists", "destination already exists")
            payload, err = parse_workspace_payload(content)
            if payload is None:
                return _err("invalid_project", err or "invalid project")
            project_name = preview["project_name"]
            manifest = preview["manifest"]

            newly_granted = self._grant_eligible_packable_sources(manifest)

            cancel_event = threading.Event()
            self._pack_cancel_event = cancel_event
            self._pack_granted_paths = list(newly_granted)
            self._pack_phase = "packing"
            self._pack_progress = _initial_progress(manifest)
            self._pack_warnings = list(manifest.get("warnings", []))
            self._pack_errors = []
            self._pack_result = None
            self._pack_cleanup_ok = None

        def _progress(tick: StageProgress) -> None:
            with self._pack_lock:
                self._apply_progress_tick(tick)

        def _run() -> None:
            try:
                result = pack_project(
                    payload,
                    project_name,
                    bundle_dir,
                    probe=_probe_no_checksum,
                    consented=_eligible,
                    progress=_progress,
                    should_cancel=cancel_event.is_set,
                    packed_at=datetime.now(UTC).isoformat(),
                )
            except Exception:  # noqa: BLE001 - a genuine bug, still reported, never raised
                with self._pack_lock:
                    self._pack_phase = "failed"
                    msg = "packing failed unexpectedly"
                    self._pack_errors = [self._error_row("internal_error", msg)]
            else:
                with self._pack_lock:
                    self._pack_result = result
                    self._pack_cleanup_ok = result.cleanup_ok
                    self._pack_errors = [
                        self._error_row(
                            e.get("code", "pack_failed"),
                            e.get("message", "packing failed"),
                            source_id=e.get("source_id"),
                            bundle_path=e.get("bundle_path"),
                        )
                        for e in result.errors
                    ]
                    if result.cancelled:
                        self._pack_phase = "cancelled"
                    elif result.ok:
                        self._pack_phase = "completed"
                        self._pack_progress["stage"] = None
                        self._pack_progress["current_file"] = None
                        self._pack_progress["completed_files"] = self._pack_progress["total_files"]
                    else:
                        self._pack_phase = "failed"
            finally:
                revoke_paths(newly_granted)
                clear_write_dir_grants()

        threading.Thread(target=_run, daemon=True).start()
        return {"ok": True}

    def _grant_eligible_packable_sources(self, manifest: Mapping[str, Any]) -> list[str]:
        """Mint real read consent for every ``packable`` row's
        ``original_path`` that is not ALREADY read-consented — i.e. the
        rows that reached ``packable`` only via a directory grant or a
        declared source, never an arbitrary path (every packable row
        already passed ``_eligible`` as the manifest's ``consented``
        predicate at preview time). Returns exactly what was granted, for
        ``pack_start``'s ``finally`` to revoke unconditionally."""
        sources_raw = manifest.get("sources")
        sources = sources_raw if isinstance(sources_raw, list) else []
        to_grant: list[str] = []
        for row in sources:
            if not isinstance(row, dict) or not row.get("packable"):
                continue
            original_path = row.get("original_path")
            if not isinstance(original_path, str):
                continue
            resolved = _resolve_or_none(original_path)
            if resolved is not None and not is_consented(resolved):
                to_grant.append(original_path)
        return grant_paths(to_grant)

    def _apply_progress_tick(self, tick: StageProgress) -> None:
        """Must be called holding `_pack_lock`. See this module's doc for
        the `"publishing"` stage inference on the last file's tick."""
        p = self._pack_progress
        p["current_file"] = tick.bundle_path
        p["completed_files"] = max(0, tick.file_index - 1)
        p["total_files"] = tick.file_count
        p["bytes_copied"] = tick.bytes_done
        p["bytes_total"] = tick.bytes_total
        p["stage"] = tick.phase
        if tick.phase == "verifying" and tick.file_index >= tick.file_count:
            p["stage"] = "publishing"
            p["completed_files"] = tick.file_count
            p["current_file"] = None

    @staticmethod
    def _error_row(
        code: str, message: str, *, source_id: str | None = None, bundle_path: str | None = None
    ) -> dict[str, Any]:
        row: dict[str, Any] = {
            "code": code,
            "message": message,
            "originals_modified": False,
            "note": _NOTHING_MODIFIED_NOTE,
        }
        if source_id is not None:
            row["source_id"] = source_id
        if bundle_path is not None:
            row["bundle_path"] = bundle_path
        return row

    # -- status / cancel / reset (no filesystem, no consent) ------------------

    def pack_status(self) -> dict[str, Any]:
        with self._pack_lock:
            phase = self._pack_phase
            progress = dict(self._pack_progress)
            warnings = list(self._pack_warnings)
            errors = list(self._pack_errors)
            cleanup_ok = self._pack_cleanup_ok
            result = (
                {"bundle_dir": self._pack_result.bundle_dir}
                if self._pack_result is not None and self._pack_result.ok
                else None
            )
        return {
            "phase": phase,
            "progress": progress,
            "warnings": warnings,
            "errors": errors,
            "result": result,
            "cleanup_ok": cleanup_ok,
            "originals_modified": False,
        }

    def pack_cancel(self) -> dict[str, Any]:
        with self._pack_lock:
            if self._pack_phase == "packing":
                self._pack_phase = "cancelling"
                if self._pack_cancel_event is not None:
                    self._pack_cancel_event.set()
            return {"ok": True, "phase": self._pack_phase}

    def pack_reset(self) -> dict[str, Any]:
        with self._pack_lock:
            if self._pack_phase in ("packing", "cancelling"):
                return {"ok": False, "error": {"code": "already_running"}}
            self._pack_phase = "idle"
            self._pack_preview = None
            self._pack_progress = _empty_progress()
            self._pack_warnings = []
            self._pack_errors = []
            self._pack_result = None
            self._pack_cleanup_ok = None
            self._pack_cancel_event = None
            self._pack_granted_paths = []
        return {"ok": True}
