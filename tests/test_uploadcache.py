"""Persistent Origin upload staging (``routes/_uploadcache.py``).

Audit 2026-11: lazy Origin books became unrecoverable (404 "upload expired")
after an app restart or after eight more uploads -- the token map lived in
memory and was bounded by COUNT. The cache is content-hash keyed, on disk
with a persisted index, and bounded by total BYTES (LRU). A "restart" here is
a new :class:`UploadCache` over the same directory; two live instances over
one directory stand in for two app processes (each takes the OS file lock on
its own descriptor).
"""

from __future__ import annotations

import asyncio
import errno
import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

from quantized.routes import _uploadcache as cache_mod
from quantized.routes import _uploadcache_fs as fs
from quantized.routes._uploadcache import MAX_TOTAL_BYTES, UploadCache

posix_only = pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission bits")


class _FakeReader:
    """Minimal ``AsyncChunkReader``: pre-chopped chunks."""

    def __init__(self, *chunks: bytes) -> None:
        self._chunks = list(chunks)

    async def read(self, size: int = -1) -> bytes:
        return self._chunks.pop(0) if self._chunks else b""


def _names(root: Path) -> list[str]:
    return sorted(p.name for p in root.iterdir())


def test_documented_budget_is_two_gib() -> None:
    assert MAX_TOTAL_BYTES == 2 * 1024**3


def test_stage_and_resolve(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path)
    dest, token = cache.stage("proj.opj", b"hello")
    assert dest.read_bytes() == b"hello" and dest.name == "proj.opj"
    assert cache.resolve(token) == dest
    assert len(token) == 64


def test_unknown_or_malformed_token_resolves_none(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path)
    assert cache.resolve("0" * 64) is None
    assert cache.resolve("../../etc/passwd") is None
    assert cache.resolve("nonexistent-token") is None


def test_tokens_survive_a_restart(tmp_path: Path) -> None:
    first = UploadCache(tmp_path)
    dest, token = first.stage("multi.opj", b"CPYA project bytes")
    restarted = UploadCache(tmp_path)  # what the next app start builds
    assert restarted.resolve(token) == dest
    assert dest.read_bytes() == b"CPYA project bytes"


def test_same_content_reuses_one_token_and_one_copy(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path)
    d1, t1 = cache.stage("a.opj", b"same bytes")
    d2, t2 = cache.stage("a.opj", b"same bytes")
    assert (d1, t1) == (d2, t2)
    _, t3 = cache.stage("a.opju", b"same bytes")  # extension is part of the key
    assert t3 != t1
    assert cache.total_bytes() == 2 * len(b"same bytes")


def test_more_than_eight_uploads_all_survive_within_budget(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path, max_bytes=10_000)
    tokens = [cache.stage(f"f{i}.opj", f"content{i}".encode())[1] for i in range(20)]
    assert all(cache.resolve(t) is not None for t in tokens)


def test_evicts_least_recently_used_by_bytes(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path, max_bytes=250)
    _, a = cache.stage("a.opj", b"a" * 100)
    _, b = cache.stage("b.opj", b"b" * 100)
    assert cache.resolve(a) is not None  # a is now the most recently used
    _, c = cache.stage("c.opj", b"c" * 100)  # 300 > 250: evict LRU = b
    assert cache.resolve(b) is None
    assert cache.resolve(a) is not None and cache.resolve(c) is not None
    assert cache.total_bytes() <= 250
    assert not (tmp_path / b).exists()


def test_lru_order_survives_a_restart(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path, max_bytes=250)
    _, a = cache.stage("a.opj", b"a" * 100)
    _, b = cache.stage("b.opj", b"b" * 100)
    cache.resolve(a)
    restarted = UploadCache(tmp_path, max_bytes=250, foreign_grace_s=0)
    restarted.stage("c.opj", b"c" * 100)
    assert restarted.resolve(b) is None and restarted.resolve(a) is not None


def test_single_upload_larger_than_budget_still_lands(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path, max_bytes=50)
    _, small = cache.stage("s.opj", b"s" * 10)
    dest, big = cache.stage("big.opj", b"B" * 100)
    assert cache.resolve(big) == dest  # never evicted by its own commit
    assert cache.resolve(small) is None


def test_pinned_entry_is_never_evicted_and_unpin_reruns_eviction(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path, max_bytes=150)
    _, old = cache.stage("old.opj", b"o" * 100)
    cache.mark_in_flight(old)
    _, mid = cache.stage("mid.opj", b"m" * 100)  # over budget; old is pinned
    assert cache.resolve(old) is not None and cache.resolve(mid) is not None
    cache.clear_in_flight(old)  # retry: evict LRU unpinned until in budget
    assert cache.total_bytes() <= 150
    assert cache.resolve(mid) is not None  # the most recently used survives


def test_pinned_commit_survives_its_own_sweep(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path, max_bytes=100)
    olders = [cache.stage(f"o{i}.opj", bytes([i]) * 60)[1] for i in range(3)]
    for t in olders:
        cache.mark_in_flight(t)
    dest, new = asyncio.run(cache.stage_stream("new.opj", _FakeReader(b"n" * 60), pinned=True))
    assert cache.is_pinned(new)
    assert cache.resolve(new) == dest and dest.is_file()


def test_duplicate_upload_pins_are_counted(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path, max_bytes=100)
    _, t = cache.stage("a.opj", b"a" * 80)
    cache.mark_in_flight(t)
    cache.mark_in_flight(t)  # the same file uploaded twice, both parsing
    cache.clear_in_flight(t)
    assert cache.is_pinned(t)
    cache.stage("b.opj", b"b" * 80)
    assert cache.resolve(t) is not None


def test_oversize_stream_leaves_nothing_behind(tmp_path: Path) -> None:
    from quantized.routes._uploadstream import UploadTooLargeError

    cache = UploadCache(tmp_path)
    with pytest.raises(UploadTooLargeError):
        asyncio.run(cache.stage_stream("big.opj", _FakeReader(b"x" * 100), max_bytes=10))
    assert _names(tmp_path) == [fs.MARKER]


# ── review item 4: two app instances on one directory ───────────────────────


def test_two_instances_keep_each_others_uploads(tmp_path: Path) -> None:
    a_side, b_side = UploadCache(tmp_path), UploadCache(tmp_path)
    da, ta = a_side.stage("a.opj", b"from instance A")
    db, tb = b_side.stage("b.opj", b"from instance B")  # must not drop A's entry
    _, ta2 = a_side.stage("a2.opj", b"A again")  # must not drop B's entry
    assert a_side.resolve(tb) == db and b_side.resolve(ta) == da
    restarted = UploadCache(tmp_path)
    assert {t for t in (ta, tb, ta2) if restarted.resolve(t) is not None} == {ta, tb, ta2}
    assert da.read_bytes() == b"from instance A" and db.read_bytes() == b"from instance B"


def test_another_instances_fresh_entry_is_not_evicted(tmp_path: Path) -> None:
    other = UploadCache(tmp_path, max_bytes=150)
    _, theirs = other.stage("theirs.opj", b"t" * 100)  # maybe still being parsed there
    mine = UploadCache(tmp_path, max_bytes=150)
    _, own = mine.stage("mine.opj", b"m" * 100)  # over budget
    assert mine.resolve(theirs) is not None and mine.resolve(own) is not None


def test_fresh_unindexed_directory_is_never_swept(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path)
    cache.stage("seed.opj", b"seed")
    fresh, stale = tmp_path / ("a" * 64), tmp_path / ("b" * 64)
    for d in (fresh, stale):  # mid-commit in another instance: not hash-valid yet
        d.mkdir()
        (d / "x.opj").write_bytes(b"partial")
    os.utime(stale, (1.0, 1.0))
    UploadCache(tmp_path)
    assert fresh.is_dir() and (fresh / "x.opj").exists()
    assert not stale.exists()


# ── review items 5 + 6: persistence failure is non-fatal, nothing leaks ─────


def _break_index_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    real = os.replace

    def failing(src: object, dst: object, **kw: object) -> None:
        if Path(str(dst)).name == fs.INDEX:
            raise OSError(errno.ENOSPC, "No space left on device")
        real(src, dst, **kw)  # type: ignore[arg-type]

    monkeypatch.setattr(os, "replace", failing)


def test_index_write_failure_is_non_fatal(tmp_path: Path, monkeypatch) -> None:
    cache = UploadCache(tmp_path)
    _break_index_writes(monkeypatch)
    dest, token = asyncio.run(cache.stage_stream("p.opj", _FakeReader(b"data"), pinned=True))
    assert dest.read_bytes() == b"data"
    assert cache.resolve(token) == dest  # served although the index never landed
    assert cache.is_pinned(token)
    cache.clear_in_flight(token)
    assert not cache.is_pinned(token)
    assert not [n for n in _names(tmp_path) if n.startswith(fs.TMP_PREFIX)]  # no .tmp-index-*
    monkeypatch.undo()
    assert UploadCache(tmp_path).resolve(token) == dest  # rebuilt from the token dir


def test_failed_commit_leaves_no_pin_and_no_temp_file(tmp_path: Path, monkeypatch) -> None:
    cache = UploadCache(tmp_path)

    def boom(keep: str | None = None) -> None:
        raise OSError("eviction failed")

    monkeypatch.setattr(cache, "_evict", boom)
    with pytest.raises(OSError, match="eviction failed"):
        asyncio.run(cache.stage_stream("p.opj", _FakeReader(b"data"), pinned=True))
    assert cache._pins == {}
    assert not [n for n in _names(tmp_path) if n.startswith(fs.TMP_PREFIX)]


def test_failed_write_in_stage_leaves_no_temp_file(tmp_path: Path, monkeypatch) -> None:
    cache = UploadCache(tmp_path)

    def boom(self: Path, data: bytes) -> int:
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(Path, "write_bytes", boom)
    with pytest.raises(OSError):
        cache.stage("p.opj", b"data")
    assert _names(tmp_path) == [fs.MARKER]


# ── review item 7: a corrupt index is rebuilt, not treated as an empty cache ─


@pytest.mark.parametrize("damage", ["{not json", '{"entries": 7}', None])
def test_corrupt_or_missing_index_is_rebuilt_from_token_dirs(
    tmp_path: Path, damage: str | None
) -> None:
    cache = UploadCache(tmp_path)
    da, ta = cache.stage("a.opj", b"alpha")
    db, tb = cache.stage("b.opju", b"beta")
    if damage is None:
        (tmp_path / fs.INDEX).unlink()
    else:
        (tmp_path / fs.INDEX).write_text(damage)
    restarted = UploadCache(tmp_path)
    assert restarted.resolve(ta) == da and restarted.resolve(tb) == db
    assert json.loads((tmp_path / fs.INDEX).read_text())["entries"].keys() == {ta, tb}


def test_running_instance_rebuilds_a_corrupt_index_on_its_next_operation(
    tmp_path: Path,
) -> None:
    # Review item 7, the running case: an index corrupted while this instance
    # is up (another instance crashed mid-write) must not cost the uploads
    # this instance never saw -- its next operation re-hashes and adopts the
    # token directories, the same rebuild a restart does.
    mine = UploadCache(tmp_path)
    other = UploadCache(tmp_path)
    path, token = other.stage("other.opj", b"theirs")
    (tmp_path / fs.INDEX).write_text("{ not json")
    mine.stage("mine.opj", b"ours")
    assert mine.resolve(token) == path
    assert token in json.loads((tmp_path / fs.INDEX).read_text())["entries"]


def test_rebuild_rejects_a_directory_whose_content_does_not_hash_to_its_name(
    tmp_path: Path,
) -> None:
    cache = UploadCache(tmp_path)
    _, token = cache.stage("a.opj", b"alpha")
    (tmp_path / token / "a.opj").write_bytes(b"tampered")
    (tmp_path / fs.INDEX).unlink()
    assert UploadCache(tmp_path).resolve(token) is None


def test_index_entry_with_unsafe_name_is_ignored(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path)
    cache.stage("seed.opj", b"seed")
    token = "a" * 64
    (tmp_path / token).mkdir()
    (tmp_path / token / "x.opj").write_bytes(b"x")
    rows = json.loads((tmp_path / fs.INDEX).read_text())
    rows["entries"][token] = {"name": "../x.opj", "size": 1, "last_used": 1.0}
    (tmp_path / fs.INDEX).write_text(json.dumps(rows))
    assert UploadCache(tmp_path).resolve(token) is None


@pytest.mark.parametrize(
    ("token", "name"),
    [
        ("..", "passwd"),  # token dir climbs out of the root
        ("a" * 64, "../../outside.opj"),  # name climbs out of the token dir
        ("a" * 64, "/etc/passwd"),  # absolute name replaces the whole join
        ("a" * 64 + "/nested", "x.opj"),  # one level too deep
        ("", "x.opj"),  # file directly in the root (index/marker level)
    ],
)
def test_path_containment_fails_closed_even_past_the_upstream_guards(
    tmp_path: Path, token: str, name: str
) -> None:
    """``_path`` is the last check before a cache path reaches the
    filesystem (CodeQL py/path-injection: the token flows from the request).
    The token regex and the index's name check normally stop these first;
    here they are bypassed by planting the entry in memory, and the
    containment check alone must still refuse every escape."""
    cache = UploadCache(tmp_path)
    entry = fs.Entry(name, 1, 1.0)
    with pytest.raises(ValueError):
        cache._path(token, entry)
    cache._entries[token] = entry
    assert cache._present(token, entry) is False


def test_resolve_returns_none_for_an_entry_whose_path_would_escape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A valid token whose (somehow) unsafe entry name would escape the token
    directory resolves to ``None``, never to a path outside the cache."""
    cache = UploadCache(tmp_path)
    _dest, token = cache.stage("ok.opj", b"ok")
    monkeypatch.setattr(cache, "_sync", lambda **_kw: None)
    cache._entries[token] = fs.Entry("../../escape.opj", 2, 1.0)
    assert cache.resolve(token) is None


def test_resolved_path_is_exactly_token_dir_and_name(tmp_path: Path) -> None:
    (tmp_path / "sub").mkdir()
    cache = UploadCache(tmp_path / "sub" / ".." / "root")
    dest, token = cache.stage("proj.opj", b"hello")
    root = os.path.normpath(tmp_path / "root")
    assert str(dest) == os.path.join(root, token, "proj.opj")
    assert cache.resolve(token) == dest


@pytest.mark.parametrize(
    "root",
    [
        r"C:\Users\RUNNER~1\AppData\Local\Temp\pytest-0\cache",  # 8.3 short name
        r"C:/Users/runneradmin/AppData/Local/Temp/mixed\cache",  # mixed separators
        "C:\\",  # a drive root: the prefix must not become "C:\\\\"
    ],
)
def test_path_containment_under_windows_path_semantics(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, root: str
) -> None:
    """``_path`` with ``ntpath`` standing in for ``os.path`` (CI's Windows
    runner, simulated on any host): a contained path is accepted and comes back
    as ``<root>\\<token>\\<name>``; an escape is still refused."""
    import ntpath
    from pathlib import PureWindowsPath
    from types import SimpleNamespace

    cache = UploadCache(tmp_path)
    cache.root = PureWindowsPath(root)  # type: ignore[assignment]
    monkeypatch.setattr(cache_mod, "os", SimpleNamespace(path=ntpath, sep="\\"))
    token = "a" * 64
    got = str(cache._path(token, fs.Entry("proj.opj", 1, 1.0)))
    assert got == ntpath.join(ntpath.normpath(root), token, "proj.opj")
    with pytest.raises(ValueError):
        cache._path(token, fs.Entry("..\\..\\escape.opj", 1, 1.0))


def test_path_containment_at_a_posix_filesystem_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """At ``/`` (as at ``C:\\``) a ``..`` name normalizes to a path that is
    still under the root and two levels down from nothing -- only the exact
    token-directory check refuses it."""
    import posixpath
    from pathlib import PurePosixPath
    from types import SimpleNamespace

    cache = UploadCache(tmp_path)
    cache.root = PurePosixPath("/")  # type: ignore[assignment]
    monkeypatch.setattr(cache_mod, "os", SimpleNamespace(path=posixpath, sep="/"))
    token = "a" * 64
    # _path returns the host's concrete Path, which renders "\\" on Windows;
    # compare in POSIX form so the POSIX rules are what is tested on every OS.
    assert cache._path(token, fs.Entry("p.opj", 1, 1.0)).as_posix() == f"/{token}/p.opj"
    with pytest.raises(ValueError):
        cache._path(token, fs.Entry("../../escape.opj", 1, 1.0))


def test_equal_timestamps_keep_lru_order_across_a_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Windows' time.time() on Python < 3.13 ticks every ~15.6 ms, so entries
    staged and used back to back share one ``last_used``. Freeze the clock to
    force that tie: the restarted cache must keep the index's LRU order (it
    used to merge through a set, so ties fell back to hash-seed order and the
    restart evicted the most recently used entry about half the time --
    ``test_lru_order_survives_a_restart`` failing on windows/3.11). Eight
    entries make a hash order that happens to match vanishingly unlikely."""
    monkeypatch.setattr(time, "time", lambda: 1_700_000_000.0)
    cache = UploadCache(tmp_path, max_bytes=10_000)
    tokens = [cache.stage(f"f{i}.opj", f"content{i}".encode())[1] for i in range(8)]
    cache.resolve(tokens[0])  # now the most recently used
    expected = [*tokens[1:], tokens[0]]
    restarted = UploadCache(tmp_path, max_bytes=10_000, foreign_grace_s=0)
    with restarted._lock:
        restarted._sync()
    assert list(restarted._entries) == expected

    small = UploadCache(tmp_path / "lru", max_bytes=250)
    _, a = small.stage("a.opj", b"a" * 100)
    _, b = small.stage("b.opj", b"b" * 100)
    small.resolve(a)
    again = UploadCache(tmp_path / "lru", max_bytes=250, foreign_grace_s=0)
    again.stage("c.opj", b"c" * 100)
    assert again.resolve(b) is None and again.resolve(a) is not None


# ── review item 8: never touch files it did not create ──────────────────────


def test_override_directory_with_user_files_is_left_alone(tmp_path: Path, monkeypatch) -> None:
    shared = tmp_path / "my-data"
    shared.mkdir()
    old_tmp, hexdir, index = shared / ".tmp-notes", shared / ("c" * 64), shared / "index.json"
    old_tmp.write_text("mine")
    hexdir.mkdir()
    (hexdir / "thesis.opj").write_bytes(b"precious")
    index.write_text("my own index")
    for p in (old_tmp, hexdir):
        os.utime(p, (1.0, 1.0))
    monkeypatch.setenv("QZ_UPLOAD_CACHE_DIR", str(shared))
    monkeypatch.setattr(cache_mod, "_default", None)

    dest, token = cache_mod.stage_upload("p.opj", b"data")
    cache_mod.get_cache().clear()

    assert cache_mod.cache_dir() == shared / "origin-uploads"
    assert dest.parent.parent == shared / "origin-uploads"
    assert old_tmp.read_text() == "mine" and index.read_text() == "my own index"
    assert (hexdir / "thesis.opj").read_bytes() == b"precious"
    assert _names(shared) == sorted([".tmp-notes", "c" * 64, "index.json", "origin-uploads"])


def test_unmarked_non_empty_directory_is_refused_and_untouched(tmp_path: Path) -> None:
    stale, hexdir = tmp_path / ".tmp-old", tmp_path / ("d" * 64)
    stale.write_text("not ours")
    hexdir.mkdir()
    os.utime(stale, (1.0, 1.0))
    os.utime(hexdir, (1.0, 1.0))
    cache = UploadCache(tmp_path)  # no marker: nothing is swept
    assert cache.clear() == {"removed": 0, "bytes": 0, "kept": 0}
    with pytest.raises(OSError, match="not created by Quantized"):
        cache.stage("p.opj", b"data")
    assert _names(tmp_path) == sorted([".tmp-old", "d" * 64])


def test_sweep_spares_fresh_temp_files_and_foreign_names(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path)
    cache.stage("seed.opj", b"seed")
    stale, fresh, other = tmp_path / ".tmp-dead", tmp_path / ".tmp-live", tmp_path / "keep.txt"
    for p in (stale, fresh, other):
        p.write_bytes(b"x")
    os.utime(stale, (1.0, 1.0))
    os.utime(other, (1.0, 1.0))
    UploadCache(tmp_path)
    assert not stale.exists() and fresh.exists() and other.exists()


# ── review item 9: privacy, and a way to clear ──────────────────────────────


@posix_only
def test_directories_are_0700_and_files_0600(tmp_path: Path) -> None:
    root = tmp_path / "cache"
    cache = UploadCache(root)
    dest, _ = cache.stage("a.opj", b"alpha")
    dest2, _ = asyncio.run(cache.stage_stream("b.opj", _FakeReader(b"beta")))

    def mode(p: Path) -> int:
        return p.stat().st_mode & 0o777

    assert mode(root) == 0o700
    assert mode(dest.parent) == 0o700 and mode(dest2.parent) == 0o700
    for f in (dest, dest2, root / fs.INDEX, root / fs.MARKER):
        assert mode(f) == 0o600, f


def test_clear_removes_everything_but_an_upload_being_parsed(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path)
    _, a = cache.stage("a.opj", b"a" * 10)
    _, b = cache.stage("b.opj", b"b" * 20)
    cache.mark_in_flight(b)
    assert cache.info() == {
        "path": str(tmp_path), "entries": 2, "bytes": 30, "max_bytes": MAX_TOTAL_BYTES,
    }
    assert cache.clear() == {"removed": 1, "bytes": 10, "kept": 1}
    assert cache.resolve(a) is None and cache.resolve(b) is not None
    cache.clear_in_flight(b)
    assert cache.clear() == {"removed": 1, "bytes": 20, "kept": 0}
    assert UploadCache(tmp_path).info()["entries"] == 0


def test_cli_upload_cache_info_and_clear(tmp_path: Path, monkeypatch, capsys) -> None:
    from quantized import cli

    monkeypatch.setenv("QZ_UPLOAD_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(cache_mod, "_default", None)
    _, token = cache_mod.stage_upload("p.opj", b"x" * 1000)

    cli.main(["upload-cache"])
    out = capsys.readouterr().out
    assert str(tmp_path / "origin-uploads") in out and "1 staged upload(s)" in out

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    cli.main(["upload-cache", "clear"])
    assert "nothing deleted" in capsys.readouterr().out
    assert cache_mod.resolve_upload_token(token) is not None

    cli.main(["upload-cache", "clear", "--yes"])
    assert "deleted 1 staged upload(s)" in capsys.readouterr().out
    assert cache_mod.resolve_upload_token(token) is None


# ── review item 10: no synchronous full-file hash on the event loop ─────────


def test_stream_is_hashed_in_flight_and_committed_off_the_loop(
    tmp_path: Path, monkeypatch
) -> None:
    cache = UploadCache(tmp_path)

    def no_rehash(path: Path, name: str) -> str:
        raise AssertionError("the staged file was read a second time to hash it")

    monkeypatch.setattr(fs, "file_token", no_rehash)
    commit_threads: list[threading.Thread] = []
    real_commit = cache._commit

    def spy(*args: object, **kw: object) -> tuple[Path, str]:
        commit_threads.append(threading.current_thread())
        return real_commit(*args, **kw)  # type: ignore[arg-type]

    monkeypatch.setattr(cache, "_commit", spy)
    dest, token = asyncio.run(cache.stage_stream("p.opj", _FakeReader(b"ab", b"cd", b"ef")))

    assert dest.read_bytes() == b"abcdef"
    assert commit_threads and commit_threads[0] is not threading.main_thread()
    monkeypatch.undo()
    other = UploadCache(tmp_path / "other")
    assert other.stage("q.opj", b"abcdef")[1] == token  # same key as the in-memory path


# ── end to end ──────────────────────────────────────────────────────────────


def _two_book_project() -> bytes:
    import numpy as np

    from quantized.datastruct import DataStruct
    from quantized.io.origin_project.writer import opj_bytes

    return opj_bytes([
        DataStruct(time=np.arange(5.0), values=np.ones((5, 1)) * k, labels=("M",),
                   units=("emu",), metadata={"origin_book": f"B{k}"})
        for k in (1, 2)
    ])


def test_book_route_resolves_a_token_after_restart(tmp_path: Path, monkeypatch) -> None:
    """Stage through the module API, swap in a fresh process-wide cache over
    the same directory, then fetch the book over HTTP."""
    from fastapi.testclient import TestClient

    from quantized.app import app
    from quantized.routes import _bookcache

    monkeypatch.setenv("QZ_UPLOAD_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(cache_mod, "_default", None)
    _, token = cache_mod.stage_upload("p.opj", _two_book_project())
    monkeypatch.setattr(cache_mod, "_default", None)  # "restart"
    _bookcache._cache.clear()  # cold: the book must be re-parsed from disk
    resp = TestClient(app).post("/api/parsers/books/data", json={"book_id": "B2", "token": token})
    assert resp.status_code == 200, resp.text
    assert resp.json()["metadata"]["origin_book"] == "B2"


def test_upload_and_book_fetch_succeed_while_the_index_cannot_be_written(
    tmp_path: Path, monkeypatch
) -> None:
    """Review item 5: with the index unwritable (disk full) the upload must
    not answer 422 for a file it did stage, nor the book fetch 500."""
    import io

    from fastapi.testclient import TestClient

    from quantized.app import app
    from quantized.routes import _bookcache

    monkeypatch.setenv("QZ_UPLOAD_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(cache_mod, "_default", None)
    cache_mod.stage_upload("seed.opj", b"seed")  # the directory exists
    _break_index_writes(monkeypatch)
    client = TestClient(app)
    up = client.post(
        "/api/parsers/upload", files={"file": ("p.opj", io.BytesIO(_two_book_project()))}
    )
    assert up.status_code == 200, up.text
    token = up.json()["book_source"]["token"]
    assert not cache_mod.get_cache().is_pinned(token)
    _bookcache._cache.clear()
    got = client.post("/api/parsers/books/data", json={"book_id": "B2", "token": token})
    assert got.status_code == 200, got.text


def test_upload_cache_routes_report_and_clear(tmp_path: Path, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from quantized.app import app

    monkeypatch.setenv("QZ_UPLOAD_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(cache_mod, "_default", None)
    _, token = cache_mod.stage_upload("p.opj", b"x" * 123)
    client = TestClient(app)
    info = client.get("/api/parsers/upload-cache").json()
    assert info == {
        "path": str(tmp_path / "origin-uploads"), "entries": 1, "bytes": 123,
        "max_bytes": MAX_TOTAL_BYTES,
    }
    assert client.delete("/api/parsers/upload-cache").json() == {
        "removed": 1, "bytes": 123, "kept": 0,
    }
    assert cache_mod.resolve_upload_token(token) is None


# ── integration review: links and the cache root's owner/mode ──────────────


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX symlinks/modes")
def test_sweep_never_follows_a_symlink_out_of_the_cache(tmp_path: Path) -> None:
    root = tmp_path / "origin-uploads"
    UploadCache(root).stage("a.opj", b"x")
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "thesis.docx").write_bytes(b"precious")
    old = time.time() - 7200
    os.utime(victim / "thesis.docx", (old, old))
    os.utime(victim, (old, old))
    link = root / ("ab" * 32)  # a token-shaped name
    os.symlink(victim, link)
    UploadCache(root)  # startup scan + sweep
    path, token = UploadCache(root).stage("b.opj", b"y")  # a commit too
    assert (victim / "thesis.docx").read_bytes() == b"precious"
    # A link planted under a staged token is not served either.
    os.unlink(path)
    os.symlink(victim / "thesis.docx", path)
    assert UploadCache(root).resolve(token) is None
    assert (victim / "thesis.docx").read_bytes() == b"precious"


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")
def test_a_lax_premade_root_is_tightened_to_0700(tmp_path: Path) -> None:
    lax = tmp_path / "lax"
    lax.mkdir()
    os.chmod(lax, 0o777)
    (lax / fs.MARKER).write_text("x")
    path, _ = UploadCache(lax).stage("b.opj", b"data")
    assert lax.stat().st_mode & 0o777 == 0o700
    assert path.stat().st_mode & 0o777 == 0o600


@pytest.mark.skipif(
    sys.platform == "win32" or os.geteuid() != 0, reason="needs root to chown"
)
def test_a_root_owned_by_another_user_is_refused(tmp_path: Path) -> None:
    other = tmp_path / "theirs"
    other.mkdir(mode=0o700)
    (other / fs.MARKER).write_text("x")
    os.chown(other, 12345, 12345)
    with pytest.raises(OSError, match="owned by another user"):
        UploadCache(other).stage("b.opj", b"data")
    assert [p.name for p in other.iterdir()] == [fs.MARKER]
