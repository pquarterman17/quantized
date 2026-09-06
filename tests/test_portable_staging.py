"""Unit tests for ``quantized.portable.staging`` (P1.7 "Pack Project" PR 2):
happy-path staging, streaming/cancellation behaviour, staging-dir lifecycle,
and the read-only-source guarantee.

See ``tests/test_portable_staging_failures.py`` for every failure code and
the cleanup contract.
"""

from __future__ import annotations

import builtins
import hashlib
import os
from pathlib import Path
from typing import Any

import pytest

from quantized.desktop_source_probe import _CHECKSUM_CHUNK_BYTES, probe_source_path
from quantized.portable.manifest import build_dry_run_manifest
from quantized.portable.staging import (
    StageProgress,
    cleanup_staging_dir,
    create_staging_dir,
    stage_sources,
)


def _probe(path: str) -> dict[str, Any]:
    return dict(probe_source_path(path, compute_checksum=True))


def _probe_no_checksum(path: str) -> dict[str, Any]:
    return dict(probe_source_path(path, compute_checksum=False))


def manifest_for(paths: list[str], project_name: str = "proj") -> dict[str, Any]:
    """Build a real dry-run manifest (PR 1's own contract) for ``paths``,
    so these tests exercise ``stage_sources`` against the actual manifest
    shape rather than a hand-rolled stand-in."""
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


# ── create_staging_dir / cleanup_staging_dir ────────────────────────────────


def test_create_staging_dir_is_a_sibling_prefixed_temp_dir(tmp_path: Path) -> None:
    parent = tmp_path / "bundle_parent"
    parent.mkdir()
    staging_root = create_staging_dir(str(parent))
    assert os.path.isdir(staging_root)
    assert os.path.dirname(os.path.realpath(staging_root)) == os.path.realpath(str(parent))
    assert os.path.basename(staging_root).startswith(".qz-pack-")


def test_create_staging_dir_rejects_missing_parent(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        create_staging_dir(str(tmp_path / "does-not-exist"))


def test_cleanup_refuses_dir_without_prefix(tmp_path: Path) -> None:
    d = tmp_path / "not-a-staging-dir"
    d.mkdir()
    (d / "f.txt").write_text("x")
    assert cleanup_staging_dir(str(d)) is False
    assert d.exists()
    assert (d / "f.txt").exists()


def test_cleanup_does_not_descend_into_symlinked_subdir(tmp_path: Path) -> None:
    if not hasattr(os, "symlink"):
        pytest.skip("platform has no symlink support")
    staging_root = _new_staging_root(tmp_path)
    outside = tmp_path / "outside_kept"
    outside.mkdir()
    (outside / "keep.txt").write_text("keep me")
    try:
        os.symlink(outside, Path(staging_root) / "linked")
    except OSError:
        pytest.skip("symlink creation not permitted in this environment")

    assert cleanup_staging_dir(staging_root) is True
    assert not os.path.exists(staging_root)
    assert (outside / "keep.txt").read_text() == "keep me"


# ── happy path ───────────────────────────────────────────────────────────


def test_happy_path_stages_three_files_with_verified_checksums(tmp_path: Path) -> None:
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    p_unicode = src_dir / "mesures_µ0H_élan.csv"
    p_long = src_dir / (("m" * 180) + ".csv")
    p_plain = src_dir / "run3.csv"
    contents = {
        p_unicode: b"time,field\n1,2\n" * 50,
        p_long: os.urandom(4096),
        p_plain: b"a,b\n1,2\n",
    }
    for p, data in contents.items():
        p.write_bytes(data)
    mtimes_before = {str(p): p.stat().st_mtime for p in contents}

    manifest = manifest_for([str(p) for p in contents])
    assert manifest["summary"]["packable"] == 3
    staging_root = _new_staging_root(tmp_path)

    events: list[StageProgress] = []
    result = stage_sources(manifest, staging_root, probe=_probe, progress=events.append)

    assert result.ok is True
    assert result.cancelled is False
    assert result.cleanup_ok is None
    assert result.staging_root == staging_root
    assert result.originals_modified is False
    assert len(result.staged) == 3
    assert not result.errors

    by_original = {sf.original_path: sf for sf in result.staged}
    for p, data in contents.items():
        staged = by_original[str(p)]
        expected = f"sha256:{hashlib.sha256(data).hexdigest()}"
        assert staged.checksum == expected
        assert staged.bytes == len(data)
        dest = Path(staging_root) / staged.bundle_path
        assert dest.read_bytes() == data
        # Originals are byte-identical and untouched (mtime included).
        assert p.read_bytes() == data
        assert p.stat().st_mtime == mtimes_before[str(p)]

    assert any(e.phase == "verifying" for e in events)
    assert result.bytes_copied == sum(len(d) for d in contents.values())


# ── large-file streaming ─────────────────────────────────────────────────


def test_large_file_streams_in_bounded_chunks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    size = 12 * 1024 * 1024
    src = tmp_path / "big.bin"
    src.write_bytes(os.urandom(size))
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)

    max_seen = {"n": 0}
    real_open = builtins.open

    def spy_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        f = real_open(file, mode, *args, **kwargs)
        if str(file) == str(src) and mode == "rb":
            # `io.BufferedReader` is an immutable C type -- its `read`
            # cannot be patched on the class, but overriding it on this
            # one INSTANCE works fine and only affects this file object.
            orig_read = f.read

            def read(n: int = -1) -> bytes:
                if n and n > 0:
                    max_seen["n"] = max(max_seen["n"], n)
                return orig_read(n)

            f.read = read  # type: ignore[method-assign]
        return f

    monkeypatch.setattr(builtins, "open", spy_open)

    chunk_bytes = 64 * 1024
    events: list[StageProgress] = []
    # `_probe_no_checksum` avoids a second, differently-chunked (1 MiB) read
    # pass over the whole file inside the probe itself, which would pollute
    # the "no single read exceeds chunk_bytes" measurement below.
    result = stage_sources(
        manifest,
        staging_root,
        probe=_probe_no_checksum,
        progress=events.append,
        chunk_bytes=chunk_bytes,
    )

    assert result.ok is True
    copying_events = [e for e in events if e.phase == "copying"]
    assert len(copying_events) == size // chunk_bytes
    prev = -1
    for e in copying_events:
        assert e.bytes_done >= prev
        prev = e.bytes_done
    assert copying_events[-1].bytes_done == size
    assert result.bytes_copied == size
    assert max_seen["n"] <= chunk_bytes


# ── cancellation ─────────────────────────────────────────────────────────


def test_mid_copy_cancel_leaves_no_partial_file(tmp_path: Path) -> None:
    src = tmp_path / "cancel_me.bin"
    src.write_bytes(os.urandom(500_000))
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)

    events: list[StageProgress] = []
    cancel_after = 3

    def should_cancel() -> bool:
        return len(events) >= cancel_after

    result = stage_sources(
        manifest,
        staging_root,
        probe=_probe,
        progress=events.append,
        should_cancel=should_cancel,
        chunk_bytes=64 * 1024,
    )

    assert result.ok is False
    assert result.cancelled is True
    assert result.errors[-1].code == "cancelled"
    assert result.cleanup_ok is True
    assert result.staging_root is None
    assert not os.path.exists(staging_root)
    assert all(e.phase == "copying" for e in events)


# ── shared-source dedup ──────────────────────────────────────────────────


def test_shared_source_produces_exactly_one_staged_file(tmp_path: Path) -> None:
    src = tmp_path / "shared.csv"
    src.write_bytes(b"shared-data")
    payload = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [
            {"id": "d1", "name": "A", "source": {"kind": "path", "path": str(src)}},
            {"id": "d2", "name": "B", "source": {"kind": "path", "path": str(src)}},
        ],
    }
    manifest = build_dry_run_manifest(payload, "proj", _probe)
    assert manifest["summary"]["sources"] == 1
    staging_root = _new_staging_root(tmp_path)

    result = stage_sources(manifest, staging_root, probe=_probe)
    assert result.ok is True
    assert len(result.staged) == 1


# ── read-only source access ──────────────────────────────────────────────


def test_source_is_only_ever_opened_read_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = tmp_path / "f.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)

    real_open = builtins.open
    modes_for_source: list[str] = []

    def spy_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if str(file) == str(src):
            modes_for_source.append(mode)
        return real_open(file, mode, *args, **kwargs)

    real_os_open = os.open
    write_flag_opens: list[Any] = []

    def spy_os_open(path: Any, flags: int, mode: int = 0o777, *args: Any, **kwargs: Any) -> int:
        if str(path) == str(src) and (flags & (os.O_WRONLY | os.O_RDWR)):
            write_flag_opens.append(path)
        return real_os_open(path, flags, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy_open)
    monkeypatch.setattr(os, "open", spy_os_open)

    result = stage_sources(manifest, staging_root, probe=_probe)

    assert result.ok is True
    assert modes_for_source and all(m == "rb" for m in modes_for_source)
    assert write_flag_opens == []


# ── default chunk size ────────────────────────────────────────────────────


def test_default_chunk_size_matches_probe_module() -> None:
    import inspect

    sig = inspect.signature(stage_sources)
    assert sig.parameters["chunk_bytes"].default == _CHECKSUM_CHUNK_BYTES
