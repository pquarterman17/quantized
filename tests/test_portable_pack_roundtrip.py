"""End-to-end ``quantized.portable.pack.pack_project`` tests (P1.7 "Pack
Project" PR 3): pack -> move the whole bundle elsewhere -> reopen, plus the
"never touch the originals" and "old workspace version" guarantees.

Unit tests for the individual pieces (``finalize_manifest``,
``write_bundle_files``, ``publish_bundle``, ``validate_bundle``) live in
``tests/test_portable_publish.py``; ``base_dir`` resolution on
``declared_source_paths_of``/``extract_declared_source_paths``/
``payload_declares_source`` lives in ``tests/test_desktop_project_file.py``.
This file exercises the whole pipeline the way a real "Pack Project" click
would, plus ``resolve_bundle_source`` on its own.
"""

from __future__ import annotations

import copy
import errno
import hashlib
import json
import ntpath
import os
import posixpath
import shutil
from pathlib import Path
from typing import Any

import pytest

from quantized.desktop_project_file import declared_source_paths_of, extract_declared_source_paths
from quantized.desktop_source_probe import probe_source_path
from quantized.portable.manifest import build_dry_run_manifest
from quantized.portable.pack import pack_project
from quantized.portable.project_rewrite import resolve_bundle_source
from quantized.portable.publish import validate_bundle

_PACKED_AT = "2026-09-06T00:00:00Z"


def _probe(path: str) -> dict[str, Any]:
    return dict(probe_source_path(path, compute_checksum=True))


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _strip_sources(payload: dict[str, Any]) -> dict[str, Any]:
    """Deep-copy ``payload`` with every ``datasets[i].source`` removed, for
    a byte-equality comparison of everything a pack must never touch."""
    stripped = copy.deepcopy(payload)
    for ds in stripped.get("datasets", []):
        if isinstance(ds, dict):
            ds.pop("source", None)
    return stripped


def _bundle_parent(tmp_path: Path) -> Path:
    parent = tmp_path / "bundle_parent"
    parent.mkdir(exist_ok=True)
    return parent


# ── pack -> move -> reopen ───────────────────────────────────────────────


def test_pack_move_and_reopen_roundtrip(tmp_path: Path) -> None:
    shared_file = tmp_path / "shared_dir" / "shared.csv"
    shared_file.parent.mkdir()
    shared_file.write_bytes(b"shared-bytes")

    run_file = tmp_path / "dir_a" / "run.csv"
    run_file.parent.mkdir()
    run_file.write_bytes(b"run-a-bytes")

    run_variant_file = tmp_path / "dir_b" / "RUN.csv"
    run_variant_file.parent.mkdir()
    run_variant_file.write_bytes(b"run-b-bytes-different")

    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "corrections": {"applied": ["baseline"]},
        "figures": [{"id": "fig1", "title": "Figure 1"}],
        "datasets": [
            {"id": "d0", "name": "shared-a", "source": {"kind": "path", "path": str(shared_file)}},
            {"id": "d1", "name": "shared-b", "source": {"kind": "path", "path": str(shared_file)}},
            {"id": "d2", "name": "run-a", "source": {"kind": "path", "path": str(run_file)}},
            {
                "id": "d3",
                "name": "run-b",
                "source": {"kind": "path", "path": str(run_variant_file)},
            },
        ],
    }
    original_checksums = {
        str(shared_file): _sha256(str(shared_file)),
        str(run_file): _sha256(str(run_file)),
        str(run_variant_file): _sha256(str(run_variant_file)),
    }

    destination = str(_bundle_parent(tmp_path) / "packed_bundle")
    result = pack_project(payload, "myproj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is True, result.errors
    assert result.bundle_dir == destination

    moved = str(tmp_path / "moved_elsewhere")
    shutil.move(destination, moved)

    check = validate_bundle(moved)
    assert check.complete is True, check.problems

    project_file = check.manifest["project"]["project_file"]  # type: ignore[index]
    packed_content = Path(moved, project_file).read_text(encoding="utf-8")
    packed_payload = json.loads(packed_content)

    # non-source content is byte-for-byte identical
    assert json.dumps(_strip_sources(packed_payload), sort_keys=True) == json.dumps(
        _strip_sources(payload), sort_keys=True
    )

    resolved_paths = extract_declared_source_paths(packed_content, base_dir=moved)
    assert len(resolved_paths) == 4  # one per dataset, shared path repeated
    for resolved in resolved_paths:
        assert os.path.isfile(resolved)
        assert resolved.startswith(moved)

    # each resolved copy hashes identically to its ORIGINAL source
    ds_by_id = {ds["id"]: ds for ds in packed_payload["datasets"]}
    for ds_id, original_path in (
        ("d0", str(shared_file)),
        ("d1", str(shared_file)),
        ("d2", str(run_file)),
        ("d3", str(run_variant_file)),
    ):
        source = ds_by_id[ds_id]["source"]
        assert source["kind"] == "bundle"
        resolved = resolve_bundle_source(moved, source["path"])
        assert resolved is not None
        assert _sha256(resolved) == original_checksums[original_path]
        assert source["checksum"] == original_checksums[original_path]

    # the two colliding "run"/"RUN" sources landed at two DIFFERENT bundle paths
    assert ds_by_id["d2"]["source"]["path"] != ds_by_id["d3"]["source"]["path"]
    # the shared source really is shared: same bundle path for both datasets
    assert ds_by_id["d0"]["source"]["path"] == ds_by_id["d1"]["source"]["path"]


def test_rewritten_bundle_source_provenance_survives_parse_workspace_payload(
    tmp_path: Path,
) -> None:
    """P1.7 PR 5 audit item 9 (backend half): `rewrite_payload_for_bundle`
    writes `checksum`/`size`/`packedFrom` unconditionally and `mtime` when
    resolvable (see that module's own source) onto every packed dataset's
    rewritten `kind: "bundle"` source -- this proves all four actually
    survive the REAL production path a reopen takes: read the published
    `.dwk`'s bytes off disk, then `parse_workspace_payload` (not a bare
    `json.loads`, which `test_pack_move_and_reopen_roundtrip` above already
    uses for its own, narrower checksum-only check) -- the same function
    `desktop_bridge_dialogs._read_granted` calls on every real project
    open/reopen."""
    from quantized.desktop_project_file import parse_workspace_payload

    src = tmp_path / "raw.csv"
    src.write_bytes(b"provenance-bytes")
    original_mtime = os.stat(src).st_mtime
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")
    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)
    assert result.ok is True, result.errors

    project_file = result.manifest["project"]["project_file"]  # type: ignore[index]
    packed_content = Path(destination, project_file).read_text(encoding="utf-8")

    parsed, error = parse_workspace_payload(packed_content)
    assert parsed is not None, error
    source = parsed["datasets"][0]["source"]

    assert source["kind"] == "bundle"
    assert source["checksum"] == _sha256(str(src))
    assert source["size"] == len(b"provenance-bytes")
    assert source["packedFrom"] == str(src)
    assert source["mtime"] == pytest.approx(original_mtime)


def test_pack_never_touches_the_originals(tmp_path: Path) -> None:
    src = tmp_path / "raw.csv"
    src.write_bytes(b"do-not-touch")
    before_hash = _sha256(str(src))
    before_mtime = os.stat(src).st_mtime

    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")
    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is True
    assert result.originals_modified is False
    assert _sha256(str(src)) == before_hash
    assert os.stat(src).st_mtime == before_mtime


# ── interrupted publication ──────────────────────────────────────────────


def test_pack_project_interrupted_publish_leaves_no_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = tmp_path / "raw.csv"
    src.write_bytes(b"data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")

    def _boom(_src: str, _dst: str) -> None:
        raise OSError("Permission denied")

    # The primary rename path is `rename_noreplace`'s platform primitive,
    # not a bare `os.rename` call in `publish.py` -- force the failure at
    # that seam instead (see `test_portable_publish.py` for the same
    # pattern against `publish_bundle` directly).
    monkeypatch.setattr(
        "quantized.portable.atomic_rename._platform_rename_noreplace", _boom
    )
    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is False
    assert result.errors[0]["code"] == "publish_failed"
    assert result.no_replace == "atomic"
    assert result.originals_modified is False
    assert not os.path.exists(destination)
    assert result.cleanup_ok is True
    # nothing left over in bundle_parent besides nothing (staging cleaned)
    assert list(_bundle_parent(tmp_path).iterdir()) == []


# ── mixed dataset shapes ─────────────────────────────────────────────────


def test_pack_project_mixed_dataset_shapes(tmp_path: Path) -> None:
    packable = tmp_path / "packable.csv"
    packable.write_bytes(b"data")
    missing = str(tmp_path / "does-not-exist.csv")

    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [
            {"id": "embedded", "name": "embedded", "values": [1, 2, 3]},
            {"id": "uploaded", "name": "uploaded", "source": {"kind": "upload"}},
            {
                "id": "packable",
                "name": "packable",
                "source": {"kind": "path", "path": str(packable)},
            },
            {"id": "missing", "name": "missing", "source": {"kind": "path", "path": missing}},
        ],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")
    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is True, result.errors
    check = validate_bundle(destination)
    assert check.complete is True

    project_file = check.manifest["project"]["project_file"]  # type: ignore[index]
    packed_payload = json.loads(Path(destination, project_file).read_text(encoding="utf-8"))
    ds_by_id = {ds["id"]: ds for ds in packed_payload["datasets"]}

    assert "source" not in ds_by_id["embedded"]
    assert ds_by_id["uploaded"]["source"] == {"kind": "upload"}
    assert ds_by_id["packable"]["source"]["kind"] == "bundle"
    # the missing source stays untouched -- still absolute, still "kind": "path"
    assert ds_by_id["missing"]["source"] == {"kind": "path", "path": missing}

    manifest_rows = {r["original_path"]: r for r in check.manifest["sources"]}  # type: ignore[index]
    assert manifest_rows[str(packable)]["packable"] is True
    assert manifest_rows[missing]["packable"] is False


def _case_sensitive(directory: Path) -> bool:
    probe_upper = directory / "CaseProbe.tmp"
    probe_upper.write_bytes(b"")
    try:
        return not (directory / "caseprobe.tmp").exists()
    finally:
        probe_upper.unlink()


def test_pack_project_keeps_case_variant_files_distinct(tmp_path: Path) -> None:
    """PR #305 review, carried through to the rewrite: on a case-sensitive
    filesystem ``A.csv`` and ``a.csv`` are two files. The manifest keeps
    them as two rows (different ``(dev, ino)``), staging copies both under
    visibly distinct bundle names, and the rewrite maps EACH dataset onto
    ITS OWN row by exact path -- never onto whichever row shares its folded
    ``path_key``."""
    if not _case_sensitive(tmp_path):
        pytest.skip("case-insensitive filesystem: A.csv and a.csv are one file")
    upper = tmp_path / "A.csv"
    lower = tmp_path / "a.csv"
    upper.write_bytes(b"UPPER")
    lower.write_bytes(b"lower")

    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [
            {"id": "u", "name": "u", "source": {"kind": "path", "path": str(upper)}},
            {"id": "l", "name": "l", "source": {"kind": "path", "path": str(lower)}},
        ],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")
    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is True, result.errors
    check = validate_bundle(destination, verify_checksums=True)
    assert check.complete is True, check.problems
    rows = {r["original_path"]: r for r in check.manifest["sources"]}  # type: ignore[index]
    assert set(rows) == {str(upper), str(lower)}
    assert rows[str(upper)]["bundle_path"] != rows[str(lower)]["bundle_path"]

    project_file = check.manifest["project"]["project_file"]  # type: ignore[index]
    packed = json.loads(Path(destination, project_file).read_text(encoding="utf-8"))
    ds_by_id = {ds["id"]: ds for ds in packed["datasets"]}
    for ds_id, original in (("u", upper), ("l", lower)):
        source = ds_by_id[ds_id]["source"]
        assert source["kind"] == "bundle"
        assert source["packedFrom"] == str(original)
        assert source["path"] == rows[str(original)]["bundle_path"]
        copied = Path(destination, *source["path"].split("/"))
        assert copied.read_bytes() == original.read_bytes()


# ── old workspace versions ───────────────────────────────────────────────


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_pack_project_rewrites_and_validates_every_supported_workspace_version(
    tmp_path: Path, version: int
) -> None:
    src = tmp_path / f"v{version}.csv"
    src.write_bytes(b"versioned-data")
    payload = {
        "format": "quantized-workspace",
        "version": version,
        "datasets": [
            {"id": "d0", "name": "d", "source": {"kind": "path", "path": str(src)}},
        ],
    }
    destination = str(_bundle_parent(tmp_path) / f"bundle_v{version}")
    result = pack_project(
        payload, f"projv{version}", destination, probe=_probe, packed_at=_PACKED_AT
    )

    assert result.ok is True, result.errors
    check = validate_bundle(destination)
    assert check.complete is True
    assert check.manifest["project"]["workspace_version"] == version  # type: ignore[index]


# ── existing destination ─────────────────────────────────────────────────


def test_pack_project_refuses_an_existing_destination(tmp_path: Path) -> None:
    src = tmp_path / "raw.csv"
    src.write_bytes(b"data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination_dir = _bundle_parent(tmp_path) / "bundle"
    destination_dir.mkdir()
    (destination_dir / "keepme.txt").write_text("pre-existing")

    result = pack_project(
        payload, "proj", str(destination_dir), probe=_probe, packed_at=_PACKED_AT
    )

    assert result.ok is False
    assert result.errors[0]["code"] == "destination_exists"
    # destination is completely untouched
    assert [p.name for p in destination_dir.iterdir()] == ["keepme.txt"]
    for error in result.errors:
        assert str(tmp_path) not in json.dumps(error)


def test_pack_project_refuses_an_existing_destination_before_staging_anything(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review finding #5: the existing-destination refusal must happen
    BEFORE any staging directory is created — every source is copied and
    checksummed into staging first otherwise, only to be thrown away by a
    check this cheap. Pinned by making `create_staging_dir` itself fail the
    test if it is ever called."""
    src = tmp_path / "raw.csv"
    src.write_bytes(b"data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination_dir = _bundle_parent(tmp_path) / "bundle"
    destination_dir.mkdir()

    def _must_not_be_called(_parent_dir: str) -> str:
        pytest.fail("create_staging_dir was called after an existing destination should refuse")

    monkeypatch.setattr("quantized.portable.pack.create_staging_dir", _must_not_be_called)

    result = pack_project(
        payload, "proj", str(destination_dir), probe=_probe, packed_at=_PACKED_AT
    )

    assert result.ok is False
    assert result.errors[0]["code"] == "destination_exists"
    # nothing at all appeared beside the pre-existing (empty) destination
    assert list(_bundle_parent(tmp_path).iterdir()) == [destination_dir]


# ── an approved manifest executes verbatim (PR #308 review) ──────────────


def test_pack_project_with_an_explicit_manifest_never_rebuilds_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR #308 review: when a caller supplies an already-approved dry-run
    ``manifest=``, ``pack_project`` must execute it VERBATIM and never call
    ``build_dry_run_manifest`` again -- pinned here by making that function
    raise if it is ever called at all once the explicit manifest is
    supplied. The bundle produced this way is identical (same rewritten
    payload content, same packed checksum/size/bundle path) to the bundle
    the ordinary rebuild path produces for the same inputs when nothing
    changed in between."""
    src = tmp_path / "raw.csv"
    src.write_bytes(b"pack-me")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }

    approved_manifest = build_dry_run_manifest(payload, "proj", _probe)
    assert approved_manifest["summary"]["packable"] == 1

    rebuilt_destination = str(_bundle_parent(tmp_path) / "rebuilt")
    rebuilt = pack_project(payload, "proj", rebuilt_destination, probe=_probe, packed_at=_PACKED_AT)
    assert rebuilt.ok is True, rebuilt.errors

    def _must_not_be_called(*_args: Any, **_kw: Any) -> Any:
        pytest.fail("build_dry_run_manifest was called despite an explicit manifest= being given")

    monkeypatch.setattr("quantized.portable.pack.build_dry_run_manifest", _must_not_be_called)

    explicit_destination = str(_bundle_parent(tmp_path) / "explicit")
    explicit = pack_project(
        payload,
        "proj",
        explicit_destination,
        probe=_probe,
        manifest=approved_manifest,
        packed_at=_PACKED_AT,
    )
    assert explicit.ok is True, explicit.errors

    rebuilt_check = validate_bundle(rebuilt_destination, verify_checksums=True)
    explicit_check = validate_bundle(explicit_destination, verify_checksums=True)
    assert rebuilt_check.complete, rebuilt_check.problems
    assert explicit_check.complete, explicit_check.problems

    rebuilt_project_file = rebuilt_check.manifest["project"]["project_file"]  # type: ignore[index]
    explicit_project_file = explicit_check.manifest["project"]["project_file"]  # type: ignore[index]
    assert rebuilt_project_file == explicit_project_file
    rebuilt_payload = json.loads(
        Path(rebuilt_destination, rebuilt_project_file).read_text(encoding="utf-8")
    )
    explicit_payload = json.loads(
        Path(explicit_destination, explicit_project_file).read_text(encoding="utf-8")
    )
    assert json.dumps(_strip_sources(rebuilt_payload), sort_keys=True) == json.dumps(
        _strip_sources(explicit_payload), sort_keys=True
    )
    rebuilt_source = rebuilt_payload["datasets"][0]["source"]
    explicit_source = explicit_payload["datasets"][0]["source"]
    assert rebuilt_source["kind"] == explicit_source["kind"] == "bundle"
    assert rebuilt_source["path"] == explicit_source["path"]
    assert rebuilt_source["checksum"] == explicit_source["checksum"]
    assert rebuilt_source["size"] == explicit_source["size"]


# ── staging-directory creation failures (review finding #3) ──────────────


def test_pack_project_staging_dir_oserror_is_a_structured_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`tempfile.mkdtemp` (inside `create_staging_dir`) can raise `OSError`
    for reasons that have nothing to do with an invalid `parent_dir` (a
    read-only parent, a full disk) — `create_staging_dir` only ever raises
    `ValueError` of its own accord, so this is a genuinely different
    failure class that must not escape `pack_project` uncaught."""
    src = tmp_path / "raw.csv"
    src.write_bytes(b"data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")

    def _boom(*_args: object, **_kwargs: object) -> str:
        raise PermissionError(13, "Permission denied", "/some/secret/parent/path")

    monkeypatch.setattr("quantized.portable.staging.tempfile.mkdtemp", _boom)

    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is False
    assert result.errors[0]["code"] == "staging_failed"
    # the message is `strerror` only -- never the path PermissionError's
    # own `str()` would include.
    assert "Permission denied" in result.errors[0]["message"]
    assert "/some/secret/parent/path" not in result.errors[0]["message"]
    assert not os.path.exists(destination)


# ── write_bundle_files failures are path-free (PR #307 review) ───────────


def test_pack_project_write_bundle_files_oserror_message_is_path_free(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review finding (PR #307): a real ``write_bundle_files`` failure (a
    permission error, a full disk) raises an ``OSError`` whose ``str()``
    embeds ``exc.filename`` -- the absolute staging path.
    ``PackResult.errors[*]["message"]`` must contain neither that staging
    path nor the destination path."""
    src = tmp_path / "raw.csv"
    src.write_bytes(b"data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")
    staging_sibling = str(tmp_path / "bundle_parent" / ".qz-staging-oserror-secret")

    def _boom(*_args: object, **_kwargs: object) -> None:
        secret_path = os.path.join(staging_sibling, "quantized-bundle.json")
        raise OSError(errno.EACCES, "Permission denied", secret_path)

    monkeypatch.setattr("quantized.portable.pack.write_bundle_files", _boom)

    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is False
    assert result.errors[0]["code"] == "write_failed"
    message = result.errors[0]["message"]
    assert staging_sibling not in message
    assert destination not in message
    assert str(tmp_path) not in message
    assert "Permission denied" in message
    assert not os.path.exists(destination)


def test_pack_project_atomic_replace_oserror_message_is_path_free(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review finding #6: ``atomic_replace_file``'s own ``os.replace`` call
    (inside ``write_bundle_files``) raises an ``OSError`` that embeds BOTH
    the absolute staging temp path and the final bundle-file path it was
    given (``.filename``/``.filename2``) -- ``write_failed`` must report
    only the OS's own errno text (``safe_os_error``), never those paths."""
    src = tmp_path / "raw.csv"
    src.write_bytes(b"data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")

    def _boom(tmp: str, dest: str) -> None:
        raise OSError(13, "Permission denied", tmp, None, dest)

    monkeypatch.setattr("quantized.portable.publish.os.replace", _boom)

    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is False
    assert result.errors[0]["code"] == "write_failed"
    message = result.errors[0]["message"]
    assert message == "Permission denied"
    assert str(tmp_path) not in message
    assert destination not in message
    assert not os.path.exists(destination)
    # staging cleaned up -- nothing left in the bundle's parent directory
    assert list(_bundle_parent(tmp_path).iterdir()) == []


# ── payload/manifest serialization failures (review finding #3) ──────────
#
# A payload with a literally non-JSON-serializable value (raw `bytes`)
# fails EARLIER, inside `rewrite_payload_for_bundle`'s own re-validation
# `json.dumps` call (a separate, pre-existing `ValueError`-only guard in
# `pack_project` — out of scope for this finding, which is specifically
# about `write_bundle_files`'s own `json.dumps`/`manifest_json` calls), so
# these two tests monkeypatch each of THOSE call sites directly to pin the
# guard this finding actually adds.


def test_pack_project_payload_serialization_failure_is_a_structured_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`_dumps(rewritten_payload)` (evaluated as part of the call to
    `write_bundle_files`) raising `TypeError`/`ValueError` must come back
    as a structured `PackResult`, not an uncaught exception -- and the
    staging directory it got partway through must be cleaned up, never
    left behind."""
    src = tmp_path / "raw.csv"
    src.write_bytes(b"data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")

    def _boom(_payload: dict[str, Any]) -> str:
        raise TypeError("Object of type bytes is not JSON serializable")

    monkeypatch.setattr("quantized.portable.pack._dumps", _boom)

    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is False
    assert result.errors[0]["code"] == "serialize_failed"
    assert not os.path.exists(destination)
    # staging cleaned up -- nothing left in the bundle's parent directory
    assert list(_bundle_parent(tmp_path).iterdir()) == []


def test_pack_project_manifest_serialization_failure_is_a_structured_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The other call site the same guard covers:
    `write_bundle_files`'s own `manifest_json(manifest)` call, deep inside
    `quantized.portable.publish`."""
    src = tmp_path / "raw.csv"
    src.write_bytes(b"data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "raw", "source": {"kind": "path", "path": str(src)}}],
    }
    destination = str(_bundle_parent(tmp_path) / "bundle")

    def _boom(_manifest: dict[str, Any]) -> str:
        raise TypeError("manifest contains a non-serializable value")

    monkeypatch.setattr("quantized.portable.publish.manifest_json", _boom)

    result = pack_project(payload, "proj", destination, probe=_probe, packed_at=_PACKED_AT)

    assert result.ok is False
    assert result.errors[0]["code"] == "serialize_failed"
    assert not os.path.exists(destination)
    assert list(_bundle_parent(tmp_path).iterdir()) == []


# ── resolve_bundle_source: Windows and POSIX resolution ──────────────────


def test_resolve_bundle_source_posix() -> None:
    # Force POSIX semantics explicitly regardless of host platform.
    from quantized.portable import layout

    assert posixpath.join("/proj", "sources", "a.csv") == "/proj/sources/a.csv"
    resolved = layout.join_bundle_path("/proj", "sources/a.csv")
    assert resolved == os.path.join("/proj", "sources", "a.csv")


def test_resolve_bundle_source_windows_drive_root() -> None:
    from quantized.portable import layout

    # ntpath.join is used here only to state the EXPECTED shape explicitly;
    # `join_bundle_path` itself always uses the host's os.path, so this
    # assertion documents the Windows behaviour rather than exercising it
    # (this test suite runs on POSIX in CI).
    expected = ntpath.join("C:\\proj", "sources", "a.csv")
    assert expected == "C:\\proj\\sources\\a.csv"
    # `is_bundle_relative` itself is platform-independent (pure string
    # rules) -- confirm the bundle-relative shape is accepted regardless.
    assert layout.is_bundle_relative("sources/a.csv")


def test_resolve_bundle_source_rejects_relative_escape(tmp_path: Path) -> None:
    assert resolve_bundle_source(str(tmp_path), "../escape.csv") is None
    assert resolve_bundle_source(str(tmp_path), "sources/../../escape.csv") is None


def test_resolve_bundle_source_rejects_absolute_or_drive_paths(tmp_path: Path) -> None:
    assert resolve_bundle_source(str(tmp_path), "/etc/passwd") is None
    assert resolve_bundle_source(str(tmp_path), "C:\\evil.csv") is None


# ── declared-source resolution with a hand-edited relative escape ────────


def test_extract_declared_source_paths_skips_a_hand_edited_escape(tmp_path: Path) -> None:
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "source": {"kind": "bundle", "path": "../escape.csv"}}],
    }
    content = json.dumps(payload)
    assert extract_declared_source_paths(content, base_dir=str(tmp_path)) == []
    assert declared_source_paths_of(payload, base_dir=str(tmp_path)) == []

# `payload_declares_source` with a bundle source + `base_dir` is covered
# directly in `tests/test_desktop_project_file.py` alongside its other
# `base_dir` coverage.
