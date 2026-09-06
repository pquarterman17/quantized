"""Failure-mode and cleanup-contract tests for
``quantized.portable.staging``/``quantized.portable.copying`` (P1.7 "Pack
Project" PR 2). Happy-path/streaming/cancellation tests live in
``tests/test_portable_staging.py``.
"""

from __future__ import annotations

import errno
import os
from pathlib import Path
from typing import Any

import pytest

from quantized.desktop_source_probe import probe_source_path
from quantized.portable.copying import StageError, stage_one_file
from quantized.portable.manifest import build_dry_run_manifest
from quantized.portable.staging import create_staging_dir, stage_sources


def _probe(path: str) -> dict[str, Any]:
    return dict(probe_source_path(path, compute_checksum=True))


def manifest_for(paths: list[str], project_name: str = "proj") -> dict[str, Any]:
    datasets = [
        {"id": f"d{i}", "name": Path(p).name, "source": {"kind": "path", "path": p}}
        for i, p in enumerate(paths)
    ]
    payload = {"format": "quantized-workspace", "version": 4, "datasets": datasets}
    return build_dry_run_manifest(payload, project_name, _probe)


def _new_staging_root(tmp_path: Path) -> str:
    parent = tmp_path / "bundle_parent"
    parent.mkdir()
    return create_staging_dir(str(parent))


def _no_tmp_path_leak(message: str, tmp_path: Path) -> None:
    assert str(tmp_path) not in message


# ── changed since preview ────────────────────────────────────────────────


def test_changed_since_preview_detected(tmp_path: Path) -> None:
    src = tmp_path / "f.csv"
    src.write_bytes(b"one")
    manifest = manifest_for([str(src)])
    src.write_bytes(b"two-different-content")
    os.utime(src, (1_700_000_000, 1_700_000_000))
    staging_root = _new_staging_root(tmp_path)

    result = stage_sources(manifest, staging_root, probe=_probe)

    assert result.ok is False
    assert result.staged == []
    assert result.errors[0].code == "changed_since_preview"
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert result.cleanup_ok is True
    assert not os.path.exists(staging_root)


# ── read failure after preview ───────────────────────────────────────────


@pytest.mark.skipif(
    os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0),
    reason="permission bits unavailable or not enforced (Windows / root)",
)
def test_read_failure_after_preview(tmp_path: Path) -> None:
    src = tmp_path / "f.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    os.chmod(src, 0o000)
    try:
        staging_root = _new_staging_root(tmp_path)
        result = stage_sources(manifest, staging_root, probe=_probe)
    finally:
        os.chmod(src, 0o644)

    assert result.ok is False
    assert result.errors[0].code == "read_failed"
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert result.cleanup_ok is True


# ── source mutated during copy ───────────────────────────────────────────


def test_source_mutated_during_copy_is_detected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = tmp_path / "mut.csv"
    original = b"a" * 1000
    src.write_bytes(original)
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)

    real_open = open
    state = {"appended": False}

    def fake_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if str(file) == str(src) and mode == "rb":
            # Raw, unbuffered file object: deterministic, no read-ahead, so
            # the mutation below becomes visible on the very next read.
            f = real_open(file, "rb", buffering=0)
            orig_read = f.read

            def read(n: int = -1) -> bytes:
                data = orig_read(n)
                if not state["appended"] and data:
                    state["appended"] = True
                    with real_open(src, "ab") as af:
                        af.write(b"b" * 500)
                return data

            f.read = read  # type: ignore[method-assign]
            return f
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", fake_open)

    # No-checksum probe: the probe's own reachability/size check must not
    # itself open (and thus mutate) the source before the copy starts.
    def probe_no_open(path: str) -> dict[str, Any]:
        return dict(probe_source_path(path, compute_checksum=False))

    result = stage_sources(manifest, staging_root, probe=probe_no_open, chunk_bytes=100)

    assert result.ok is False
    assert result.errors[0].code == "changed_during_copy"
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert result.cleanup_ok is True


# ── checksum mismatch ─────────────────────────────────────────────────────


def test_checksum_mismatch_from_fake_probe(tmp_path: Path) -> None:
    src = tmp_path / "f.csv"
    src.write_bytes(b"hello world")
    manifest = manifest_for([str(src)])
    row = manifest["sources"][0]
    stale_checksum = row["checksum"]
    stale_size = row["size"]
    stale_mtime = row["mtime"]

    # Same length, different bytes -- so size/mtime cross-checks all agree
    # and only step 8's independent "computed vs probed checksum" catches
    # the fact that the probe's checksum doesn't match what actually gets
    # streamed.
    src.write_bytes(b"HELLO WORLD")
    os.utime(src, (stale_mtime, stale_mtime))

    def fake_probe(_path: str) -> dict[str, Any]:
        return {"state": "ok", "size": stale_size, "mtime": stale_mtime, "checksum": stale_checksum}

    staging_root = _new_staging_root(tmp_path)
    result = stage_sources(manifest, staging_root, probe=fake_probe)

    assert result.ok is False
    assert result.errors[0].code == "checksum_mismatch"
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert result.cleanup_ok is True


# ── disk full / write failure ────────────────────────────────────────────


def test_disk_full_during_copy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    src = tmp_path / "f.csv"
    src.write_bytes(b"x" * 5000)
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)

    real_os_open = os.open
    real_os_write = os.write
    captured: dict[str, int | None] = {"fd": None}

    def fake_os_open(path: Any, flags: int, mode: int = 0o777) -> int:
        fd = real_os_open(path, flags, mode)
        if flags & os.O_CREAT and flags & os.O_EXCL:
            captured["fd"] = fd
        return fd

    def fake_os_write(fd: int, data: bytes) -> int:
        if fd == captured["fd"]:
            raise OSError(errno.ENOSPC, "No space left on device")
        return real_os_write(fd, data)

    monkeypatch.setattr(os, "open", fake_os_open)
    monkeypatch.setattr(os, "write", fake_os_write)

    result = stage_sources(manifest, staging_root, probe=_probe)

    assert result.ok is False
    assert result.errors[0].code == "write_failed"
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert result.cleanup_ok is True


# ── existing destination (low-level: verify bytes untouched) ────────────


def test_destination_exists_leaves_preexisting_bytes_untouched(tmp_path: Path) -> None:
    src = tmp_path / "f.csv"
    src.write_bytes(b"content")
    manifest = manifest_for([str(src)])
    row = manifest["sources"][0]
    staging_root = _new_staging_root(tmp_path)
    dest = Path(staging_root) / row["bundle_path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"pre-existing")

    outcome = stage_one_file(
        row,
        staging_root,
        probe=_probe,
        progress=None,
        should_cancel=None,
        chunk_bytes=65536,
        file_index=1,
        file_count=1,
        bytes_total=int(row["size"]),
        bytes_done_before=0,
    )

    assert isinstance(outcome, StageError)
    assert outcome.code == "destination_exists"
    _no_tmp_path_leak(outcome.message, tmp_path)
    assert dest.read_bytes() == b"pre-existing"


# ── symlink escapes ───────────────────────────────────────────────────────


def test_symlink_escape_via_sources_dir(tmp_path: Path) -> None:
    if not hasattr(os, "symlink"):
        pytest.skip("platform has no symlink support")
    outside = tmp_path / "outside"
    outside.mkdir()
    src = tmp_path / "f.csv"
    src.write_bytes(b"content")
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)
    try:
        os.symlink(outside, Path(staging_root) / "sources")
    except OSError:
        pytest.skip("symlink creation not permitted in this environment")

    result = stage_sources(manifest, staging_root, probe=_probe)

    assert result.ok is False
    assert result.errors[0].code == "escape_rejected"
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert list(outside.iterdir()) == []
    assert result.cleanup_ok is True
    assert not os.path.exists(staging_root)


def test_symlink_at_destination_path_rejected(tmp_path: Path) -> None:
    if not hasattr(os, "symlink"):
        pytest.skip("platform has no symlink support")
    outside_file = tmp_path / "outside.csv"
    outside_file.write_bytes(b"outside-data")
    src = tmp_path / "f.csv"
    src.write_bytes(b"content")
    manifest = manifest_for([str(src)])
    row = manifest["sources"][0]
    staging_root = _new_staging_root(tmp_path)
    dest = Path(staging_root) / row["bundle_path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(outside_file, dest)
    except OSError:
        pytest.skip("symlink creation not permitted in this environment")

    outcome = stage_one_file(
        row,
        staging_root,
        probe=_probe,
        progress=None,
        should_cancel=None,
        chunk_bytes=65536,
        file_index=1,
        file_count=1,
        bytes_total=int(row["size"]),
        bytes_done_before=0,
    )

    assert isinstance(outcome, StageError)
    assert outcome.code in ("destination_exists", "escape_rejected")
    assert outside_file.read_bytes() == b"outside-data"


# ── invalid manifest ───────────────────────────────────────────────────────


def test_unsupported_manifest_version_creates_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = tmp_path / "f.csv"
    src.write_bytes(b"data")
    manifest = dict(manifest_for([str(src)]), manifest_version=999)
    staging_root = _new_staging_root(tmp_path)

    real_makedirs = os.makedirs
    makedirs_calls: list[Any] = []

    def spy_makedirs(name: Any, *args: Any, **kwargs: Any) -> None:
        makedirs_calls.append(name)
        real_makedirs(name, *args, **kwargs)

    monkeypatch.setattr(os, "makedirs", spy_makedirs)

    result = stage_sources(manifest, staging_root, probe=_probe)

    assert result.ok is False
    assert result.errors[0].code == "invalid_manifest"
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert makedirs_calls == []
    assert result.cleanup_ok is True
    assert not os.path.exists(staging_root)


# ── cleanup after every failure class ────────────────────────────────────


def _setup_destination_exists(tmp_path: Path) -> tuple[dict[str, Any], str, Any]:
    src = tmp_path / "a.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)
    dest = Path(staging_root) / manifest["sources"][0]["bundle_path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"existing")
    return manifest, staging_root, _probe


def _setup_read_failed(tmp_path: Path) -> tuple[dict[str, Any], str, Any]:
    src = tmp_path / "b.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)

    def missing_probe(_path: str) -> dict[str, Any]:
        return {"state": "missing"}

    return manifest, staging_root, missing_probe


def _setup_invalid_manifest(tmp_path: Path) -> tuple[dict[str, Any], str, Any]:
    src = tmp_path / "c.csv"
    src.write_bytes(b"data")
    manifest = dict(manifest_for([str(src)]), manifest_version=999)
    staging_root = _new_staging_root(tmp_path)
    return manifest, staging_root, _probe


def _setup_escape_rejected(tmp_path: Path) -> tuple[dict[str, Any], str, Any]:
    if not hasattr(os, "symlink"):
        pytest.skip("platform has no symlink support")
    outside = tmp_path / "outside_cleanup"
    outside.mkdir()
    src = tmp_path / "d.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)
    try:
        os.symlink(outside, Path(staging_root) / "sources")
    except OSError:
        pytest.skip("symlink creation not permitted in this environment")
    return manifest, staging_root, _probe


@pytest.mark.parametrize(
    "setup, expected_code",
    [
        (_setup_destination_exists, "destination_exists"),
        (_setup_read_failed, "read_failed"),
        (_setup_invalid_manifest, "invalid_manifest"),
        (_setup_escape_rejected, "escape_rejected"),
    ],
)
def test_cleanup_after_every_failure_class(
    tmp_path: Path, setup: Any, expected_code: str
) -> None:
    manifest, staging_root, probe = setup(tmp_path)
    result = stage_sources(manifest, staging_root, probe=probe)

    assert result.ok is False
    assert result.errors[0].code == expected_code
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert result.cleanup_ok is True
    assert result.staging_root is None
    assert not os.path.exists(staging_root)
