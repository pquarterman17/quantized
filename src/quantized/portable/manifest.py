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
- ``consented`` is checked BEFORE ``probe`` is ever called for a given
  original path: a source for which ``consented(original_path)`` is false
  is reported as ``status: "not_consented"`` with every metadata field
  nulled out, and ``probe`` is skipped entirely — the manifest never even
  asks a probe implementation (which may do real I/O) about a path the
  caller has not vouched for.
- Reachability, size/mtime, and checksum come from ``probe`` alone, for
  every source ``consented`` allows through. The real bridge implementation
  (a future PR) is expected to gate checksum computation on read-consent
  the same way ``desktop_source_probe.probe_source_path``'s caller already
  does for the existing relink flow — this module has no opinion on that
  policy, it only reports whatever ``probe`` hands back (type-validated:
  a non-``str`` checksum or non-numeric size/mtime is absent, not trusted
  or allowed to crash the summary).
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
  filesystem path; this module never does that turning itself. The builder
  also asserts every planned ``bundle_path`` is pairwise-unique (by
  :func:`quantized.portable.layout.path_key`) before returning — a
  ``RuntimeError``, never a silent duplicate, if that ever fails (see
  :mod:`quantized.portable.naming` for how planning avoids it in the first
  place).
- A ``project_name`` that is a path-traversal shape (a path separator, or a
  literal ``..``) is rejected with ``ValueError`` rather than silently
  mangled — a project name must never smuggle a directory component into
  the bundle's own layout.

## Determinism

No timestamps, no randomness, no reliance on dict/set iteration order that
isn't itself derived from a sort: the same ``payload`` plus the same
``probe``/``consented`` responses must produce byte-identical
:func:`manifest_json` output on every run, on every platform, regardless of
the order datasets happen to appear in ``payload`` (aside from
``datasets``/``shared_by``, which intentionally preserve payload order —
see their fields' own notes below) OR the spelling (case, Unicode
normalization form) two datasets happen to use for what
:func:`quantized.portable.layout.path_key` treats as the same original
path — a row's ``original_path`` is always the CANONICAL spelling (the
lexicographically-least member by ``(NFC-normalized string, raw string)``,
never whichever spelling happened to appear first in payload order), with
every other distinct spelling recorded in ``original_path_variants``. This
is what lets ``tools/freeze_portable_manifest.py`` commit a fixture that
``tests/test_portable_manifest_fixture.py`` can byte-compare forever.
"""

from __future__ import annotations

import json
import ntpath
import posixpath
import re
import unicodedata
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
from .naming import plan_bundle_names

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

    Never ``os.path.isabs`` alone: that only recognizes the RUNNING
    platform's own convention, and on Python 3.13 ``os.path`` is
    ``ntpath`` on Windows -- where ``ntpath.isabs("/data/x.csv")`` is
    FALSE (no drive, so ntpath does not consider a bare leading slash
    absolute), which would misclassify an ordinary POSIX path as relative
    on a Windows host. This checks ``posixpath.isabs`` and ``ntpath.isabs``
    EXPLICITLY, regardless of the host platform, plus the drive-letter and
    UNC shapes below as belt-and-suspenders -- a workspace payload can
    legitimately declare a source recorded on a different OS than the one
    validating it right now.
    """
    if posixpath.isabs(path) or ntpath.isabs(path):
        return True
    if _DRIVE_OR_UNC_RE.match(path):
        return True
    return path.startswith("\\\\") or path.startswith("//")


def _coerce_metadata(source: Mapping[str, Any]) -> dict[str, Any]:
    """Type-validate a size/mtime/checksum-shaped mapping the same way
    regardless of whether it came from a recorded-provenance source object
    or a live ``probe`` response: checksum must be ``str``, size/mtime must
    be ``int``/``float``, anything else (a probe returning a stringified
    size, say) is treated as absent rather than trusted or allowed to
    crash a downstream arithmetic summary."""
    raw_checksum = source.get("checksum")
    raw_mtime = source.get("mtime")
    raw_size = source.get("size")
    return {
        "checksum": raw_checksum if isinstance(raw_checksum, str) else None,
        "mtime": raw_mtime if isinstance(raw_mtime, (int, float)) else None,
        "size": raw_size if isinstance(raw_size, (int, float)) else None,
    }


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
    return None, path, _coerce_metadata(source_obj)


_ROW_WARNING_MESSAGES = {
    "renamed_collision": (
        "destination filename collided with another source and was renamed to avoid overwriting it"
    ),
    "renamed_unportable_name": (
        "source filename was not portable across platforms and was sanitized"
    ),
}


def _validate_project_name(project_name: str) -> tuple[str, str | None]:
    """Validate and sanitize ``project_name`` for use as ``<name>.dwk``.

    Raises ``ValueError`` for a path-traversal-shaped name (a path
    separator, or a literal ``..``) rather than silently mangling it — a
    project name must never smuggle a directory component into the
    bundle's own layout — and for a name that sanitizes down to nothing.
    Returns ``(sanitized_name, renamed_from)`` where ``renamed_from`` is
    the ORIGINAL name when sanitizing changed it, else ``None``.
    """
    if "/" in project_name or "\\" in project_name:
        raise ValueError(f"project name must not contain a path separator: {project_name!r}")
    if ".." in project_name:
        raise ValueError(f"project name must not contain '..': {project_name!r}")
    sanitized, reason = sanitize_component(project_name)
    if reason is not None and "empty" in reason:
        raise ValueError(f"project name is empty after sanitizing: {project_name!r}")
    renamed_from = project_name if sanitized != project_name else None
    return sanitized, renamed_from


def _project_file_name(sanitized_name: str) -> str:
    """``<sanitized_name>.dwk``, stripping a trailing ``.dwk`` (case-
    insensitive) first so ``"x.dwk"`` yields ``"x.dwk"``, never
    ``"x.dwk.dwk"``."""
    if sanitized_name.lower().endswith(".dwk"):
        sanitized_name = sanitized_name[: -len(".dwk")]
    return f"{sanitized_name}.dwk"


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
    :func:`quantized.portable.layout.path_key`), and never at all for a path
    ``consented`` rejects — see the module docstring's security section for
    exactly what each of ``probe``/``consented`` controls. See this module's
    own docstring for the full contract; the exact per-row and top-level
    field set is documented on ``plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md``
    P1.7's Pack Project subsection.

    Raises ``ValueError`` for a ``project_name`` shaped like a path-
    traversal attempt or that sanitizes down to nothing.
    """
    project_name_sanitized, project_renamed_from = _validate_project_name(project_name)
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
            groups[key] = {"spellings": set(), "members": []}
            group_order.append(key)
        groups[key]["spellings"].add(original_path)
        groups[key]["members"].append(
            {"dataset_id": dataset_id, "name": name, "recorded": recorded}
        )
        entry_index = len(dataset_entries)
        dataset_entries.append({"dataset_id": dataset_id, "name": name, "source_id": None})
        pending_source_key[entry_index] = key

    # Deterministic source order: `group_order` already holds each unique
    # path_key exactly once (in first-seen order), so sorting by the key
    # alone is fully deterministic -- no tiebreak needed.
    sorted_keys = sorted(group_order)
    source_id_of = {k: f"s{n + 1:03d}" for n, k in enumerate(sorted_keys)}
    for idx, key in pending_source_key.items():
        dataset_entries[idx]["source_id"] = source_id_of[key]

    rows: list[dict[str, Any]] = []
    for key in sorted_keys:
        group = groups[key]
        spellings: set[str] = group["spellings"]
        # Canonical spelling: the lexicographically-least member by
        # (NFC-normalized string, raw string) -- deterministic regardless
        # of which spelling happened to appear first in payload order.
        original_path = min(spellings, key=lambda p: (unicodedata.normalize("NFC", p), p))
        variants = sorted(spellings) if len(spellings) > 1 else []
        members = group["members"]
        row: dict[str, Any] = {
            "source_id": source_id_of[key],
            "original_path": original_path,
            "original_path_variants": variants,
            "members": members,
        }
        if _has_control_chars(original_path) or not _looks_absolute(original_path):
            row["status"] = "invalid"
            row["size"] = row["mtime"] = row["checksum"] = None
        elif not consented_fn(original_path):
            # Checked BEFORE `probe` is called at all: an unconsented path
            # is never handed to a probe implementation that may do real
            # I/O (review finding #8).
            row["status"] = "not_consented"
            row["size"] = row["mtime"] = row["checksum"] = None
        else:
            probed = probe(original_path)
            state = probed.get("state")
            status = state if state in _KNOWN_PROBE_STATES else "invalid"
            if status == "ok":
                coerced = _coerce_metadata(probed)
                row["size"] = coerced["size"]
                row["mtime"] = coerced["mtime"]
                row["checksum"] = coerced["checksum"]
            else:
                row["size"] = row["mtime"] = row["checksum"] = None
            row["status"] = status
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
    # idiom -- `dedupeWindowTitle`'s "Name", "Name (2)", ... shape; the
    # collision-safe planning itself lives in `naming.plan_bundle_names`,
    # see that module's docstring for why a naive one-group-at-a-time pass
    # is unsafe) ────────────────────────────────────────────────────────
    for row in rows:
        base_name, base_reason = sanitize_component(basename_of(row["original_path"]))
        row["_base_name"] = base_name
        row["_base_reason"] = base_reason

    final_name, collision_group_of = plan_bundle_names([row["_base_name"] for row in rows])

    final_rows: list[dict[str, Any]] = []
    seen_bundle_keys: set[str] = set()
    for idx, row in enumerate(rows):
        name = final_name[idx]
        bundle_path = f"{SOURCES_DIR}/{name}"
        if not is_bundle_relative(bundle_path):
            # A bug, not user input: `name` comes only from `sanitize_component`
            # on a basename that already has no separators in it.
            raise RuntimeError(f"planned bundle path is not bundle-relative: {bundle_path!r}")
        bundle_key = path_key(bundle_path)
        if bundle_key in seen_bundle_keys:
            # A bug in `naming.plan_bundle_names`, not user input -- see
            # that module's docstring; asserted here as the defense-in-
            # depth outcome check (review finding #1).
            raise RuntimeError(f"duplicate planned bundle_path: {bundle_path!r}")
        seen_bundle_keys.add(bundle_key)
        original_basename = basename_of(row["original_path"])
        is_collision_rename = idx in collision_group_of and name != row["_base_name"]
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
                "original_path_variants": row["original_path_variants"],
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
            "name": project_name_sanitized,
            "project_file": _project_file_name(project_name_sanitized),
            "workspace_format": payload.get("format"),
            "workspace_version": payload.get("version"),
            "renamed_from": project_renamed_from,
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
