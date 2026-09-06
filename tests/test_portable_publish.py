"""Unit tests for ``quantized.portable.publish`` (P1.7 "Pack Project" PR 3):
``finalize_manifest``, ``write_bundle_files``, ``publish_bundle``, and
``validate_bundle``. End-to-end pack -> move -> reopen coverage lives in
``tests/test_portable_pack_roundtrip.py``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from quantized.desktop_source_probe import probe_source_path
from quantized.portable.layout import MANIFEST_FILENAME
from quantized.portable.manifest import build_dry_run_manifest, manifest_json
from quantized.portable.publish import (
    atomic_replace_file,
    finalize_manifest,
    publish_bundle,
    validate_bundle,
    write_bundle_files,
)
from quantized.portable.staging import create_staging_dir, stage_sources


def _probe(path: str) -> dict[str, Any]:
    return dict(probe_source_path(path, compute_checksum=True))


def _manifest_for(paths: list[str], project_name: str = "proj") -> dict[str, Any]:
    datasets = [
        {"id": f"d{i}", "name": Path(p).name, "source": {"kind": "path", "path": p}}
        for i, p in enumerate(paths)
    ]
    payload = {"format": "quantized-workspace", "version": 4, "datasets": datasets}
    return build_dry_run_manifest(payload, project_name, _probe)


def _staging_root(tmp_path: Path) -> str:
    return create_staging_dir(str(_bundle_parent(tmp_path)))


def _bundle_parent(tmp_path: Path) -> Path:
    parent = tmp_path / "bundle_parent"
    parent.mkdir(exist_ok=True)
    return parent


def _stage(tmp_path: Path, paths: list[str], project_name: str = "proj") -> tuple[dict, list, str]:
    manifest = _manifest_for(paths, project_name)
    staging_root = _staging_root(tmp_path)
    result = stage_sources(manifest, staging_root, probe=_probe)
    assert result.ok, result.errors
    return manifest, result.staged, staging_root


# ── finalize_manifest ────────────────────────────────────────────────────


def test_finalize_manifest_marks_packed_rows_and_flips_dry_run(tmp_path: Path) -> None:
    src = tmp_path / "a.csv"
    src.write_bytes(b"hello")
    manifest, staged, _ = _stage(tmp_path, [str(src)])

    final = finalize_manifest(manifest, staged, packed_at="2026-09-06T00:00:00Z")

    assert final["dry_run"] is False
    assert final["packed_at"] == "2026-09-06T00:00:00Z"
    assert final["summary"]["packed"] == 1
    row = final["sources"][0]
    assert row["packed"] == {"checksum": staged[0].checksum, "bytes": staged[0].bytes}
    # the dry-run manifest itself is untouched
    assert manifest["dry_run"] is True
    assert "packed" not in manifest["sources"][0]


def test_finalize_manifest_nulls_packed_for_unstaged_rows(tmp_path: Path) -> None:
    missing = tmp_path / "does-not-exist.csv"
    manifest = _manifest_for([str(missing)])
    final = finalize_manifest(manifest, [], packed_at="2026-01-01T00:00:00Z")
    assert final["summary"]["packed"] == 0
    assert final["sources"][0]["packed"] is None


# ── write_bundle_files ───────────────────────────────────────────────────


def test_write_bundle_files_writes_project_then_manifest(tmp_path: Path) -> None:
    src = tmp_path / "a.csv"
    src.write_bytes(b"hello")
    manifest, staged, staging_root = _stage(tmp_path, [str(src)])
    final = finalize_manifest(manifest, staged, packed_at="2026-01-01T00:00:00Z")
    payload_json = json.dumps({"format": "quantized-workspace", "version": 4, "datasets": []})

    write_bundle_files(
        staging_root,
        project_file="proj.dwk",
        packed_payload_json=payload_json,
        manifest=final,
    )

    assert (Path(staging_root) / "proj.dwk").read_text(encoding="utf-8") == payload_json
    on_disk = json.loads((Path(staging_root) / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    assert on_disk["dry_run"] is False
    # no stray temp files left behind
    leftovers = [p.name for p in Path(staging_root).iterdir() if p.name.startswith(".qz-write-")]
    assert leftovers == []


def test_write_bundle_files_refuses_to_overwrite_an_existing_project_file(tmp_path: Path) -> None:
    staging_root = _staging_root(tmp_path)
    (Path(staging_root) / "proj.dwk").write_text("already here")
    with pytest.raises(FileExistsError):
        write_bundle_files(
            staging_root,
            project_file="proj.dwk",
            packed_payload_json="{}",
            manifest={"format": "quantized-portable-bundle", "manifest_version": 1},
        )


# ── publish_bundle ───────────────────────────────────────────────────────


def _write_complete_staging(tmp_path: Path, name: str = "proj") -> tuple[str, str]:
    """A staging dir with a project file + completion marker, ready to
    publish, plus the destination path it should publish to."""
    src = tmp_path / "a.csv"
    src.write_bytes(b"hello")
    manifest, staged, staging_root = _stage(tmp_path, [str(src)], name)
    final = finalize_manifest(manifest, staged, packed_at="2026-01-01T00:00:00Z")
    payload_json = json.dumps({"format": "quantized-workspace", "version": 4, "datasets": []})
    write_bundle_files(
        staging_root, project_file=f"{name}.dwk", packed_payload_json=payload_json, manifest=final
    )
    destination = str(_bundle_parent(tmp_path) / f"{name}_bundle")
    return staging_root, destination


def test_publish_bundle_renames_staging_into_place(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    result = publish_bundle(staging_root, destination)
    assert result.ok is True
    assert result.bundle_dir == destination
    assert result.cleanup_ok is None
    assert result.originals_modified is False
    assert os.path.isdir(destination)
    assert not os.path.exists(staging_root)
    assert os.path.isfile(os.path.join(destination, MANIFEST_FILENAME))


def test_publish_bundle_refuses_an_existing_destination(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    os.makedirs(destination)
    result = publish_bundle(staging_root, destination)
    assert result.ok is False
    assert result.error is not None
    assert result.error["code"] == "destination_exists"
    assert result.cleanup_ok is True
    assert not os.path.exists(staging_root)
    # destination untouched (still an empty dir we made, not overwritten)
    assert os.listdir(destination) == []


def test_publish_bundle_refuses_a_non_sibling_destination(tmp_path: Path) -> None:
    staging_root, _ = _write_complete_staging(tmp_path)
    elsewhere = tmp_path / "elsewhere" / "proj_bundle"
    os.makedirs(elsewhere.parent)
    result = publish_bundle(staging_root, str(elsewhere))
    assert result.ok is False
    assert result.error is not None
    assert result.error["code"] == "invalid_destination"
    assert not os.path.exists(staging_root)
    assert not elsewhere.exists()


def test_publish_bundle_refuses_incomplete_staging_missing_marker(tmp_path: Path) -> None:
    staging_root = _staging_root(tmp_path)
    (Path(staging_root) / "proj.dwk").write_text("{}")
    # no quantized-bundle.json written -- simulates a crash before the marker
    destination = str(_bundle_parent(tmp_path) / "proj_bundle")
    result = publish_bundle(staging_root, destination)
    assert result.ok is False
    assert result.error is not None
    assert result.error["code"] == "incomplete_staging"
    assert not os.path.exists(destination)
    assert not os.path.exists(staging_root)


def test_publish_bundle_interrupted_rename_cleans_up_and_never_partially_publishes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)

    def _boom(_src: str, _dst: str) -> None:
        raise OSError("Permission denied")

    monkeypatch.setattr("quantized.portable.publish.os.rename", _boom)
    result = publish_bundle(staging_root, destination)

    assert result.ok is False
    assert result.error is not None
    assert result.error["code"] == "publish_failed"
    assert result.originals_modified is False
    assert not os.path.exists(destination)
    assert result.cleanup_ok is True
    assert not os.path.exists(staging_root)


# ── validate_bundle ──────────────────────────────────────────────────────


def test_validate_bundle_complete_bundle(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    check = validate_bundle(destination)
    assert check.complete is True
    assert check.problems == []
    assert check.manifest is not None


def test_validate_bundle_manifest_missing(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "empty_bundle"
    bundle_dir.mkdir()
    check = validate_bundle(str(bundle_dir))
    assert check.complete is False
    assert check.manifest is None
    assert check.problems == [{"code": "manifest_missing", "detail": MANIFEST_FILENAME}]


def test_validate_bundle_manifest_invalid_json(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "bad_bundle"
    bundle_dir.mkdir()
    (bundle_dir / MANIFEST_FILENAME).write_text("not json")
    check = validate_bundle(str(bundle_dir))
    assert check.complete is False
    assert check.manifest is None
    assert check.problems[0]["code"] == "manifest_invalid"


def test_validate_bundle_unsupported_manifest_version(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    manifest_path = Path(destination) / MANIFEST_FILENAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["manifest_version"] = 99
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    check = validate_bundle(destination)
    assert check.complete is False
    assert check.manifest is not None
    assert check.problems == [{"code": "unsupported_manifest_version", "detail": "99"}]


def test_validate_bundle_not_a_bundle(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "foreign"
    bundle_dir.mkdir()
    (bundle_dir / MANIFEST_FILENAME).write_text(json.dumps({"format": "something-else"}))
    check = validate_bundle(str(bundle_dir))
    assert check.complete is False
    assert check.problems[0]["code"] == "not_a_bundle"


def test_validate_bundle_dry_run_manifest_is_incomplete(tmp_path: Path) -> None:
    src = tmp_path / "a.csv"
    src.write_bytes(b"hello")
    dry_run_manifest = _manifest_for([str(src)])
    bundle_dir = tmp_path / "dryrun_bundle"
    bundle_dir.mkdir()
    (bundle_dir / MANIFEST_FILENAME).write_text(json.dumps(dry_run_manifest))
    (bundle_dir / dry_run_manifest["project"]["project_file"]).write_text("{}")

    check = validate_bundle(str(bundle_dir))
    assert check.complete is False
    assert any(p["code"] == "incomplete" for p in check.problems)


def test_validate_bundle_project_file_missing(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    os.remove(os.path.join(destination, "proj.dwk"))
    check = validate_bundle(destination)
    assert check.complete is False
    assert {"code": "project_file_missing", "detail": "proj.dwk"} in check.problems


def test_validate_bundle_source_missing_on_disk(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    sources_dir = Path(destination) / "sources"
    for f in sources_dir.iterdir():
        f.unlink()
    check = validate_bundle(destination)
    assert check.complete is False
    assert any(p["code"] == "source_missing" for p in check.problems)


def test_validate_bundle_source_size_mismatch(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    manifest_path = Path(destination) / MANIFEST_FILENAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sources"][0]["packed"]["bytes"] = 999999
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    check = validate_bundle(destination)
    assert check.complete is False
    assert any(p["code"] == "source_size_mismatch" for p in check.problems)


def test_validate_bundle_source_checksum_mismatch_when_verify_checksums(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    manifest_path = Path(destination) / MANIFEST_FILENAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sources"][0]["packed"]["checksum"] = "sha256:" + "0" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    check_no_verify = validate_bundle(destination)
    assert check_no_verify.complete is True  # size still matches; checksum not checked by default

    check_verify = validate_bundle(destination, verify_checksums=True)
    assert check_verify.complete is False
    assert any(p["code"] == "source_checksum_mismatch" for p in check_verify.problems)


def test_validate_bundle_escape_rejected_for_a_hand_edited_bundle_path(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    manifest_path = Path(destination) / MANIFEST_FILENAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sources"][0]["bundle_path"] = "../escape.csv"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    check = validate_bundle(destination)
    assert check.complete is False
    assert any(p["code"] == "escape_rejected" for p in check.problems)


def test_validate_bundle_problems_never_contain_the_tmp_path(tmp_path: Path) -> None:
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    sources_dir = Path(destination) / "sources"
    for f in sources_dir.iterdir():
        f.unlink()
    check = validate_bundle(destination)
    for problem in check.problems:
        assert str(tmp_path) not in problem["detail"]
        assert str(tmp_path) not in problem["code"]


@pytest.mark.parametrize(
    "bad_project_file",
    [
        pytest.param("/etc/passwd", id="absolute"),
        pytest.param("../../x.dwk", id="traversal"),
        pytest.param("sub/x.dwk", id="separator"),
        pytest.param("sub\\x.dwk", id="backslash-separator"),
        pytest.param("", id="empty"),
    ],
)
def test_validate_bundle_rejects_a_project_file_that_escapes_the_bundle(
    tmp_path: Path, bad_project_file: str
) -> None:
    """Review finding #1 (PR 3 backend round): `manifest["project"]
    ["project_file"]` must be a single, bundle-local component -- an
    absolute path or a `..`/separator traversal must never be joined onto
    `bundle_dir` and reported `complete=True`, and the invalid value must
    never be echoed back in `problems`."""
    bundle_dir = tmp_path / "bundle"
    bundle_dir.mkdir()
    manifest = {
        "format": "quantized-portable-bundle",
        "manifest_version": 1,
        "dry_run": False,
        "project": {"project_file": bad_project_file},
        "sources": [],
    }
    (bundle_dir / MANIFEST_FILENAME).write_text(json.dumps(manifest), encoding="utf-8")

    check = validate_bundle(str(bundle_dir))

    assert check.complete is False
    assert {"code": "project_file_invalid", "detail": "<invalid>"} in check.problems
    for problem in check.problems:
        assert problem["detail"] != bad_project_file


def test_validate_bundle_accepts_a_valid_plain_project_file_name(tmp_path: Path) -> None:
    """The positive control for the same check: an ordinary bundle-local
    ``.dwk`` name is unaffected."""
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    check = validate_bundle(destination)
    assert check.complete is True
    assert not any(p["code"] == "project_file_invalid" for p in check.problems)


def test_validate_bundle_source_unreadable_on_a_nan_byte_count(tmp_path: Path) -> None:
    """Review finding #2: `int(expected_bytes)` on a non-finite `"bytes"`
    value (`NaN`, which Python's `json` module happily round-trips even
    though it is not strict JSON) must never raise out of `validate_bundle`
    -- it is a `source_unreadable` problem instead."""
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    manifest_path = Path(destination) / MANIFEST_FILENAME
    manifest_text = manifest_path.read_text(encoding="utf-8")
    manifest = json.loads(manifest_text)
    manifest["sources"][0]["packed"]["bytes"] = float("nan")
    # `json.dumps` also happily emits the literal `NaN` token by default.
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    check = validate_bundle(destination)

    assert check.complete is False
    assert any(p["code"] == "source_unreadable" for p in check.problems)


@pytest.mark.skipif(
    os.name == "nt" or os.geteuid() == 0,
    reason="chmod-based unreadability needs a non-root, POSIX user",
)
def test_validate_bundle_source_unreadable_when_the_file_cannot_be_read(tmp_path: Path) -> None:
    """Review finding #2: an `OSError` reading a staged source's bytes
    (e.g. a permission change after packing) must never raise out of
    `validate_bundle` -- `source_unreadable`, not an uncaught exception."""
    staging_root, destination = _write_complete_staging(tmp_path)
    publish_bundle(staging_root, destination)
    sources_dir = Path(destination) / "sources"
    files = list(sources_dir.iterdir())
    assert files
    target = files[0]
    old_mode = target.stat().st_mode
    target.chmod(0o000)
    try:
        check = validate_bundle(destination, verify_checksums=True)
    finally:
        target.chmod(old_mode)  # restore so pytest's own tmp_path cleanup can remove it

    assert check.complete is False
    assert any(p["code"] == "source_unreadable" for p in check.problems)


# ── atomic_replace_file: LF-canonical writes ────────────────────────────


def test_atomic_replace_file_writes_lf_only_bytes_even_with_crlf_in_content(
    tmp_path: Path,
) -> None:
    """Review finding #6: `os.fdopen`'s default text-mode newline
    translation would turn every "\\n" in ``content`` into "\\r\\n" on
    Windows; ``atomic_replace_file`` must write the string's bytes exactly
    as given, on every platform, since the caller (``manifest_json``) has
    already decided the canonical (LF-only) serialization."""
    directory = str(tmp_path)
    dest = os.path.join(directory, "out.json")
    content = manifest_json({"a": 1, "b": [1, 2, 3]})
    assert "\r" not in content  # sanity: manifest_json is already LF-only

    atomic_replace_file(directory, dest, content, temp_prefix=".qz-test-")

    written = Path(dest).read_bytes()
    assert b"\r" not in written
    assert written == content.encode("utf-8")


def test_validate_bundle_no_external_sources_at_all(tmp_path: Path) -> None:
    """A project with only embedded datasets packs to a manifest with zero
    sources, and validates complete."""
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [{"id": "d0", "name": "embedded"}],
    }
    manifest = build_dry_run_manifest(payload, "proj", _probe)
    assert manifest["summary"]["sources"] == 0
    staging_root = _staging_root(tmp_path)
    stage_result = stage_sources(manifest, staging_root, probe=_probe)
    assert stage_result.ok is True
    assert stage_result.staged == []
    final = finalize_manifest(manifest, stage_result.staged, packed_at="2026-01-01T00:00:00Z")
    write_bundle_files(
        staging_root,
        project_file="proj.dwk",
        packed_payload_json=json.dumps(payload),
        manifest=final,
    )
    destination = str(_bundle_parent(tmp_path) / "proj_bundle")
    result = publish_bundle(staging_root, destination)
    assert result.ok is True
    check = validate_bundle(destination)
    assert check.complete is True
