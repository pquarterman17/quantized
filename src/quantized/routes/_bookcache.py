"""Small bounded LRU cache of one Origin project's per-book DataStructs, keyed
by ``(resolved path, mtime)`` -- the lazy per-book transport's speed-up
(``ORIGIN_FILE_DECODE_PLAN`` #38).

``/api/parsers/import``/``upload`` already parse the WHOLE project once
(``read_origin_project_all``) to build the primary payload + the per-book
inventory; this module caches that same book list so a later
``/api/parsers/books/data`` fetch (a book's first activation in the UI) is a
plain dict lookup, not a second ~4s reparse of a 122-book / 8.5M-cell project.

Lives in ``routes/`` (not ``io/``): it is a transport-layer cache of HTTP
access patterns, not a parsing concern -- ``io/origin_project`` stays a pure
reader with no notion of "recently imported". Bounded (a handful of projects)
and mtime-keyed so an edited-on-disk file is never served stale.
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

from quantized.datastruct import DataStruct

__all__ = ["cache_project_books", "get_cached_book"]

_MAX_PROJECTS = 4
_cache: OrderedDict[tuple[str, float], dict[str, DataStruct]] = OrderedDict()


def _book_id(ds: DataStruct) -> str:
    return str(ds.metadata.get("origin_book", ""))


def cache_project_books(path: Path, books: list[DataStruct]) -> None:
    """Cache every book of one already-parsed project, keyed by the path's
    CURRENT mtime. A later call with a changed mtime lands under a new key
    (the old one just ages out via the LRU bound below) -- automatic
    invalidation on file edit, no explicit eviction needed for that case."""
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return
    key = (str(path), mtime)
    _cache[key] = {_book_id(b): b for b in books}
    _cache.move_to_end(key)
    while len(_cache) > _MAX_PROJECTS:
        _cache.popitem(last=False)


def get_cached_book(path: Path, book_id: str) -> DataStruct | None:
    """The requested book if the project is cached at its CURRENT mtime, else
    ``None`` (cold cache, evicted, or the file changed on disk since caching)."""
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    key = (str(path), mtime)
    by_id = _cache.get(key)
    if by_id is None:
        return None
    _cache.move_to_end(key)
    return by_id.get(book_id)
