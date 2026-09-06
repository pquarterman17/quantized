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
from quantized.portable.staging import StageResult, create_staging_dir, stage_sources


def _probe(path: str) -> dict[str, Any]:
    return dict(probe_source_path(path, compute_checksum=True))


def _probe_no_checksum(path: str) -> dict[str, Any]:
    return dict(probe_source_path(path, compute_checksum=False))


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


def test_same_length_rewrite_with_restored_mtime_caught_by_manifest_checksum(
    tmp_path: Path,
) -> None:
    """A same-length rewrite with its mtime restored defeats size/mtime
    comparisons entirely -- only comparing the MANIFEST's own recorded
    checksum (populated here by a checksum-computing probe at manifest-build
    time) against the hash actually computed while streaming catches it
    (review finding #1). Staging itself uses a `compute_checksum=False`
    probe -- the probe's own checksum plays no part in this detection, so a
    probe run without one must still catch the change."""
    src = tmp_path / "f.csv"
    original = b"a" * 1000
    src.write_bytes(original)
    manifest = manifest_for([str(src)])
    mtime_before = src.stat().st_mtime

    rewritten = b"b" * 1000  # same length, different bytes
    src.write_bytes(rewritten)
    os.utime(src, (mtime_before, mtime_before))
    assert src.stat().st_mtime == mtime_before
    assert src.stat().st_size == len(original)

    staging_root = _new_staging_root(tmp_path)
    result = stage_sources(manifest, staging_root, probe=_probe_no_checksum)

    assert result.ok is False
    assert result.errors[0].code == "changed_since_preview"
    _no_tmp_path_leak(result.errors[0].message, tmp_path)
    assert result.staged == []
    assert result.bytes_copied == 0
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


def test_os_error_message_never_embeds_the_source_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``str(OSError)`` on an error raised by a path-taking call (``open``,
    ``os.stat``, ...) embeds ``exc.filename`` -- an absolute path -- so a
    ``StageError`` message built by interpolating the exception directly
    leaks it. This monkeypatches ``open`` to raise exactly such an OSError
    (platform-independent, unlike the permission-bits test above) and
    checks the resulting message names only the OS error text, never the
    path (review finding #3)."""
    src = tmp_path / "f.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)

    real_open = open

    def fake_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any) -> Any:
        if str(file) == str(src) and "rb" in mode:
            raise OSError(errno.EACCES, "Permission denied", str(file))
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", fake_open)

    result = stage_sources(manifest, staging_root, probe=_probe_no_checksum)

    assert result.ok is False
    assert result.errors[0].code == "read_failed"
    message = result.errors[0].message
    assert str(tmp_path) not in message
    assert str(src) not in message
    assert "Permission denied" in message
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
    # and only an independent "computed vs probed checksum" comparison
    # catches the fact that the probe's checksum doesn't match what
    # actually gets streamed.
    new_content = b"HELLO WORLD"
    src.write_bytes(new_content)
    os.utime(src, (stale_mtime, stale_mtime))

    # The MANIFEST's own recorded checksum is cleared here, deliberately
    # isolating the fresh-probe-vs-streamed comparison (this test's actual
    # target) from the separate manifest-checksum-vs-streamed comparison
    # (`changed_since_preview`, covered by
    # `test_manifest_checksum_mismatch_detected_even_without_probe_checksum`
    # below): with a recorded checksum present, the pre-copy provenance
    # check just above (recorded vs the fresh probe's checksum) would
    # already reject a probe/manifest disagreement before a single byte is
    # streamed, before this test's target check ever runs.
    row["checksum"] = None

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


def test_dangling_symlink_at_destination_rejected_without_following_it(tmp_path: Path) -> None:
    """A DANGLING symlink at the destination path must be rejected the same
    way a live one is -- portably. ``O_CREAT | O_EXCL`` alone does not
    guarantee that on every platform (on Windows it follows a dangling
    symlink and creates the file at the link's target instead of refusing),
    so `stage_one_file` checks `os.path.islink` up front rather than relying
    on `O_NOFOLLOW` alone (review finding #4)."""
    if not hasattr(os, "symlink"):
        pytest.skip("platform has no symlink support")
    src = tmp_path / "f.csv"
    src.write_bytes(b"content")
    manifest = manifest_for([str(src)])
    row = manifest["sources"][0]
    staging_root = _new_staging_root(tmp_path)
    dest = Path(staging_root) / row["bundle_path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    link_target = tmp_path / "does-not-exist-target.csv"
    try:
        os.symlink(link_target, dest)
    except OSError:
        pytest.skip("symlink creation not permitted in this environment")
    assert not link_target.exists()

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
    assert not link_target.exists()  # nothing was ever created at the target


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


def test_non_numeric_size_does_not_raise_computing_bytes_total(tmp_path: Path) -> None:
    """A malformed/hand-edited manifest row with a non-numeric ``size``
    (e.g. ``"n/a"``) must not crash ``stage_sources`` while summing
    ``bytes_total`` -- ``int(row.get("size") or 0)`` raises ``ValueError`` on
    a string that isn't a valid integer literal, and that would happen
    BEFORE the per-file loop even starts, leaking the staging directory with
    no cleanup at all. The shared `coerce_size` helper (also used by
    `copying.stage_one_file`) treats it as `0` instead (review finding #7)."""
    src = tmp_path / "f.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    manifest["sources"][0]["size"] = "n/a"
    staging_root = _new_staging_root(tmp_path)

    result = stage_sources(manifest, staging_root, probe=_probe)  # must not raise

    assert isinstance(result, StageResult)  # no exception escaped
    assert result.ok is False  # the doctored row now disagrees with the real probe
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


# ── exceptions escaping the per-file loop never leak the staging dir ────


def test_regular_file_blocking_sources_dir_does_not_leak_staging_dir(tmp_path: Path) -> None:
    """A regular FILE occupying the ``sources/`` path every packable
    destination lives under makes ``os.makedirs`` on the destination's
    parent raise (a plain file, not a directory, blocking the path) from
    deep inside ``stage_one_file`` -- an exception with no try/except
    around the per-file loop to catch it before this fix (review finding
    #2)."""
    src = tmp_path / "f.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)
    (Path(staging_root) / "sources").write_bytes(b"not a directory")

    result = stage_sources(manifest, staging_root, probe=_probe)  # must not raise

    assert isinstance(result, StageResult)
    assert result.ok is False
    assert result.staged == []
    assert result.bytes_copied == 0
    assert result.errors[0].code in ("write_failed", "invalid_manifest")
    assert result.cleanup_ok is True
    assert result.staging_root is None
    assert not os.path.exists(staging_root)


def test_raising_progress_callback_closes_the_destination_fd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Windows CI regression (#306): the raising callback unwound past the
    OPEN destination descriptor, and Windows cannot delete an open file, so
    `cleanup_staging_dir` reported False. POSIX unlinks open files, which
    hid it locally -- so this pins the fd itself: it must be closed by the
    time `stage_sources` returns, on every platform."""
    src = tmp_path / "f.csv"
    src.write_bytes(b"data" * 500)
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)
    opened: list[int] = []
    real_open = os.open

    def spy_open(path: Any, flags: int, mode: int = 0o777, *a: Any, **kw: Any) -> int:
        fd = real_open(path, flags, mode, *a, **kw)
        if flags & os.O_CREAT:
            opened.append(fd)
        return fd

    monkeypatch.setattr(os, "open", spy_open)

    def bad_progress(_event: Any) -> None:
        raise RuntimeError("progress callback exploded")

    result = stage_sources(manifest, staging_root, probe=_probe, progress=bad_progress)

    assert result.ok is False
    assert opened, "the destination was never opened"
    for fd in opened:
        with pytest.raises(OSError):
            os.fstat(fd)  # EBADF: closed before cleanup ran
    assert result.cleanup_ok is True
    assert not os.path.exists(staging_root)


def test_raising_progress_callback_does_not_leak_staging_dir(tmp_path: Path) -> None:
    """A caller-supplied ``progress`` callback that raises must still tear
    down the staging directory rather than leaking it (review finding #2)."""
    src = tmp_path / "f.csv"
    src.write_bytes(b"data" * 500)
    manifest = manifest_for([str(src)])
    staging_root = _new_staging_root(tmp_path)

    def bad_progress(_event: Any) -> None:
        raise RuntimeError("progress callback exploded")

    result = stage_sources(manifest, staging_root, probe=_probe, progress=bad_progress)

    assert isinstance(result, StageResult)
    assert result.ok is False
    assert result.staged == []
    assert result.bytes_copied == 0
    assert result.errors[0].code == "write_failed"
    assert result.cleanup_ok is True
    assert result.staging_root is None
    assert not os.path.exists(staging_root)


def test_packable_row_missing_original_path_does_not_leak_staging_dir(tmp_path: Path) -> None:
    """A malformed packable row missing a required key (``original_path``)
    raises ``KeyError`` deep inside ``stage_one_file`` -- classified
    ``invalid_manifest`` (a manifest-shape problem, not an OS-level one) and
    must still tear down the staging directory (review finding #2)."""
    src = tmp_path / "f.csv"
    src.write_bytes(b"data")
    manifest = manifest_for([str(src)])
    del manifest["sources"][0]["original_path"]
    staging_root = _new_staging_root(tmp_path)

    result = stage_sources(manifest, staging_root, probe=_probe)  # must not raise

    assert isinstance(result, StageResult)
    assert result.ok is False
    assert result.staged == []
    assert result.bytes_copied == 0
    assert result.errors[0].code == "invalid_manifest"
    assert result.cleanup_ok is True
    assert result.staging_root is None
    assert not os.path.exists(staging_root)
