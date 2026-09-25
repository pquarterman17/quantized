"""Pure-layer tests for the large-workbook transfer store (Group F).

Covers the plan's contract-test line for the file-based transport: round trip,
ID collisions, missing/expired package, partial write, cleanup, size bounds,
path-traversal ids, token mismatch, and two stores ("processes") sharing one
directory -- including a FORCED cleanup race rather than a hoped-for one
(docs/testing.md).
"""

from __future__ import annotations

import itertools
import os
import threading
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from quantized.io import workbook_transfer_store as mod
from quantized.io.workbook_transfer_store import (
    DEFAULT_TTL_SECONDS,
    PACKAGE_SUFFIX,
    TEMP_GRACE_SECONDS,
    TEMP_PREFIX,
    TEMP_SUFFIX,
    EmptyPackage,
    InvalidPackageId,
    PackageExpired,
    PackageNotFound,
    PackageTooLarge,
    TransferStore,
    TransferStoreError,
    cleanup_transfer_dir,
    is_valid_package_id,
    transfer_dir,
)
from quantized.portable.atomic_rename import NoReplaceUnsupported


class Clock:
    """An injectable clock starting at real time (so file mtimes line up)."""

    def __init__(self) -> None:
        import time

        self.now = time.time()

    def __call__(self) -> float:
        return self.now


def _store(root: Path, clock: Clock | None = None, **kw: object) -> TransferStore:
    return TransferStore(root, clock=clock or Clock(), **kw)  # type: ignore[arg-type]


def _ids(*values: str) -> Callable[[], str]:
    it: Iterator[str] = iter(values)
    return lambda: next(it)


PKG = b'{"format":"quantized-workbook-transfer","version":1}'


def _files(root: Path) -> list[str]:
    return sorted(p.name for p in root.iterdir())


# -- round trip ---------------------------------------------------------------


def test_round_trip_returns_the_exact_bytes(tmp_path: Path) -> None:
    store = _store(tmp_path)
    stored = store.put(PKG)
    assert is_valid_package_id(stored.package_id)
    assert stored.size == len(PKG)
    assert stored.expires_at - stored.created_at == DEFAULT_TTL_SECONDS
    assert store.get(stored.package_id, stored.token) == PKG
    assert _files(tmp_path) == [f"{stored.package_id}{PACKAGE_SUFFIX}"]


def test_token_itself_is_never_written_to_disk(tmp_path: Path) -> None:
    stored = _store(tmp_path).put(PKG)
    raw = (tmp_path / f"{stored.package_id}{PACKAGE_SUFFIX}").read_bytes()
    assert stored.token.encode() not in raw


def test_every_put_mints_a_distinct_id_and_token(tmp_path: Path) -> None:
    store = _store(tmp_path)
    a, b = store.put(PKG), store.put(PKG)
    assert a.package_id != b.package_id
    assert a.token != b.token


# -- token + missing ----------------------------------------------------------


def test_wrong_token_is_indistinguishable_from_missing(tmp_path: Path) -> None:
    store = _store(tmp_path)
    stored = store.put(PKG)
    with pytest.raises(PackageNotFound):
        store.get(stored.package_id, stored.token + "x")
    with pytest.raises(PackageNotFound):
        store.get(stored.package_id, "")
    with pytest.raises(PackageNotFound):
        store.get("0" * 32, stored.token)
    # a wrong token does not destroy the package
    assert store.get(stored.package_id, stored.token) == PKG


# -- path traversal -----------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        "../" + "0" * 29,
        "..\\" + "0" * 29,
        "/etc/passwd",
        "C:" + "0" * 30,
        "0" * 31,
        "0" * 33,
        "A" * 32,
        "0" * 31 + "\x00",
        "0" * 31 + "/",
        "",
        "0" * 32 + "\n",
    ],
)
def test_malformed_ids_never_form_a_path(tmp_path: Path, bad: str) -> None:
    store = _store(tmp_path)
    store.put(PKG)
    before = _files(tmp_path)
    with pytest.raises(InvalidPackageId):
        store.get(bad, "t")
    with pytest.raises(InvalidPackageId):
        store.delete(bad, "t")
    assert _files(tmp_path) == before


# -- expiry -------------------------------------------------------------------


def test_expired_package_reports_expired_once_then_missing(tmp_path: Path) -> None:
    clock = Clock()
    store = _store(tmp_path, clock)
    stored = store.put(PKG)
    clock.now += DEFAULT_TTL_SECONDS - 1
    assert store.get(stored.package_id, stored.token) == PKG
    clock.now += 1
    with pytest.raises(PackageExpired):
        store.get(stored.package_id, stored.token)
    assert _files(tmp_path) == []  # removed on the way out
    with pytest.raises(PackageNotFound):
        store.get(stored.package_id, stored.token)


def test_expired_with_wrong_token_is_not_found_not_expired(tmp_path: Path) -> None:
    clock = Clock()
    store = _store(tmp_path, clock)
    stored = store.put(PKG)
    clock.now += DEFAULT_TTL_SECONDS + 5
    with pytest.raises(PackageNotFound):
        store.get(stored.package_id, "nope")


# -- cleanup ------------------------------------------------------------------


def test_cleanup_removes_expired_keeps_live_and_foreign(tmp_path: Path) -> None:
    clock = Clock()
    store = _store(tmp_path, clock)
    old = store.put(PKG)
    clock.now += DEFAULT_TTL_SECONDS / 2
    live = store.put(PKG)
    (tmp_path / "notes.txt").write_text("user file")
    (tmp_path / f"{'Z' * 32}{PACKAGE_SUFFIX}").write_text("not ours: bad id")
    clock.now += DEFAULT_TTL_SECONDS / 2  # `old` now expired, `live` not
    report = store.cleanup()
    assert report.expired == 1
    names = _files(tmp_path)
    assert f"{old.package_id}{PACKAGE_SUFFIX}" not in names
    assert f"{live.package_id}{PACKAGE_SUFFIX}" in names
    assert "notes.txt" in names and f"{'Z' * 32}{PACKAGE_SUFFIX}" in names


def test_store_sweeps_expired_packages_on_each_put(tmp_path: Path) -> None:
    clock = Clock()
    store = _store(tmp_path, clock)
    old = store.put(PKG)
    clock.now += DEFAULT_TTL_SECONDS + 1
    new = store.put(PKG)
    assert _files(tmp_path) == [f"{new.package_id}{PACKAGE_SUFFIX}"]
    assert old.package_id != new.package_id


def test_partial_write_leftover_is_never_served_and_swept_after_grace(tmp_path: Path) -> None:
    clock = Clock()
    store = _store(tmp_path, clock)
    young = tmp_path / f"{TEMP_PREFIX}young{TEMP_SUFFIX}"
    stale = tmp_path / f"{TEMP_PREFIX}stale{TEMP_SUFFIX}"
    young.write_bytes(b"half a pack")
    stale.write_bytes(b"half a pack")
    os.utime(stale, (clock.now - TEMP_GRACE_SECONDS - 5,) * 2)
    report = store.cleanup()
    assert report.stale == 1
    # another process's in-progress write (young temp) survives the sweep
    assert _files(tmp_path) == [young.name]


def test_truncated_package_file_is_not_served_and_is_swept(tmp_path: Path) -> None:
    store = _store(tmp_path)
    stored = store.put(PKG)
    path = tmp_path / f"{stored.package_id}{PACKAGE_SUFFIX}"
    path.write_bytes(path.read_bytes()[:-3])  # simulate a torn/partial file
    with pytest.raises(PackageNotFound):
        store.get(stored.package_id, stored.token)
    assert store.cleanup().corrupt == 1
    assert _files(tmp_path) == []


def test_foreign_package_named_file_is_kept_until_older_than_the_ttl(tmp_path: Path) -> None:
    """A newer build sharing the directory may write a header this build does
    not know; it is not "corrupt" -- only aged out by mtime."""
    clock = Clock()
    store = _store(tmp_path, clock)
    foreign = tmp_path / f"{'f' * 32}{PACKAGE_SUFFIX}"
    header = b'{"format":"quantized-transfer-store","version":2}'.ljust(2047) + b"\n"
    foreign.write_bytes(header + b"payload")
    assert store.cleanup() == mod.CleanupReport()
    assert foreign.exists()
    with pytest.raises(PackageNotFound):
        store.get("f" * 32, "t")
    os.utime(foreign, (clock.now - DEFAULT_TTL_SECONDS - 5,) * 2)
    assert store.cleanup().stale == 1
    assert not foreign.exists()


def test_non_hex_digest_is_corrupt_not_a_crash(tmp_path: Path) -> None:
    """``hmac.compare_digest`` raises TypeError on a non-ASCII str; a damaged
    header must surface as not-found, never as an unhandled error."""
    store = _store(tmp_path)
    stored = store.put(PKG)
    path = tmp_path / f"{stored.package_id}{PACKAGE_SUFFIX}"
    raw = path.read_bytes()
    header = raw[: mod.HEADER_BYTES].decode("ascii")
    digest = header.split('"token_sha256":"')[1][:64]
    damaged = header.replace(digest, "\\u00e9" + digest[6:])  # JSON escape, same length
    path.write_bytes(damaged.encode("ascii") + raw[mod.HEADER_BYTES :])
    with pytest.raises(PackageNotFound):
        store.get(stored.package_id, stored.token)
    assert store.cleanup().corrupt == 1


def test_streamed_write_in_chunks_round_trips(tmp_path: Path) -> None:
    store = _store(tmp_path)
    pending = store.begin()
    for part in (b'{"a":', b"1", b"}"):
        pending.write(part)
    assert [p.name for p in tmp_path.iterdir() if p.name.endswith(PACKAGE_SUFFIX)] == []
    stored = pending.commit()
    assert store.get(stored.package_id, stored.token) == b'{"a":1}'
    fh, size = store.open_package(stored.package_id, stored.token)
    with fh:
        assert (fh.read(), size) == (b'{"a":1}', 7)


def test_oversize_stream_aborts_mid_write_and_leaves_nothing(tmp_path: Path) -> None:
    store = _store(tmp_path, max_package_bytes=10, max_total_bytes=10_000)
    pending = store.begin()
    pending.write(b"x" * 6)
    with pytest.raises(PackageTooLarge):
        pending.write(b"x" * 6)
    pending.abort()  # idempotent
    assert _files(tmp_path) == []


def test_abandoned_stream_leaves_nothing(tmp_path: Path) -> None:
    store = _store(tmp_path)
    pending = store.begin()
    pending.write(b"half")
    pending.abort()
    assert _files(tmp_path) == []
    with pytest.raises(EmptyPackage):
        store.begin().commit()
    assert _files(tmp_path) == []


def test_a_crash_during_write_leaves_nothing_behind(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(fd: int) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(mod.os, "fsync", boom)
    with pytest.raises(OSError, match="disk full"):
        _store(tmp_path).put(PKG)
    assert _files(tmp_path) == []


def test_cleanup_transfer_dir_never_creates_the_directory(tmp_path: Path) -> None:
    missing = tmp_path / "nope"
    assert cleanup_transfer_dir(missing).expired == 0
    assert not missing.exists()


def test_transfer_dir_honors_the_env_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("QZ_TRANSFER_DIR", str(tmp_path / "x"))
    assert transfer_dir() == tmp_path / "x"
    monkeypatch.delenv("QZ_TRANSFER_DIR")
    default = transfer_dir()
    assert default.name == "workbook-transfer" and "quantized" in str(default)


# -- size bounds + eviction ---------------------------------------------------


def test_oversize_and_empty_packages_are_refused_without_writing(tmp_path: Path) -> None:
    store = _store(tmp_path, max_package_bytes=10, max_total_bytes=10_000)
    with pytest.raises(PackageTooLarge):
        store.put(b"x" * 11)
    with pytest.raises(EmptyPackage):
        store.put(b"")
    assert _files(tmp_path) == []
    at_limit = store.put(b"x" * 10)  # the bound itself is inclusive
    assert store.get(at_limit.package_id, at_limit.token) == b"x" * 10


def test_total_byte_bound_evicts_oldest_first(tmp_path: Path) -> None:
    clock = Clock()
    # each file is a fixed 1024 B header + 1000 B payload = 2024 B: this
    # bound holds two files (4048 B), never three (6072 B)
    store = _store(tmp_path, clock, max_package_bytes=1000, max_total_bytes=5000)
    first = store.put(b"a" * 1000)
    clock.now += 1
    second = store.put(b"b" * 1000)
    clock.now += 1
    third = store.put(b"c" * 1000)
    names = _files(tmp_path)
    assert f"{first.package_id}{PACKAGE_SUFFIX}" not in names
    assert f"{second.package_id}{PACKAGE_SUFFIX}" in names
    assert f"{third.package_id}{PACKAGE_SUFFIX}" in names
    total = sum(p.stat().st_size for p in tmp_path.iterdir())
    assert total <= store.max_total_bytes


def test_entry_count_bound_evicts_oldest_first(tmp_path: Path) -> None:
    clock = Clock()
    store = _store(tmp_path, clock, max_entries=2)
    ids = []
    for _ in range(4):
        ids.append(store.put(PKG).package_id)
        clock.now += 1
    assert _files(tmp_path) == sorted(f"{i}{PACKAGE_SUFFIX}" for i in ids[-2:])


def test_bounds_that_cannot_hold_one_package_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        TransferStore(tmp_path, max_package_bytes=100, max_total_bytes=100)


# -- id collisions ------------------------------------------------------------


def test_id_collision_mints_a_new_id_and_never_overwrites(tmp_path: Path) -> None:
    a, b = "a" * 32, "b" * 32
    store = _store(tmp_path, new_id=_ids(a, a, b))
    first = store.put(b"first")
    second = store.put(b"second")
    assert (first.package_id, second.package_id) == (a, b)
    assert store.get(a, first.token) == b"first"
    assert store.get(b, second.token) == b"second"


def test_id_collision_is_detected_without_a_no_replace_rename(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unsupported(src: str, dst: str) -> None:
        raise NoReplaceUnsupported("not here")

    monkeypatch.setattr(mod, "rename_noreplace", unsupported)
    a, b = "a" * 32, "b" * 32
    store = _store(tmp_path, new_id=_ids(a, a, b))
    first = store.put(b"first")
    second = store.put(b"second")
    assert second.package_id == b
    assert store.get(a, first.token) == b"first"


def test_exhausted_id_attempts_fail_cleanly(tmp_path: Path) -> None:
    a = "a" * 32
    store = _store(tmp_path, new_id=lambda: a)
    store.put(b"first")
    with pytest.raises(TransferStoreError, match="unique"):
        store.put(b"second")
    assert _files(tmp_path) == [f"{a}{PACKAGE_SUFFIX}"]  # no temp left behind


# -- delete -------------------------------------------------------------------


def test_delete_needs_the_token(tmp_path: Path) -> None:
    clock = Clock()
    store = _store(tmp_path, clock)
    stored = store.put(PKG)
    with pytest.raises(PackageNotFound):
        store.delete(stored.package_id, "wrong")
    store.delete(stored.package_id, stored.token)
    assert _files(tmp_path) == []
    expiring = store.put(PKG)
    clock.now += DEFAULT_TTL_SECONDS + 1
    store.delete(expiring.package_id, expiring.token)  # already gone: fine


# -- two processes, one directory ---------------------------------------------


def test_two_stores_share_one_directory(tmp_path: Path) -> None:
    source, destination = _store(tmp_path), _store(tmp_path)
    stored = source.put(PKG)
    assert destination.get(stored.package_id, stored.token) == PKG


def test_forces_the_cleanup_race_between_two_processes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Process B lists the directory, then process A removes every file
    BEFORE B reads any of them -- the worst interleaving, forced rather than
    hoped for. B must neither raise nor count a vanished file as corrupt."""
    clock = Clock()
    a = _store(tmp_path, clock)
    b = _store(tmp_path, clock)
    for _ in range(5):
        a.put(PKG)
    clock.now += DEFAULT_TTL_SECONDS + 1
    real_read = mod._read_entry
    raced = {"done": False}

    def read_after_a_cleaned(path: Path) -> mod._Entry | None:
        if not raced["done"]:
            raced["done"] = True
            assert a.cleanup().expired == 5
        return real_read(path)

    monkeypatch.setattr(mod, "_read_entry", read_after_a_cleaned)
    report = b.cleanup()
    assert raced["done"]
    assert (report.expired, report.corrupt) == (0, 0)
    assert _files(tmp_path) == []


def test_concurrent_cleanup_threads_remove_each_file_exactly_once(tmp_path: Path) -> None:
    clock = Clock()
    seed = _store(tmp_path, clock, max_entries=64)
    for _ in range(40):
        seed.put(PKG)
    clock.now += DEFAULT_TTL_SECONDS + 1
    stores = [_store(tmp_path, clock) for _ in range(2)]
    barrier = threading.Barrier(2)
    counts: list[int] = []
    errors: list[BaseException] = []

    def run(store: TransferStore) -> None:
        try:
            barrier.wait()
            counts.append(store.cleanup().expired)
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(s,)) for s in stores]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert sum(counts) == 40
    assert _files(tmp_path) == []


def test_two_stores_evicting_concurrently_tolerate_each_other(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Forced: B picks its eviction victim, then A removes it first."""
    clock = Clock()
    a = _store(tmp_path, clock, max_entries=2)
    b = _store(tmp_path, clock, max_entries=2)
    ids = itertools.count()
    oldest = a.put(PKG)
    clock.now += 1
    a.put(PKG)
    clock.now += 1
    real_remove = mod._remove

    def remove_after_a(path: Path) -> bool:
        if path.stem == oldest.package_id and next(ids) == 0:
            assert real_remove(path)  # "process A" wins the race
        return real_remove(path)

    monkeypatch.setattr(mod, "_remove", remove_after_a)
    newest = b.put(PKG)
    assert f"{oldest.package_id}{PACKAGE_SUFFIX}" not in _files(tmp_path)
    assert b.get(newest.package_id, newest.token) == PKG
