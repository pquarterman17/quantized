"""Pure, stateless helpers for :mod:`quantized.desktop_bridge_pack`'s
``DesktopPackBridge``.

Split out purely to keep that module under the repo's 500-line god-module
ceiling (``tests/test_repo_integrity.py``) once the PR 4 review-round fixes
(finding #1, #5, #7, #9, #10) pushed it over. Nothing here touches
``self``/instance state or spawns a thread — every function is a pure
function of its arguments plus the process-global consent stores in
:mod:`quantized.desktop_consent`, which is exactly what the bridge's
``probe``/``consented`` plumbing and its progress-dict shapes need. Moving
them here means the bridge module itself holds only the actual js_api
methods and the in-memory job record they mutate; nothing about the
security ruling changes — see ``desktop_bridge_pack.py``'s own module doc
for that.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from quantized.desktop_consent import (
    grant_paths,
    is_consented,
    is_declared_source,
    is_dir_consented,
    normalize_path,
)
from quantized.desktop_source_probe import probe_source_path

__all__ = [
    "grant_eligible_packable_sources",
    "ineligible_packable_sources",
    "NOTHING_MODIFIED_NOTE",
    "empty_progress",
    "eligible",
    "err",
    "initial_progress",
    "probe_checksummed",
    "probe_no_checksum",
]

# The exact sentence every terminal `pack_status` error carries — see
# `desktop_bridge_pack.py`'s own doc: a pack operation never touches an
# original file or the open project until its own atomic publish rename,
# so this is true for every failure/cancellation that module can report.
NOTHING_MODIFIED_NOTE = "No original files or project were modified."


def err(code: str, message: str) -> dict[str, Any]:
    """Shared shape for every synchronous rejection a bridge method
    returns — never carries ``originals_modified``/``note`` (those belong
    to ``pack_status``'s terminal ``errors`` list): a rejection here means
    nothing ever started, so there is nothing to reassure the caller
    about."""
    return {"ok": False, "error": {"code": code, "message": message}}


def eligible(path: str) -> bool:
    """A source path is eligible to be probed/packed when it is already
    read-consented, covered by a read-only directory grant, or declared by
    the currently open project's own payload — see
    ``desktop_bridge_pack.py``'s module doc."""
    resolved = normalize_path(path)
    if resolved is None:
        return False
    return is_consented(resolved) or is_dir_consented(resolved) or is_declared_source(resolved)


def probe_checksummed(path: str) -> dict[str, Any]:
    """The PREVIEW probe. ``compute_checksum=True`` unconditionally — not
    dead weight, since ``build_dry_run_manifest`` only ever calls ``probe``
    (this function) AFTER its own ``consented_fn`` (``eligible``, passed as
    this preview's ``consented``) has already passed for ``path``
    (``manifest.py``'s own "checked BEFORE `probe` is called at all" rule).
    So by the time this runs, ``eligible(path)`` is always ``True``;
    calling it a second time here would be dead logic, not an extra guard
    (review finding #9)."""
    resolved = normalize_path(path)
    if resolved is None:
        return {"state": "invalid"}
    return probe_source_path(resolved, compute_checksum=True)


def probe_no_checksum(path: str) -> dict[str, Any]:
    """The PACK-TIME probe (``pack_start``): never computes a checksum —
    see ``portable.copying``'s own doc for why a caller SHOULD pass
    ``compute_checksum=False`` to the staging pipeline (the copy itself
    hashes every byte exactly once; a second, probe-side hash would read
    each source twice for no extra safety)."""
    resolved = normalize_path(path)
    if resolved is None:
        return {"state": "invalid"}
    return probe_source_path(resolved, compute_checksum=False)


def empty_progress() -> dict[str, Any]:
    return {
        "current_file": None,
        "completed_files": 0,
        "total_files": 0,
        "bytes_copied": 0,
        "bytes_total": 0,
        "stage": None,
    }


def initial_progress(manifest: Mapping[str, Any]) -> dict[str, Any]:
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


def ineligible_packable_sources(manifest: Mapping[str, Any]) -> list[str]:
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
        if isinstance(original_path, str) and not eligible(original_path):
            lost.append(original_path)
    return lost


def grant_eligible_packable_sources(manifest: Mapping[str, Any]) -> list[str]:
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
        if not eligible(original_path):
            continue
        resolved = normalize_path(original_path)
        if resolved is not None and not is_consented(resolved):
            to_grant.append(original_path)
    return grant_paths(to_grant)
