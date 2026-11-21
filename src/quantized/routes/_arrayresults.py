"""Server-side store of analysis RESULTS that are data, not display (P4 lane,
phase 4 of plans/LARGE_PAYLOAD_PLAN.md): a SNIP / ModPoly baseline, the
background of a peak search, a signal-op result dataset.

``_fitresults`` keeps a fit's per-point arrays so a follow-up can name them.
These results differ in one way: they are SUBTRACTED and written to new
worksheets, so they can never be decimated. The wire carries what a preview
needs (a per-bucket min/max display, ``calc.decimate.display_row_indices``)
plus a ``resultId``; the full result crosses the wire once, only when the
user commits it (``/api/results/arrays`` and ``/dataset``), and a peak fit
names a find's background by id instead of posting it back (38 MB at 1M rows).

A client opts in per request (``return_baseline: false``,
``return_background: false``, ``return_dataset: false``); a request without
the field gets the byte-identical response it always got and nothing is
stored. A miss is HTTP 409 ``unknown_result`` (evicted, a server restart, a
reopened workspace) and the client re-sends the inputs it holds and asks for
the full response: the calc is deterministic, so the arrays it gets back are
the ones the id named.

Cache red-team (every input the stored output depends on): an entry is one
call's own OUTPUT, written once under a fresh random id and never mutated
(read-only arrays, a frozen ``DataStruct``). There is no content key, so no
two calls can alias, and a different method / parameter / row selection
cannot reach a stale entry: it makes a new call and a new id. What an id does
NOT certify is that the caller's x / y are still the ones it was computed
from, so an entry that is later USED WITH client data records a fingerprint
of its inputs (``fingerprint``: blake2b of the exact float64 bytes of x and
y) and ``require_fingerprint`` answers a mismatch with the same 409. Only
``/peaks/fit`` uses the result against posted data (the find's background is
index-aligned with the fit's x / y); the baseline and dataset entries are
returned whole, never combined server-side. ``kind`` stops a baseline id
being read as a dataset or the reverse.

Transport only (routes/): ``calc/`` has no notion of "a result seen before".
Bounded by entries and bytes, LRU-evicted, thread-safe (sync routes run in
FastAPI's threadpool).
"""

from __future__ import annotations

import hashlib
import secrets
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from fastapi import HTTPException
from numpy.typing import ArrayLike, NDArray

from quantized.calc.decimate import display_row_indices
from quantized.datastruct import DataStruct
from quantized.routes._payload import to_jsonable

__all__ = [
    "StoredResult",
    "clear_results",
    "fingerprint",
    "lean_array_fields",
    "lean_dataset_fields",
    "require_fingerprint",
    "resolve_result_or_409",
    "store_stats",
]

_MAX_ENTRIES = 16
# One 1M-row array is 8 MB; a 1M x 7 dataset 56 MB. 256 MiB holds several.
_MAX_TOTAL_BYTES = 256 * 1024 * 1024


@dataclass(frozen=True)
class StoredResult:
    """One call's immutable output. ``arrays`` for a baseline / background,
    ``data`` for a signal-op dataset; ``digest`` is the fingerprint of the x
    and y it was computed from (or None)."""

    kind: str
    arrays: dict[str, NDArray[np.float64]] = field(default_factory=dict)
    data: DataStruct | None = None
    digest: str | None = None

    @property
    def nbytes(self) -> int:
        n = sum(a.nbytes for a in self.arrays.values())
        if self.data is not None:
            n += self.data.time.nbytes + self.data.values.nbytes
        return n


_lock = threading.Lock()
_store: OrderedDict[str, StoredResult] = OrderedDict()


def fingerprint(x: ArrayLike, y: ArrayLike) -> str:
    """Digest of the exact float64 bytes of ``x`` and ``y``."""
    h = hashlib.blake2b(digest_size=16)
    for a in (x, y):
        arr = np.ascontiguousarray(np.asarray(a, dtype=np.float64).ravel())
        h.update(len(arr).to_bytes(8, "little"))
        h.update(arr.tobytes())
    return h.hexdigest()


def _keep(entry: StoredResult) -> str | None:
    """Store ``entry``; its id, or None when it alone exceeds the byte bound
    (a doomed id would 409 on every use -- ``_datasetcache.cache_dataset``)."""
    if entry.nbytes > _MAX_TOTAL_BYTES:
        return None
    rid = secrets.token_hex(16)
    with _lock:
        _store[rid] = entry
        total = sum(e.nbytes for e in _store.values())
        while len(_store) > _MAX_ENTRIES or total > _MAX_TOTAL_BYTES:
            _, old = _store.popitem(last=False)
            total -= old.nbytes
    return rid


def lean_array_fields(
    kind: str,
    key: str,
    arr: ArrayLike,
    display_points: int | None,
    *,
    digest: str | None = None,
) -> dict[str, Any]:
    """The lean-response fields for a result array: ``resultId`` and, with
    ``display_points``, ``<key>Display`` = ``{rows, y}`` (the array's
    per-bucket min/max rows plus its non-finite run edges). ``resultId`` is
    null when the array exceeds the store's byte bound (the client then asks
    for the full response)."""
    frozen = np.array(arr, dtype=float).ravel()
    frozen.flags.writeable = False
    out: dict[str, Any] = {"resultId": _keep(StoredResult(kind, {key: frozen}, digest=digest))}
    if display_points is not None:
        rows = display_row_indices(frozen, display_points)
        out[f"{key}Display"] = {"rows": rows.tolist(), "y": to_jsonable(frozen[rows])}
    return out


def lean_dataset_fields(data: DataStruct, display_points: int | None) -> dict[str, Any]:
    """Lean-response fields for a result dataset: ``resultId`` and, with
    ``display_points``, ``datasetDisplay`` = ``{rows, time, values}``: the
    union over every channel of the per-bucket min/max rows (and gap edges),
    ascending, with the dataset's own ``time`` and ``values`` at those rows."""
    out: dict[str, Any] = {"resultId": _keep(StoredResult("sigop", data=data))}
    if display_points is not None:
        values = np.asarray(data.values, dtype=float)
        rows = np.array([], dtype=np.intp)
        for j in range(values.shape[1] if values.ndim == 2 else 0):
            rows = np.union1d(rows, display_row_indices(values[:, j], display_points))
        out["datasetDisplay"] = {
            "rows": rows.tolist(),
            "time": to_jsonable(data.time[rows]),
            "values": to_jsonable(values[rows]),
        }
    return out


def resolve_result_or_409(result_id: str, kind: str) -> StoredResult:
    """The stored result for ``result_id`` (refreshing its LRU slot), or HTTP
    409 ``unknown_result`` so the client resends its inputs. An id of another
    ``kind`` is a miss too."""
    with _lock:
        entry = _store.get(result_id)
        if entry is not None and entry.kind == kind:
            _store.move_to_end(result_id)
        else:
            entry = None
    if entry is None:
        raise HTTPException(status_code=409, detail="unknown_result")
    return entry


def require_fingerprint(entry: StoredResult, x: ArrayLike, y: ArrayLike) -> None:
    """409 unless ``entry`` was computed from exactly this ``x`` and ``y``."""
    if entry.digest is None or entry.digest != fingerprint(x, y):
        raise HTTPException(status_code=409, detail="unknown_result")


def clear_results() -> None:
    """Drop every stored result (lifespan shutdown and tests)."""
    with _lock:
        _store.clear()


def store_stats() -> dict[str, int]:
    """Introspection for tests: entry count and bytes held."""
    with _lock:
        return {"entries": len(_store), "bytes": sum(e.nbytes for e in _store.values())}
