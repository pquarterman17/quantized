"""Integration tests for the lazy per-book import transport
(ORIGIN_FILE_DECODE_PLAN #38): the inventory/preview shape of a multi-book
import response, the `full_books` escape hatch, and the on-demand
``/api/parsers/books/data`` fetch route (both path- and upload-sourced)."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.io.origin_project.writer import opj_bytes
from quantized.routes import _bookcache

client = TestClient(app)


def _book(name: str, n: int = 10, m: int = 2, x_long: str = "Field") -> DataStruct:
    time = np.arange(n, dtype=float)
    values = np.column_stack([np.sin(time / 3.0 + k) for k in range(m)])
    return DataStruct(
        time=time,
        values=values,
        labels=[f"ch{k}" for k in range(m)],
        units=["V"] * m,
        metadata={"origin_book": name, "x_column_long": x_long},
    )


@pytest.fixture(autouse=True)
def _clear_bookcache():
    """The book cache is process-global — clear it around every test so one
    test's cached project can't leak into another's cache-miss assertions."""
    _bookcache._cache.clear()
    yield
    _bookcache._cache.clear()


def test_lazy_default_marks_primary_and_previews_others(tmp_path: Path) -> None:
    big = _book("Big", n=500, m=3)  # > preview target -> genuinely decimated
    small = _book("Small", n=10, m=1)
    data = opj_bytes([big, small])
    p = tmp_path / "two.opj"
    p.write_bytes(data)

    resp = client.post("/api/parsers/import", json={"path": str(p)})
    assert resp.status_code == 200
    body = resp.json()

    assert "books" in body
    books = body["books"]
    assert len(books) == 2
    # exactly one primary marker (the book with no data of its own — it's
    # already at the top level) and one lazy preview
    markers = [b for b in books if b.get("primary")]
    lazy = [b for b in books if b.get("lazy")]
    assert len(markers) == 1
    assert len(lazy) == 1
    assert "time" not in markers[0] and "values" not in markers[0]
    assert markers[0]["id"] == body["metadata"]["origin_book"]

    lazy_entry = lazy[0]
    assert lazy_entry["rows"] == 500 or lazy_entry["rows"] == 10
    assert "preview" in lazy_entry
    assert set(lazy_entry["preview"]) == {"time", "values"}
    # the preview is smaller than the real row count whenever the real count
    # exceeds the decimation target (~200) -- "Big" (500 rows) qualifies.
    if lazy_entry["rows"] == 500:
        assert len(lazy_entry["preview"]["time"]) < 500

    assert "book_source" in body
    assert body["book_source"]["kind"] == "path"
    assert body["book_source"]["path"] == str(Path(str(p)).resolve()) or os.path.samefile(
        body["book_source"]["path"], p
    )

    # origin_books (the full per-project inventory, unused on the wire) is
    # trimmed from every book's metadata, primary included.
    assert "origin_books" not in body["metadata"]
    assert "origin_books" not in markers[0]["metadata"]
    assert "origin_books" not in lazy_entry["metadata"]


def test_full_books_escape_hatch_matches_pre_38_shape(tmp_path: Path) -> None:
    a = _book("LoopA", n=300, m=2)
    b = _book("ScanB", n=5, m=1)
    p = tmp_path / "two.opj"
    p.write_bytes(opj_bytes([a, b]))

    resp = client.post("/api/parsers/import", json={"path": str(p), "full_books": True})
    assert resp.status_code == 200
    body = resp.json()
    books = body["books"]
    assert len(books) == 2
    for entry in books:
        assert "time" in entry and "values" in entry
        assert "lazy" not in entry
        assert "primary" not in entry
        assert len(entry["time"]) in (300, 5)
    assert "book_source" not in body


def test_single_book_project_has_no_books_key(tmp_path: Path) -> None:
    p = tmp_path / "one.opj"
    p.write_bytes(opj_bytes([_book("Solo", n=20)]))
    resp = client.post("/api/parsers/import", json={"path": str(p)})
    assert resp.status_code == 200
    assert "books" not in resp.json()


def test_book_data_route_fetches_full_lazy_book_via_path(tmp_path: Path) -> None:
    big = _book("Big", n=400, m=2)
    small = _book("Small", n=10, m=1)
    p = tmp_path / "two.opj"
    p.write_bytes(opj_bytes([big, small]))

    imp = client.post("/api/parsers/import", json={"path": str(p)}).json()
    lazy_entry = next(b for b in imp["books"] if b.get("lazy"))
    source = imp["book_source"]

    resp = client.post(
        "/api/parsers/books/data",
        json={"book_id": lazy_entry["id"], **source},
    )
    assert resp.status_code == 200
    full = resp.json()
    assert len(full["time"]) == lazy_entry["rows"]
    assert full["metadata"]["origin_book"] == lazy_entry["id"]
    assert "origin_books" not in full["metadata"]


def test_book_data_route_cold_cache_reparse(tmp_path: Path) -> None:
    """A book-data fetch with no prior import (cold cache) still resolves —
    the fallback re-parse path."""
    big = _book("Big", n=400, m=2)
    small = _book("Small", n=10, m=1)
    p = tmp_path / "two.opj"
    p.write_bytes(opj_bytes([big, small]))

    resp = client.post(
        "/api/parsers/books/data", json={"book_id": "Small", "path": str(p)}
    )
    assert resp.status_code == 200
    assert resp.json()["time"] == [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]


def test_book_data_route_via_upload_token(tmp_path: Path) -> None:
    big = _book("Big", n=400, m=2)
    small = _book("Small", n=10, m=1)
    data = opj_bytes([big, small])

    resp = client.post(
        "/api/parsers/upload",
        files={"file": ("two.opj", data, "application/octet-stream")},
    )
    body = resp.json()
    source = body["book_source"]
    assert source["kind"] == "upload"
    lazy_entry = next(b for b in body["books"] if b.get("lazy"))

    fetch = client.post(
        "/api/parsers/books/data",
        json={"book_id": lazy_entry["id"], "token": source["token"]},
    )
    assert fetch.status_code == 200
    assert len(fetch.json()["time"]) == lazy_entry["rows"]


def test_book_data_route_unknown_token_404() -> None:
    resp = client.post(
        "/api/parsers/books/data", json={"book_id": "Anything", "token": "not-a-real-token"}
    )
    assert resp.status_code == 404


def test_book_data_route_unknown_book_id_404(tmp_path: Path) -> None:
    p = tmp_path / "two.opj"
    p.write_bytes(opj_bytes([_book("A", n=20), _book("B", n=20)]))
    resp = client.post(
        "/api/parsers/books/data", json={"book_id": "NoSuchBook", "path": str(p)}
    )
    assert resp.status_code == 404


def test_book_data_route_requires_exactly_one_of_path_or_token() -> None:
    neither = client.post("/api/parsers/books/data", json={"book_id": "X"})
    assert neither.status_code == 400
    both = client.post(
        "/api/parsers/books/data", json={"book_id": "X", "path": "/tmp/x.opj", "token": "abc"}
    )
    assert both.status_code == 400


def test_book_data_route_requires_book_id() -> None:
    resp = client.post("/api/parsers/books/data", json={"book_id": "", "path": "/tmp/x.opj"})
    assert resp.status_code == 400


def test_book_data_route_rejects_path_outside_allowed_roots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import quantized.routes.books as books_mod

    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    target = outside / "two.opj"
    target.write_bytes(opj_bytes([_book("A", n=5), _book("B", n=5)]))
    # `books.py` imports `_allowed_roots` via `from ... import` (a fresh
    # binding in ITS OWN namespace), so the guard must be patched there --
    # patching quantized.routes.parsers._allowed_roots would rebind the name
    # only in that module, not in books.py's already-bound reference.
    monkeypatch.setattr(books_mod, "_allowed_roots", lambda: (os.path.realpath(allowed),))
    resp = client.post(
        "/api/parsers/books/data", json={"book_id": "A", "path": str(target)}
    )
    assert resp.status_code == 403


def test_bookcache_evicts_oldest_beyond_bound(tmp_path: Path) -> None:
    from quantized.routes._bookcache import cache_project_books, get_cached_book

    paths = []
    for i in range(6):  # > _MAX_PROJECTS (4)
        p = tmp_path / f"p{i}.opj"
        p.write_bytes(b"x")
        ds = _book(f"Book{i}")
        cache_project_books(p, [ds])
        paths.append(p)

    # the earliest-cached projects should have aged out
    assert get_cached_book(paths[0], "Book0") is None
    assert get_cached_book(paths[1], "Book1") is None
    # the most recent ones remain
    assert get_cached_book(paths[-1], "Book5") is not None


def test_bookcache_invalidates_on_mtime_change(tmp_path: Path) -> None:
    from quantized.routes._bookcache import cache_project_books, get_cached_book

    p = tmp_path / "p.opj"
    p.write_bytes(b"x")
    cache_project_books(p, [_book("A")])
    assert get_cached_book(p, "A") is not None

    # bump mtime -> a new cache key -> the old entry is no longer reachable
    new_mtime = p.stat().st_mtime + 10
    os.utime(p, (new_mtime, new_mtime))
    assert get_cached_book(p, "A") is None


def test_uploadcache_stage_and_resolve(tmp_path: Path) -> None:
    from quantized.routes._uploadcache import resolve_upload_token, stage_upload

    dest, token = stage_upload("proj.opj", b"hello")
    assert dest.read_bytes() == b"hello"
    assert resolve_upload_token(token) == dest


def test_uploadcache_unknown_token_resolves_none() -> None:
    from quantized.routes._uploadcache import resolve_upload_token

    assert resolve_upload_token("nonexistent-token") is None


def test_uploadcache_evicts_oldest_beyond_bound() -> None:
    from quantized.routes._uploadcache import resolve_upload_token, stage_upload

    tokens = []
    for i in range(10):  # > _MAX_STAGED (8)
        _, token = stage_upload(f"f{i}.opj", f"content{i}".encode())
        tokens.append(token)
    assert resolve_upload_token(tokens[0]) is None
    assert resolve_upload_token(tokens[-1]) is not None
