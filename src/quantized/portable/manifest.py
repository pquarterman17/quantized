"""P1.7 "Pack Project" — the dry-run manifest builder.

## Scope (PR 1 of the "Pack Project" stack)

This module computes what a future "Pack Project" WOULD do, from a
workspace payload and a probe callback — it copies nothing, writes nothing
but the returned dict, and never opens a source file's content itself. The
actual staged copy (PR 2), atomic publish + open-time resolution (PR 3), and
the pywebview bridge method + frontend wiring (PR 4) all build on this
contract but are not implemented here.

## Security / trust boundary

- The manifest is computed ENTIRELY from the ``payload`` mapping the caller
  supplies and the responses ``probe`` and ``consented`` return for each
  unique original path — this module reads no file, follows no symlink, and
  makes no filesystem call of its own.
- Reachability, size/mtime, and checksum all come from ``probe`` alone. The
  real bridge implementation (a future PR) is expected to gate checksum
  computation on read-consent the same way ``desktop_source_probe
  .probe_source_path``'s caller already does for the existing relink flow —
  this module has no opinion on that policy, it only reports whatever
  ``probe`` hands back.
- ``consented`` is a SEPARATE, per-source gate this module DOES enforce
  directly: a source for which ``consented(original_path)`` is false is
  always reported as ``status: "not_consented"`` with every metadata field
  nulled out, regardless of what ``probe`` returned for it — the manifest
  never surfaces size/mtime/checksum for a path the caller has not vouched
  for, even if a probe result for it was available.
- The manifest **grants nothing**: producing a dry-run manifest is not
  itself a consent decision, and nothing downstream may treat a manifest
  row's presence as authorization to read or copy the file it describes.
- Bundle destination paths are built EXCLUSIVELY from a sanitized basename
  (:func:`quantized.portable.layout.sanitize_component` on
  :func:`quantized.portable.layout.basename_of`) — never from any part of
  the original directory structure, so a bundle can never leak a source's
  original location through its own internal layout.
  :func:`quantized.portable.layout.is_bundle_relative` (asserted on every
  planned path here) and :func:`quantized.portable.layout.join_bundle_path`
  are the only sanctioned way to turn a manifest path into a real
  filesystem path; this module never does that turning itself.

## Determinism

No timestamps, no randomness, no reliance on dict/set iteration order that
isn't itself derived from a sort: the same ``payload`` plus the same
``probe``/``consented`` responses must produce byte-identical
:func:`manifest_json` output on every run, on every platform, regardless of
the order datasets happen to appear in ``payload`` (aside from
``datasets``/``shared_by``, which intentionally preserve payload order —
see their fields' own notes below). This is what lets
``tools/freeze_portable_manifest.py`` commit a fixture that
``tests/test_portable_manifest_fixture.py`` can byte-compare forever.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Mapping
from typing import Any

from .layout import (
    BUNDLE_FORMAT,
    MANIFEST_FILENAME,
    MANIFEST_VERSION,
    SOURCES_DIR,
    basename_of,
    is_bundle_relative,
    path_key,
    sanitize_component,
)

__all__ = ["build_dry_run_manifest", "manifest_json"]

Probe = Callable[[str], Mapping[str, Any]]
Consented = Callable[[str], bool]

# The states `probe` is contractually allowed to report (mirrors
# `desktop_source_probe.probe_source_path`'s own set). Anything else is a
# caller bug -- degrade it to "invalid" rather than let an unrecognized
# string silently become "packable" or otherwise misclassified.
_KNOWN_PROBE_STATES = {"ok", "missing", "offline", "invalid", "permission_denied"}

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_DRIVE_OR_UNC_RE = re.compile(r"^[A-Za-z]:[\\/]")


def _default_consented(_path: str) -> bool:
    return True


def _has_control_chars(s: str) -> bool:
    return bool(_CONTROL_CHAR_RE.search(s))


def _looks_absolute(path: str) -> bool:
    """Is ``path`` absolute under EITHER host convention?

    ``os.path.isabs`` alone only recognizes the RUNNING platform's own
    convention (a Windows ``C:\\...`` path is not "absolute" by
    ``posixpath.isabs`` on a Linux CI runner) — a workspace payload can
    legitimately declare a source recorded on a different OS than the one
    validating it right now, so this also accepts the Windows drive-letter
    and UNC shapes explicitly regardless of host platform.
    """
    if os.path.isabs(path):
        return True
    if _DRIVE_OR_UNC_RE.match(path):
        return True
    return path.startswith("\\\\") or path.startswith("//")


def _split_ext(name: str) -> tuple[str, str]:
    dot = name.rfind(".")
    if dot > 0:
        return name[:dot], name[dot:]
    return name, ""


def _stat_verdict(recorded: Mapping[str, Any], probed: Mapping[str, Any]) -> str:
    have_size = recorded.get("size") is not None and probed.get("size") is not None
    have_mtime = recorded.get("mtime") is not None and probed.get("mtime") is not None
    if not have_size and not have_mtime:
        return "unknown"
    if have_size and recorded.get("size") != probed.get("size"):
        return "changed"
    if have_mtime and recorded.get("mtime") != probed.get("mtime"):
        return "changed"
    return "unchanged"


def _verdict(recorded: Mapping[str, Any], probed: Mapping[str, Any]) -> str:
    """Replicates ``frontend/src/lib/relink.ts``'s ``sourceChangeVerdict``
    exactly (read that function's own doc for the full rationale): a
    RECORDED checksum is the only signal trusted once present — never
    silently demoted to a size/mtime comparison just because the fresh
    probe couldn't confirm one (that would answer with a WEAKER signal than
    the one actually on record) — and only falls back to size+mtime when no
    checksum was ever recorded at all."""
    recorded_checksum = recorded.get("checksum")
    if recorded_checksum:
        probed_checksum = probed.get("checksum")
        if not probed_checksum:
            return "unknown"
        return "unchanged" if recorded_checksum == probed_checksum else "changed"
    return _stat_verdict(recorded, probed)


def _dataset_identity(ds: Any, index: int) -> tuple[str, str]:
    if isinstance(ds, dict):
        raw_id = ds.get("id")
        dataset_id = raw_id if isinstance(raw_id, str) and raw_id else f"dataset_{index}"
        raw_name = ds.get("name")
        name = raw_name if isinstance(raw_name, str) else ""
        return dataset_id, name
    return f"dataset_{index}", ""


def _classify_source(source_obj: Any) -> tuple[str | None, str | None, dict[str, Any] | None]:
    """``(note, original_path, recorded)`` — exactly one of ``note`` or the
    other two is populated. ``note`` is one of ``"embedded_only"``
    (no/non-dict source at all), ``"unsupported_source_kind"`` (a source
    dict whose ``kind`` isn't ``"path"``), or ``"malformed_source"`` (kind
    is ``"path"`` but ``path`` is missing/non-string/empty)."""
    if not isinstance(source_obj, dict):
        return "embedded_only", None, None
    if source_obj.get("kind") != "path":
        return "unsupported_source_kind", None, None
    path = source_obj.get("path")
    if not isinstance(path, str) or not path:
        return "malformed_source", None, None
    raw_checksum = source_obj.get("checksum")
    raw_mtime = source_obj.get("mtime")
    raw_size = source_obj.get("size")
    recorded = {
        "checksum": raw_checksum if isinstance(raw_checksum, str) else None,
        "mtime": raw_mtime if isinstance(raw_mtime, (int, float)) else None,
        "size": raw_size if isinstance(raw_size, (int, float)) else None,
    }
    return None, path, recorded


_ROW_WARNING_MESSAGES = {
    "renamed_collision": (
        "destination filename collided with another source and was renamed to avoid overwriting it"
    ),
    "renamed_unportable_name": (
        "source filename was not portable across platforms and was sanitized"
    ),
}


def build_dry_run_manifest(
    payload: Mapping[str, Any],
    project_name: str,
    probe: Probe,
    consented: Consented | None = None,
) -> dict[str, Any]:
    """Build the dry-run manifest for packing ``payload`` as ``<project_name>.dwk``.

    ``payload`` is an already-parsed workspace document (see
    :func:`quantized.desktop_project_file.parse_workspace_payload`).
    ``probe`` is called at most once per unique original path (identified by
    :func:`quantized.portable.layout.path_key`) — see the module docstring's
    security section for exactly what each of ``probe``/``consented``
    controls. See this module's own docstring for the full contract; the
    exact per-row and top-level field set is documented on
    ``plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`` P1.7's Pack Project subsection.
    """
    consented_fn = consented if consented is not None else _default_consented
    datasets_raw = payload.get("datasets")
    datasets_list = datasets_raw if isinstance(datasets_raw, list) else []

    dataset_entries: list[dict[str, Any]] = []
    groups: dict[str, dict[str, Any]] = {}
    group_order: list[str] = []
    pending_source_key: dict[int, str] = {}

    for i, ds in enumerate(datasets_list):
        dataset_id, name = _dataset_identity(ds, i)
        source_obj = ds.get("source") if isinstance(ds, dict) else None
        note, original_path, recorded = _classify_source(source_obj)
        if note is not None:
            dataset_entries.append(
                {"dataset_id": dataset_id, "name": name, "source_id": None, "note": note}
            )
            continue
        assert original_path is not None and recorded is not None
        key = path_key(original_path)
        if key not in groups:
            groups[key] = {"original_path": original_path, "members": []}
            group_order.append(key)
        groups[key]["members"].append(
            {"dataset_id": dataset_id, "name": name, "recorded": recorded}
        )
        entry_index = len(dataset_entries)
        dataset_entries.append({"dataset_id": dataset_id, "name": name, "source_id": None})
        pending_source_key[entry_index] = key

    # Deterministic source order: (path_key, original_path) — never payload
    # order, so re-shuffling `payload["datasets"]` can't reorder `sources`.
    sorted_keys = sorted(group_order, key=lambda k: (k, groups[k]["original_path"]))
    source_id_of = {k: f"s{n + 1:03d}" for n, k in enumerate(sorted_keys)}
    for idx, key in pending_source_key.items():
        dataset_entries[idx]["source_id"] = source_id_of[key]

    rows: list[dict[str, Any]] = []
    for key in sorted_keys:
        group = groups[key]
        original_path = group["original_path"]
        members = group["members"]
        row: dict[str, Any] = {
            "source_id": source_id_of[key],
            "original_path": original_path,
            "members": members,
        }
        if _has_control_chars(original_path) or not _looks_absolute(original_path):
            row["status"] = "invalid"
            row["size"] = row["mtime"] = row["checksum"] = None
        else:
            probed = probe(original_path)
            state = probed.get("state")
            status = state if state in _KNOWN_PROBE_STATES else "invalid"
            if not consented_fn(original_path):
                status = "not_consented"
                size = mtime = checksum = None
            elif status == "ok":
                size = probed.get("size")
                mtime = probed.get("mtime")
                checksum = probed.get("checksum")
            else:
                size = mtime = checksum = None
            row["status"] = status
            row["size"] = size
            row["mtime"] = mtime
            row["checksum"] = checksum
        rows.append(row)

    for row in rows:
        probed_for_verdict = {
            "checksum": row["checksum"],
            "mtime": row["mtime"],
            "size": row["size"],
        }
        shared_by = []
        verdicts = []
        for m in row["members"]:
            verdict = _verdict(m["recorded"], probed_for_verdict)
            verdicts.append(verdict)
            shared_by.append(
                {
                    "dataset_id": m["dataset_id"],
                    "name": m["name"],
                    "recorded": {
                        "checksum": m["recorded"].get("checksum"),
                        "mtime": m["recorded"].get("mtime"),
                        "size": m["recorded"].get("size"),
                    },
                    "verdict": verdict,
                }
            )
        row["shared"] = len(row["members"]) > 1
        row["shared_by"] = shared_by
        row["changed"] = any(v == "changed" for v in verdicts)
        row["unverified"] = any(v == "unknown" for v in verdicts)
        row["packable"] = row["status"] == "ok"
        row["blockers"] = [] if row["status"] == "ok" else [row["status"]]

    # ── planned bundle path + visible collision suffixes (LIBRARY_WORKBOOK_
    # UX_PLAN L0.34's "visible collision suffixes; never overwrite silently"
    # idiom -- `dedupeWindowTitle`'s "Name", "Name (2)", ... shape) ─────────
    for row in rows:
        base_name, base_reason = sanitize_component(basename_of(row["original_path"]))
        row["_base_name"] = base_name
        row["_base_reason"] = base_reason

    key_groups: dict[str, list[int]] = {}
    for idx, row in enumerate(rows):
        key_groups.setdefault(path_key(row["_base_name"]), []).append(idx)

    collision_group_of: dict[int, int] = {}
    next_group_id = 0
    for idxs in key_groups.values():
        if len(idxs) > 1:
            next_group_id += 1
            for idx in idxs:
                collision_group_of[idx] = next_group_id

    used_keys: set[str] = set()
    final_name: dict[int, str] = {}
    for idx, row in enumerate(rows):
        if idx not in collision_group_of:
            final_name[idx] = row["_base_name"]
            used_keys.add(path_key(row["_base_name"]))
    for idxs in key_groups.values():
        if len(idxs) <= 1:
            continue
        keeper = idxs[0]
        final_name[keeper] = rows[keeper]["_base_name"]
        used_keys.add(path_key(rows[keeper]["_base_name"]))
        for idx in idxs[1:]:
            stem, ext = _split_ext(rows[idx]["_base_name"])
            n = 2
            while True:
                candidate, _reason = sanitize_component(f"{stem} ({n}){ext}")
                candidate_key = path_key(candidate)
                if candidate_key not in used_keys:
                    final_name[idx] = candidate
                    used_keys.add(candidate_key)
                    break
                n += 1

    final_rows: list[dict[str, Any]] = []
    for idx, row in enumerate(rows):
        name = final_name[idx]
        bundle_path = f"{SOURCES_DIR}/{name}"
        if not is_bundle_relative(bundle_path):
            # A bug, not user input: `name` comes only from `sanitize_component`
            # on a basename that already has no separators in it.
            raise RuntimeError(f"planned bundle path is not bundle-relative: {bundle_path!r}")
        original_basename = basename_of(row["original_path"])
        base_key = path_key(row["_base_name"])
        is_collision_rename = idx in collision_group_of and idx != key_groups[base_key][0]
        warnings: list[str] = []
        if row["changed"]:
            warnings.append("changed_since_import")
        if row["unverified"]:
            warnings.append("unverified_provenance")
        if is_collision_rename:
            warnings.append("renamed_collision")
        if row["_base_reason"] is not None:
            warnings.append("renamed_unportable_name")
        final_rows.append(
            {
                "source_id": row["source_id"],
                "original_path": row["original_path"],
                "bundle_path": bundle_path,
                "status": row["status"],
                "size": row["size"],
                "mtime": row["mtime"],
                "checksum": row["checksum"],
                "shared": row["shared"],
                "shared_by": row["shared_by"],
                "changed": row["changed"],
                "unverified": row["unverified"],
                "packable": row["packable"],
                "blockers": row["blockers"],
                "warnings": warnings,
                "collision_group": collision_group_of.get(idx),
                "renamed_from": original_basename if name != original_basename else None,
            }
        )

    manifest_warnings: list[dict[str, Any]] = []
    for row in final_rows:
        if row["renamed_from"] is None:
            continue
        for code in row["warnings"]:
            if code not in _ROW_WARNING_MESSAGES:
                continue
            manifest_warnings.append(
                {
                    "code": code,
                    "source_id": row["source_id"],
                    "message": (
                        f"{_ROW_WARNING_MESSAGES[code]}: "
                        f"{row['renamed_from']!r} -> {basename_of(row['bundle_path'])!r}"
                    ),
                }
            )

    summary = {
        "datasets": len(dataset_entries),
        "sources": len(final_rows),
        "packable": sum(1 for r in final_rows if r["packable"]),
        "blocked": sum(1 for r in final_rows if not r["packable"]),
        "shared": sum(1 for r in final_rows if r["shared"]),
        "total_bytes": sum(r["size"] or 0 for r in final_rows if r["packable"]),
        "warnings": len(manifest_warnings),
    }

    return {
        "format": BUNDLE_FORMAT,
        "manifest_version": MANIFEST_VERSION,
        "dry_run": True,
        "project": {
            "name": project_name,
            "project_file": f"{project_name}.dwk",
            "workspace_format": payload.get("format"),
            "workspace_version": payload.get("version"),
        },
        "layout": {
            "manifest_file": MANIFEST_FILENAME,
            "sources_dir": SOURCES_DIR,
        },
        "sources": final_rows,
        "datasets": dataset_entries,
        "warnings": manifest_warnings,
        "summary": summary,
    }


def manifest_json(manifest: Mapping[str, Any]) -> str:
    """Canonical serialization: 2-space indent, sorted keys, trailing
    newline, non-ASCII characters left as-is (a Unicode dataset/source name
    stays readable in the committed fixture and any diff of it) — so the
    same manifest dict always serializes byte-identically."""
    return json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
