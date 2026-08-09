"""Server-side dataset cache keyed by content hash (RSM_CUTS_PLAN item 18).

Every map fetch and every RSM cut currently re-POSTs the WHOLE DataStruct as
JSON -- measured on the real corpus: ``m3learning_rsm.xrdml`` is 465,885
points / 45.5 MB, costing 1.9s server-side encode and 1.15s decode PER CALL,
paid again on every channel change and every 2theta/omega <-> Q toggle even
though the underlying dataset never changed. This module lets a client send
the full payload ONCE, then reference it by a short handle on every later
call to ``/api/plot/map`` or any ``/api/rsm/*`` endpoint.

Follows the ``_bookcache.py`` precedent (an in-memory, bounded, LRU
``OrderedDict[str, DataStruct]``), not ``_uploadcache.py``'s disk-staged
token precedent: the values cached here are already-decoded DataStructs
served entirely from process memory for the life of the cache entry, with no
on-disk artifact and no filesystem path to key from -- ``_uploadcache.py``'s
staging exists specifically to bridge the gap between an upload finishing and
a LATER lazy per-book fetch touching the same BYTES ON DISK, which does not
apply here (there is no "book" boundary, and nothing about a map's cache
entry should survive a restart).

Handle = the server's own content hash of the dataset it received (see
``hash_dataset`` below), computed AFTER ``DataStruct.from_dict`` has already
built the ndarray buffers: hashing those raw buffers measured ~13ms for a
45 MB payload against the ~1.15s already paid to decode it -- roughly 1%
overhead on work that has to happen anyway. Content hashing (not a random
token) means the SAME dataset sent twice -- a second browser tab, a reload,
two callers deriving the same cut on the same map -- always lands on the
same cache entry rather than duplicating it.

Client-side hashing was measured and rejected (see the frontend
``lib/api/datasetCache.ts`` doc for the browser-side numbers): the frontend
keeps ``DataStruct.values`` as plain nested ``number[][]``, not typed arrays,
so a client hash pass would cost close to the ``JSON.stringify`` this cache
exists to avoid, for a benefit (cross-instance content dedup) the real
workflow never needs -- repeat calls on an already-loaded map keep reusing
the SAME in-memory object, which a client-side WeakMap captures for free
with zero hashing.

Lives in routes/ (not calc/): this is an HTTP transport cache with no
domain meaning of its own -- ``calc/`` stays free of any notion of "a
dataset was seen before" (enforced by ``test_repo_integrity``'s layering
guard, which forbids fastapi/pydantic imports in calc/io/plugins).

Bounded by BOTH entry count and total bytes (local-server-hardening: an
unbounded cache of multi-hundred-MB arrays is a memory leak with extra
steps), LRU-evicting whichever bound is hit first. 256 MiB / 16 entries
holds roughly a dozen of the largest real map (~22 MB decoded) at once --
generous for a single browser session's worth of open maps while still
capping worst-case RSS to a small, known fraction of a typical machine's
memory. Teardown is wired to the FastAPI lifespan shutdown hook
(``app.py``'s ``_app_lifespan``), never ``atexit`` (same rule -- atexit does
not reliably run for this run model).

Thread-safe: FastAPI runs SYNC path functions (every ``/api/rsm/*`` and
``/api/plot/map`` handler is a plain ``def``, not ``async def``) in a worker
threadpool, so concurrent requests can race on the cache for real -- two
browser tabs, or a fast double-toggle firing overlapping fetches. Every
mutation and every read-with-LRU-touch below holds ``_lock``.
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, model_validator

from quantized.datastruct import DataStruct

__all__ = [
    "CachedDatasetRequest",
    "DatasetHandleMiss",
    "cache_dataset",
    "cache_stats",
    "clear_cache",
    "hash_dataset",
    "resolve_dataset",
    "resolve_or_409",
]

_MAX_ENTRIES = 16
_MAX_TOTAL_BYTES = 256 * 1024 * 1024  # 256 MiB

_lock = threading.Lock()
_cache: OrderedDict[str, DataStruct] = OrderedDict()
_sizes: dict[str, int] = {}


class DatasetHandleMiss(Exception):
    """``dataset_handle`` names an unknown or evicted cache entry.

    Routes must translate this to HTTP 409 (see ``resolve_or_409``), never
    the generic 422 a malformed request gets -- the client's transport layer
    (``lib/api/datasetCache.ts``) tells the two apart by status code and
    answers a 409 by transparently resending the full dataset once.
    """


def _estimate_bytes(ds: DataStruct) -> int:
    return int(ds.time.nbytes + ds.values.nbytes)


def hash_dataset(ds: DataStruct) -> str:
    """Content hash of an already-decoded DataStruct's numeric payload.

    Hashes the raw ndarray buffers directly (not a JSON re-encode) -- see
    the module docstring for the measurement that motivated this. Labels and
    units are folded in too (so a relabelled column doesn't collide with
    different data); ``metadata`` is deliberately excluded -- two calls for
    literally the same map differing only in incidental metadata (e.g. an
    import timestamp) should still land on one cache entry.
    """
    hasher = hashlib.blake2b(digest_size=16)
    hasher.update(ds.time.tobytes())
    hasher.update(ds.values.tobytes())
    hasher.update("\x1f".join(ds.labels).encode())
    hasher.update("\x1f".join(ds.units).encode())
    return hasher.hexdigest()


def _evict_locked() -> None:
    """Caller must hold ``_lock``. Evict oldest entries until both bounds
    are satisfied (or the cache is empty)."""
    total = sum(_sizes.values())
    while _cache and (len(_cache) > _MAX_ENTRIES or total > _MAX_TOTAL_BYTES):
        oldest, _ = _cache.popitem(last=False)
        total -= _sizes.pop(oldest, 0)


def cache_dataset(ds: DataStruct) -> str:
    """Cache ``ds`` under its content hash and return the handle.

    Idempotent: re-caching identical content just refreshes its LRU
    position rather than duplicating an entry.
    """
    handle = hash_dataset(ds)
    size = _estimate_bytes(ds)
    with _lock:
        _cache[handle] = ds
        _cache.move_to_end(handle)
        _sizes[handle] = size
        _evict_locked()
    return handle


def resolve_dataset(handle: str) -> DataStruct:
    """The cached DataStruct for ``handle``, refreshing its LRU position.

    Raises :class:`DatasetHandleMiss` if ``handle`` is unknown or has been
    evicted.
    """
    with _lock:
        ds = _cache.get(handle)
        if ds is None:
            raise DatasetHandleMiss(handle)
        _cache.move_to_end(handle)
        return ds


def clear_cache() -> None:
    """Drop every cached dataset. Wired to the FastAPI lifespan shutdown
    hook in ``app.py`` (local-server-hardening: never ``atexit``)."""
    with _lock:
        _cache.clear()
        _sizes.clear()


def cache_stats() -> dict[str, int]:
    """Introspection for tests: current entry count and total bytes held."""
    with _lock:
        return {"entries": len(_cache), "bytes": sum(_sizes.values())}


class CachedDatasetRequest(BaseModel):
    """Shared ``dataset`` / ``dataset_handle`` contract for every cache-
    eligible route (``/api/plot/map`` + every ``/api/rsm/*`` endpoint that
    carries a dataset) -- ONE mixin instead of duplicating both fields (and
    the "at least one of them" rule) across nine request models by hand.

    Callers supply EITHER the full ``dataset`` payload (always accepted,
    always (re)cached under its content hash) OR a ``dataset_handle`` from a
    prior call's ``X-Dataset-Handle`` response header -- never neither.
    ``dataset`` wins when both are present (a client should never need to
    send both, but resolving deterministically rather than 422ing on it
    keeps this a non-issue). The handle rides as a RESPONSE HEADER, never a
    body field -- every existing response shape (DataStruct payload, stats
    dict, analysis result) stays byte-identical; only ``routes/rsm.py`` and
    ``routes/plot.py`` need touch the header, via ``resolve_or_409``'s
    return value.
    """

    dataset: dict[str, Any] | None = None
    dataset_handle: str | None = None

    @model_validator(mode="after")
    def _dataset_or_handle(self) -> CachedDatasetRequest:
        if self.dataset is None and self.dataset_handle is None:
            raise ValueError("either dataset or dataset_handle is required")
        return self

    def resolve(self) -> tuple[DataStruct, str]:
        """``(DataStruct, handle)`` -- caches ``dataset`` when given, else
        looks up ``dataset_handle``. Raises :class:`DatasetHandleMiss` on an
        unknown/evicted handle; raises ``ValueError``/``KeyError`` (via
        ``DataStruct.from_dict``) on a malformed ``dataset`` exactly as
        before this cache existed -- routes keep catching those the same
        way (see ``resolve_or_409``, which only intercepts the miss case)."""
        if self.dataset is not None:
            ds = DataStruct.from_dict(self.dataset)
            return ds, cache_dataset(ds)
        assert self.dataset_handle is not None  # guaranteed by the validator above
        return resolve_dataset(self.dataset_handle), self.dataset_handle


def resolve_or_409(req: CachedDatasetRequest) -> tuple[DataStruct, str]:
    """``req.resolve()``, translating an unknown/evicted handle to HTTP 409.

    Call this INSIDE a route's existing
    ``try: ... except (ValueError, KeyError, IndexError):`` block. The
    ``HTTPException`` raised here is none of those three types, so it passes
    through untouched to FastAPI's own handling; a malformed ``dataset``
    still raises ``ValueError``/``KeyError`` from ``resolve()`` unchanged and
    is still caught (and turned into a 422) by the route's own except
    clause, exactly as before this cache existed.
    """
    try:
        return req.resolve()
    except DatasetHandleMiss as exc:
        raise HTTPException(status_code=409, detail="unknown_dataset_handle") from exc
