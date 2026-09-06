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
  on a daemon thread — passing it the STORED preview's own manifest
  verbatim (``manifest=``), never letting it rebuild one from whatever the
  filesystem or consent state look like right now (PR 4 review round 2's
  finding: a rebuild silently re-plans against different data even when the
  token/content check above passes — see the next section). Every
  outcome — success, failure, cancellation — the thread's own ``finally``
  revokes EXACTLY those minted grants (``revoke_paths``) and clears the
  write-directory grant, so a pack operation's read/write footprint never
  outlives it.
- ``pack_status``/``pack_cancel``/``pack_reset`` touch no filesystem and
  mint/spend no consent — pure reads/mutations of this instance's own
  in-memory job record, one ``threading.Lock`` guarding every access.

**The approved manifest is what executes.** ``pack_start`` validates the
token and the workspace JSON, but a copy/publish pipeline that then
recomputed its own plan from current disk/consent state would never
actually enforce what the user reviewed and approved in ``pack_preview``:
(1) a source that was ``missing`` (blocked) at preview time and appears on
disk before ``pack_start`` runs must stay unpacked — a rebuilt manifest
would happily mark it ``packable`` now; (2) a source whose bytes changed
between preview and start must fail closed against its PREVIEW-TIME
checksum, not sail through by being re-verified only against itself. So
the token binds three things together — the workspace ``content`` (hash-
checked above), the approved ``manifest`` (passed to ``pack.pack_project``
verbatim, never rebuilt), and the ``destination`` — and staging enforces
the approved snapshot: :func:`quantized.portable.staging.stage_sources`
re-probes every ``packable`` row against ITS RECORDED size/mtime/checksum
(unchanged behaviour, now finally exercised against the right values) and
fails ``changed_since_preview`` on any drift, while a row the approved
manifest never marked ``packable`` is never staged regardless of what the
filesystem looks like at start time.

**Consent is re-checked at start, and a lost grant fails closed.** Content
is verified byte-identical to preview (the ``sha256`` check on
``content``), but consent is process-global mutable state that can move
between preview and start — a declared-source set can be replaced by a
project reopen, a directory grant revoked by a relink panel closing. The
approved manifest names WHAT may be copied; it is not itself a read grant.
So ``pack_start`` re-checks every ``packable`` row against ``_eligible``
before minting anything or spawning the worker: if even one row is no
longer eligible, the call is refused with ``consent_changed`` (preview
again — the new preview will show the row as blocked) and nothing is
granted, staged, or copied. Only when every approved row is still
eligible does ``_grant_eligible_packable_sources`` mint the missing read
grants — never widening the grant registry to a path that is not eligible
right now.

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

from quantized import desktop_bridge_pack_state as _state
from quantized.desktop_bridge_common import FOLDER_DIALOG_DEFAULT, dialog_kind
from quantized.desktop_consent import (
    clear_write_dir_grants,
    grant_paths,
    grant_write_dir,
    is_consented,
    is_write_dir_consented,
    normalize_path,
    revoke_paths,
)
from quantized.desktop_project_file import parse_workspace_payload
from quantized.portable.copy_stream import StageProgress
from quantized.portable.grouping import Consented, Probe
from quantized.portable.manifest import build_dry_run_manifest, manifest_json
from quantized.portable.pack import PackResult, pack_project

__all__ = ["DesktopPackBridge"]


def _ineligible_packable_sources(manifest: Mapping[str, Any]) -> list[str]:
    """``original_path`` of every ``packable`` row in the approved manifest
    that is NOT eligible under the consent state in force right now. Empty
    means every approved row may still be read; anything else means
    ``pack_start`` must refuse rather than copy from a path whose consent
    lapsed after the user approved the preview."""
    sources_raw = manifest.get("sources")
    sources = sources_raw if isinstance(sources_raw, list) else []
    lost: list[str] = []
    for row in sources:
        if not isinstance(row, dict) or not row.get("packable"):
            continue
        original_path = row.get("original_path")
        if isinstance(original_path, str) and not _state.eligible(original_path):
            lost.append(original_path)
    return lost


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
        self._pack_progress: dict[str, Any] = _state.empty_progress()
        self._pack_warnings: list[Any] = []
        self._pack_errors: list[dict[str, Any]] = []
        self._pack_result: PackResult | None = None
        self._pack_cleanup_ok: bool | None = None
        self._pack_cancel_event: threading.Event | None = None

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
                dialog_kind("FOLDER_DIALOG", FOLDER_DIALOG_DEFAULT),
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
            return _state.err("invalid_project", err or "invalid project")
        destination_parent_resolved = normalize_path(destination_parent)
        if destination_parent_resolved is None:
            return _state.err("destination_not_consented", "destination is not consented")
        if not is_write_dir_consented(destination_parent_resolved):
            return _state.err("destination_not_consented", "destination is not consented")
        probe: Probe = _state.probe_checksummed
        consented: Consented = _state.eligible
        try:
            dry_run_manifest = build_dry_run_manifest(payload, project_name, probe, consented)
        except ValueError as exc:
            return _state.err("invalid_project_name", str(exc))
        except RuntimeError:
            # P1.7 PR 5 audit item 13: `build_dry_run_manifest` can only
            # raise `RuntimeError` from its own internal "this should be
            # structurally impossible" assertions (manifest.py's doc: a
            # duplicate planned bundle path, or one that somehow isn't
            # bundle-relative) -- never real user input, and never
            # something `ValueError` above already catches. That
            # RuntimeError's own message embeds the offending bundle_path
            # string. `pack_start`'s worker thread already has a blanket
            # `except Exception` for exactly this "genuine bug, still
            # reported, never raised" case (its own doc); this synchronous
            # method had no equivalent, so a latent bug here would
            # otherwise propagate the path-carrying message straight out
            # of this js_api method into pywebview's own exception surface
            # instead of a safe, structured refusal.
            return _state.err("internal_error", "could not build a pack preview")

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
                return _state.err("stale_preview", "preview is missing or stale — preview again")
            content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
            if content_sha256 != preview["content_sha256"]:
                return _state.err("stale_preview", "project content changed since preview")
            # Review finding #5: `pick_pack_destination` clears every PRIOR
            # write-dir grant before minting a new one (its own doc), so a
            # second folder pick between this preview and this call silently
            # revokes the grant this preview's `destination_parent` relied
            # on -- the stale token must not be honored just because it
            # still names the right bundle path.
            if not is_write_dir_consented(preview["destination_parent"]):
                return _state.err("destination_not_consented", "destination is not consented")
            bundle_dir = preview["bundle_dir"]
            if os.path.lexists(bundle_dir):
                return _state.err("destination_exists", "destination already exists")
            payload, err = parse_workspace_payload(content)
            if payload is None:
                return _state.err("invalid_project", err or "invalid project")
            project_name = preview["project_name"]
            manifest = preview["manifest"]

            if _ineligible_packable_sources(manifest):
                return _state.err(
                    "consent_changed",
                    "a source lost read consent since preview — preview again",
                )
            newly_granted = self._grant_eligible_packable_sources(manifest)

            cancel_event = threading.Event()
            self._pack_cancel_event = cancel_event
            self._pack_phase = "packing"
            self._pack_progress = _state.initial_progress(manifest)
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
                    probe=_state.probe_no_checksum,
                    manifest=manifest,
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

        try:
            threading.Thread(target=_run, daemon=True).start()
        except Exception:  # noqa: BLE001 - a genuine bug, still reported, never raised
            # Review finding #7: the phase was already set to "packing" and
            # `newly_granted` already minted above, under the same lock --
            # if the thread itself never actually started (a starved OS
            # thread limit, e.g.), that phase would otherwise be stuck at
            # "packing" forever with its grants never revoked. Unwind both,
            # exactly as `_run`'s own `finally` would have on any other
            # failure, and report a structured refusal instead of letting
            # the exception escape into pywebview's JS bridge.
            with self._pack_lock:
                self._pack_phase = "failed"
                self._pack_errors = [
                    self._error_row("thread_failed", "packing could not be started")
                ]
            revoke_paths(newly_granted)
            clear_write_dir_grants()
            return _state.err("thread_failed", "packing could not be started")
        return {"ok": True}

    def _grant_eligible_packable_sources(self, manifest: Mapping[str, Any]) -> list[str]:
        """Mint real read consent for every ``packable`` row's
        ``original_path`` that is not ALREADY read-consented — i.e. the
        rows that reached ``packable`` only via a directory grant or a
        declared source, never an arbitrary path.

        Review finding #1: a row's ``packable`` flag comes from the STORED
        preview's manifest, computed against whatever was ``_eligible`` at
        PREVIEW time — but consent can move between preview and this call.
        ``pack_start`` already refuses (``consent_changed``) when any
        packable row is no longer eligible, so by the time this runs every
        candidate should pass ``_eligible``; the check is repeated here as
        defence in depth so this function can never mint a grant for an
        ineligible path whatever its caller did. Returns exactly what was
        granted, for ``pack_start``'s ``finally``/failure paths to revoke
        unconditionally."""
        sources_raw = manifest.get("sources")
        sources = sources_raw if isinstance(sources_raw, list) else []
        to_grant: list[str] = []
        for row in sources:
            if not isinstance(row, dict) or not row.get("packable"):
                continue
            original_path = row.get("original_path")
            if not isinstance(original_path, str):
                continue
            if not _state.eligible(original_path):
                continue
            resolved = normalize_path(original_path)
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
            "note": _state.NOTHING_MODIFIED_NOTE,
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
            self._pack_progress = _state.empty_progress()
            self._pack_warnings = []
            self._pack_errors = []
            self._pack_result = None
            self._pack_cleanup_ok = None
            self._pack_cancel_event = None
        return {"ok": True}
