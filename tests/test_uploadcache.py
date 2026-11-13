"""Persistent Origin upload staging (``routes/_uploadcache.py``).

Audit 2026-11: lazy Origin books became unrecoverable (404 "upload expired")
after an app restart or after eight more uploads -- the token map lived in
memory and was bounded by COUNT. The cache is now content-hash keyed, on disk
with a persisted index, and bounded by total BYTES (LRU). A "restart" here is
a new :class:`UploadCache` over the same directory.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from quantized.routes._uploadcache import MAX_TOTAL_BYTES, UploadCache


class _FakeReader:
    """Minimal ``AsyncChunkReader``: one pre-chopped chunk."""

    def __init__(self, data: bytes) -> None:
        self._data: bytes | None = data

    async def read(self, size: int = -1) -> bytes:
        data, self._data = self._data, None
        return data or b""


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
    restarted = UploadCache(tmp_path, max_bytes=250)
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
    dest, new = asyncio.run(
        cache.stage_stream("new.opj", _FakeReader(b"n" * 60), pinned=True)
    )
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


def test_corrupt_index_and_orphans_are_swept(tmp_path: Path) -> None:
    cache = UploadCache(tmp_path)
    _, token = cache.stage("a.opj", b"abc")
    (tmp_path / "index.json").write_text("{not json")
    (tmp_path / ".tmp-deadbeef").write_bytes(b"partial")
    unrelated = tmp_path / "keep-me.txt"
    unrelated.write_text("not ours")
    restarted = UploadCache(tmp_path)
    assert restarted.resolve(token) is None
    assert not (tmp_path / token).exists()
    assert not (tmp_path / ".tmp-deadbeef").exists()
    assert unrelated.exists()  # never touches what it did not create


def test_index_entry_with_unsafe_name_is_ignored(tmp_path: Path) -> None:
    token = "a" * 64
    (tmp_path / token).mkdir()
    (tmp_path / token / "x.opj").write_bytes(b"x")
    (tmp_path / "index.json").write_text(json.dumps({"version": 1, "entries": {
        token: {"name": "../x.opj", "size": 1, "last_used": 1.0},
    }}))
    assert UploadCache(tmp_path).resolve(token) is None


def test_oversize_stream_leaves_nothing_behind(tmp_path: Path) -> None:
    from quantized.routes._uploadstream import UploadTooLargeError

    cache = UploadCache(tmp_path)
    with pytest.raises(UploadTooLargeError):
        asyncio.run(cache.stage_stream("big.opj", _FakeReader(b"x" * 100), max_bytes=10))
    assert [p.name for p in tmp_path.iterdir()] == []


def test_book_route_resolves_a_token_after_restart(tmp_path: Path, monkeypatch) -> None:
    """End to end: stage through the module API, swap in a fresh process-wide
    cache over the same directory, then fetch the book over HTTP."""
    import numpy as np
    from fastapi.testclient import TestClient

    from quantized.app import app
    from quantized.datastruct import DataStruct
    from quantized.io.origin_project.writer import opj_bytes
    from quantized.routes import _bookcache, _uploadcache

    monkeypatch.setenv("QZ_UPLOAD_CACHE_DIR", str(tmp_path / "cache"))
    books = [
        DataStruct(time=np.arange(5.0), values=np.ones((5, 1)) * k, labels=("M",),
                   units=("emu",), metadata={"origin_book": f"B{k}"})
        for k in (1, 2)
    ]
    _, token = _uploadcache.stage_upload("p.opj", opj_bytes(books))
    monkeypatch.setattr(_uploadcache, "_default", None)  # "restart"
    _bookcache._cache.clear()  # cold: the book must be re-parsed from disk
    resp = TestClient(app).post("/api/parsers/books/data", json={"book_id": "B2", "token": token})
    assert resp.status_code == 200, resp.text
    assert resp.json()["metadata"]["origin_book"] == "B2"
