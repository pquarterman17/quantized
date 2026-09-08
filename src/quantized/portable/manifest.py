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

## Grouping vs collapsing sources (PR #305 review fix)

Two datasets share ONE source row only when their ``source.path`` strings
are either (a) byte-identical, or (b) PROVEN to name the same physical file
by filesystem identity — never merely because they FOLD to the same
:func:`quantized.portable.layout.path_key` (case/Unicode-normalization-form/
separator differences). ``probe``/``consented`` are invoked at most once
per DISTINCT exact spelling — never once per folded key — and two spellings
collapse into one row only after both classify as ``"ok"`` and report the
identical, non-zero ``(dev, ino)`` pair :func:`quantized.desktop_source_probe
.probe_source_path` returns. A group that is NOT provably one file stays
its own row even when its ``path_key`` collides with another's; the
existing collision-suffix machinery in :mod:`quantized.portable.naming`
then gives the two rows visibly distinct bundle destinations instead of
silently sharing one. See :mod:`quantized.portable.grouping` for the full
mechanism and rationale — this is where the actual dedup/collapse logic
lives, split out to keep this module under the repo's line ceiling.

**Downstream note (for the future "PR 3" project-rewrite work):** anything
that maps a dataset back onto a manifest row (e.g. a future
``project_rewrite.rewrite_payload_for_bundle``) MUST match by exact
``original_path`` OR membership in ``original_path_variants`` — never by
folded ``path_key`` — for the identical reason: two case/separator variants
sharing a folded key are not guaranteed to be the same file.

## Determinism

No timestamps, no randomness, no reliance on dict/set iteration order that
isn't itself derived from a sort: the same ``payload`` plus the same
``probe``/``consented`` responses must produce byte-identical
:func:`manifest_json` output on every run, on every platform, regardless of
the order datasets happen to appear in ``payload`` (aside from
``datasets``/``shared_by``, which intentionally preserve payload order —
see their fields' own notes below) OR the spelling (case, Unicode
normalization form) two datasets happen to use for what turns out — via
filesystem identity, never a folded key alone — to be the same original
path — a merged row's ``original_path`` is always the CANONICAL spelling
(the lexicographically-least member by ``(NFC-normalized string, raw
string)``, never whichever spelling happened to appear first in payload
order), with every other distinct spelling recorded in
``original_path_variants``. Source rows are sorted by
``(path_key(original_path), original_path)`` — the exact-path tiebreak
matters now that two rows can share a folded key without collapsing. This
is what lets ``tools/freeze_portable_manifest.py`` commit a fixture that
``tests/test_portable_manifest_fixture.py`` can byte-compare forever.
"""

from __future__ import annotations

import json
import ntpath  # noqa: F401 -- see comment below
import posixpath  # noqa: F401 -- see comment below
from collections.abc import Mapping
from typing import Any

from .grouping import (
    Consented,
    Probe,
    _coerce_metadata,
    _looks_absolute,  # noqa: F401
    group_and_collapse_sources,
)
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

# `ntpath`/`posixpath` are unused directly in this module now (the
# absolute-path shape check moved to `grouping._probe_row_status`), and
# `_looks_absolute` above is imported only to re-export it -- all three are
# kept here purely so `tests/test_portable_manifest.py`'s existing
# `manifest_module.ntpath` / `manifest_module.posixpath` /
# `manifest_module._looks_absolute` references keep resolving without
# changing those tests.


def _default_consented(_path: str) -> bool:
    return True


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
    ``probe`` is called at most once per DISTINCT exact original-path
    spelling — never once per folded :func:`quantized.portable.layout
    .path_key` (see this module's own docstring for why that distinction
    is the whole point of the PR #305 review fix), and never at all for a
    path ``consented`` rejects — see the module docstring's security
    section for exactly what each of ``probe``/``consented`` controls. See
    this module's own docstring for the full contract; the exact per-row
    and top-level field set is documented on
    ``plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`` P1.7's Pack Project
    subsection.

    Raises ``ValueError`` for a ``project_name`` shaped like a path-
    traversal attempt or that sanitizes down to nothing.
    """
    project_name_sanitized, project_renamed_from = _validate_project_name(project_name)
    consented_fn = consented if consented is not None else _default_consented
    datasets_raw = payload.get("datasets")
    datasets_list = datasets_raw if isinstance(datasets_raw, list) else []

    dataset_entries: list[dict[str, Any]] = []
    # Grouped by the EXACT original-path string -- never a folded
    # `path_key` -- so a case/separator/Unicode-normalization variant is
    # its own group until proven (by filesystem identity, in
    # `grouping.group_and_collapse_sources`) to name the same file as
    # another spelling. See the module docstring's "Grouping vs collapsing
    # sources" section.
    spellings_in_order: list[str] = []
    members_by_spelling: dict[str, list[dict[str, Any]]] = {}
    pending_spelling: dict[int, str] = {}

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
        if original_path not in members_by_spelling:
            members_by_spelling[original_path] = []
            spellings_in_order.append(original_path)
        # `_payload_index` is internal to the grouping step only -- it is
        # what lets `group_and_collapse_sources` restore original payload
        # order for `shared_by` after merging members from more than one
        # spelling's group; it is never exposed in the manifest itself.
        members_by_spelling[original_path].append(
            {"dataset_id": dataset_id, "name": name, "recorded": recorded, "_payload_index": i}
        )
        entry_index = len(dataset_entries)
        dataset_entries.append({"dataset_id": dataset_id, "name": name, "source_id": None})
        pending_spelling[entry_index] = original_path

    grouped = group_and_collapse_sources(
        spellings_in_order, members_by_spelling, probe, consented_fn
    )

    # Deterministic source order: `(path_key(original_path), original_path)`
    # -- two DIFFERENT spellings can now share a folded `path_key` without
    # having collapsed into one row (that is the whole point of the fix),
    # so the key alone is no longer a sufficient tiebreak.
    grouped.sort(key=lambda r: (path_key(r["original_path"]), r["original_path"]))

    rows: list[dict[str, Any]] = []
    source_id_of_spelling: dict[str, str] = {}
    for n, group_row in enumerate(grouped):
        source_id = f"s{n + 1:03d}"
        rows.append({"source_id": source_id, **group_row})
        member_spellings = group_row["original_path_variants"] or [group_row["original_path"]]
        for spelling in member_spellings:
            source_id_of_spelling[spelling] = source_id

    for idx, spelling in pending_spelling.items():
        dataset_entries[idx]["source_id"] = source_id_of_spelling[spelling]

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
