"""Thin route: fetch one Origin book's full data on demand (lazy per-book
transport, ORIGIN_FILE_DECODE_PLAN #38).

``/api/parsers/import``/``upload`` return the primary book's full data plus a
lightweight inventory + preview for every OTHER book
(``routes.parsers._import_with_books``'s default, non-``full_books`` path).
This route is where the frontend's first activation of one of those other
books fetches its full ``DataStruct``. A cache hit (the common case — the
import route already parsed the whole project and primed ``_bookcache`` with
the SAME book list) is a plain dict lookup; a miss (server restart, cache
eviction, or a book requested well after the cache's LRU bound was exceeded)
re-parses the source file once and re-primes the cache.
"""

from __future__ import annotations

import os
import struct
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.io.origin_project import (
    OriginProjectError,
    drop_empty_library_books,
    read_origin_project_all,
)
from quantized.routes._bookcache import cache_project_books, get_cached_book
from quantized.routes._uploadcache import resolve_upload_token
from quantized.routes.parsers import _allowed_roots, _book_payload

router = APIRouter(prefix="/api/parsers", tags=["parsers"])


class BookDataRequest(BaseModel):
    book_id: str
    # Exactly one of these — mirrors the two ways a project got imported
    # (routes.parsers._book_source_ref): a path /import already validated, or
    # an /upload's staged-file token (_uploadcache).
    path: str | None = None
    token: str | None = None


def _resolve_book_path(raw_path: str) -> Path:
    """The SAME realpath+commonpath containment guard as
    ``routes.parsers.import_file`` (reusing its ``_allowed_roots``), kept
    inline here rather than factored into a shared function that both routes
    call: that function's own docstring notes the guard is deliberately
    inline so static analysis (CodeQL) can see the taint→sink path sit
    entirely within one function body — the same reasoning applies here.
    """
    try:
        resolved = os.path.realpath(raw_path)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid path") from exc
    within_allowed = False
    for root in _allowed_roots():
        try:
            if os.path.commonpath((root, resolved)) == root:
                within_allowed = True
                break
        except ValueError:
            continue  # different drives (Windows) -> not under this root
    if not within_allowed:
        raise HTTPException(
            status_code=403,
            detail="path is outside the allowed roots (set QZ_DATA_ROOTS to widen)",
        )
    if not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail=f"file not found: {raw_path}")
    return Path(resolved)


@router.post("/books/data")
def book_data(req: BookDataRequest) -> dict[str, Any]:
    """One book's full DataStruct payload, by the id + source reference an
    import response's ``book_source``/lazy inventory entry gave the caller."""
    if not req.book_id:
        raise HTTPException(status_code=400, detail="book_id is required")
    if bool(req.path) == bool(req.token):
        raise HTTPException(
            status_code=400, detail="exactly one of path or token is required"
        )

    if req.token:
        resolved = resolve_upload_token(req.token)
        if resolved is None:
            raise HTTPException(
                status_code=404,
                detail="upload expired — re-import the file to fetch this book",
            )
    else:
        assert req.path is not None
        resolved = _resolve_book_path(req.path)

    cached = get_cached_book(resolved, req.book_id)
    if cached is not None:
        return _book_payload(cached)

    # Cache miss: re-parse once and re-prime the cache for any sibling books
    # activated next.
    try:
        raw = resolved.read_bytes()
        _primary, all_books = read_origin_project_all(resolved, raw=raw)
    except (OriginProjectError, ValueError, KeyError, struct.error, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    books = drop_empty_library_books(all_books)
    cache_project_books(resolved, books)
    match = next(
        (b for b in books if str(b.metadata.get("origin_book", "")) == req.book_id),
        None,
    )
    if match is None:
        raise HTTPException(status_code=404, detail=f"book not found: {req.book_id}")
    return _book_payload(match)
