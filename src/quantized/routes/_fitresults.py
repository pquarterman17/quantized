"""Server-side store of a fit's full-resolution per-point arrays (P4 lane,
plans/LARGE_PAYLOAD_PLAN.md).

A curve fit's response used to carry two per-point arrays, ``yFit`` and
``residuals`` (measured: 8 MB at 200k rows, 40 MB at 1M), and every
follow-up that needs the residuals -- ``/api/fitting/diagnostics`` for the
Diagnostics section and the Q-Q residual plot -- posted ``y`` AND
``residuals`` straight back (another 39 MB up, 38 MB down at 1M). The server
already had both. A client that opts in with ``return_residuals: false``
(``_fit_options.FitOptions``) gets a lean response instead:

* ``residuals`` is left out. It is exactly ``y - yFit`` (``calc.fitting.
  curve_fit``: ``residuals = yv - y_fit``), and one IEEE-754 subtraction of
  the same two doubles gives the same double in the browser, so the client
  rebuilds it bit for bit (``frontend/src/lib/fitResiduals.ts``) for the
  write-to-sheet, report and residual-plot consumers.
* ``resultId`` names the full arrays kept here, so ``/diagnostics`` takes the
  id instead of the arrays. A miss (evicted, or a server restart since a
  saved workspace recorded the id) is HTTP 409, and the client resends the
  arrays it still holds -- the same contract as ``_datasetcache``.

Every pre-existing caller (no ``return_residuals``) gets the byte-identical
response it always got, and nothing is stored for it.

Transport only (routes/): ``calc/`` has no notion of "a result seen before".
Bounded by entries and bytes, LRU-evicted, thread-safe (sync routes run in
FastAPI's threadpool). The id is random, not a content hash: two fits of the
same data must not share the entry of a later, different fit's weights.
"""

from __future__ import annotations

import secrets
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

import numpy as np
from fastapi import HTTPException
from numpy.typing import ArrayLike, NDArray

from quantized.routes._payload import to_jsonable

__all__ = ["StoredFit", "clear_fit_results", "fit_response", "resolve_fit_or_409", "store_stats"]

_MAX_ENTRIES = 16
_MAX_TOTAL_BYTES = 192 * 1024 * 1024  # 1M rows x 3 arrays x 8 B = 24 MB per fit


@dataclass(frozen=True)
class StoredFit:
    """What a residual follow-up needs, exactly as the wire would have
    carried it: non-finite entries are NaN (a JSON ``null`` decodes to NaN on
    the by-array path too), so by-id and by-array diagnostics see the same
    numbers. ``weights`` is the fit's own resolved weight vector, or None."""

    y: NDArray[np.float64]
    residuals: NDArray[np.float64]
    weights: NDArray[np.float64] | None

    @property
    def nbytes(self) -> int:
        w = 0 if self.weights is None else self.weights.nbytes
        return int(self.y.nbytes + self.residuals.nbytes + w)


_lock = threading.Lock()
_store: OrderedDict[str, StoredFit] = OrderedDict()


def _wire(a: ArrayLike) -> NDArray[np.float64]:
    arr = np.array(a, dtype=float).ravel()
    arr[~np.isfinite(arr)] = np.nan
    arr.flags.writeable = False
    return arr


def _keep(entry: StoredFit) -> str | None:
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


def fit_response(
    result: dict[str, Any], y: ArrayLike, weights: ArrayLike | None, return_residuals: bool
) -> dict[str, Any]:
    """The JSON body for a ``curve_fit`` result.

    ``return_residuals`` True: ``to_jsonable(result)``, unchanged. False: the
    same body minus ``residuals``, plus ``resultId`` (null when the arrays are
    too large to keep). Every parameter and statistic is the same object
    either way -- only the per-point display array leaves the wire.
    """
    if return_residuals:
        return to_jsonable(result)  # type: ignore[no-any-return]
    lean = {k: v for k, v in result.items() if k != "residuals"}
    out: dict[str, Any] = to_jsonable(lean)
    out["resultId"] = _keep(
        StoredFit(
            y=_wire(y),
            residuals=_wire(result["residuals"]),
            weights=None if weights is None else _wire(weights),
        )
    )
    return out


def resolve_fit_or_409(result_id: str) -> StoredFit:
    """The stored arrays for ``result_id`` (refreshing its LRU slot), or
    HTTP 409 ``unknown_fit_result`` so the client resends the arrays."""
    with _lock:
        entry = _store.get(result_id)
        if entry is not None:
            _store.move_to_end(result_id)
    if entry is None:
        raise HTTPException(status_code=409, detail="unknown_fit_result")
    return entry


def clear_fit_results() -> None:
    """Drop every stored fit (lifespan shutdown and tests)."""
    with _lock:
        _store.clear()


def store_stats() -> dict[str, int]:
    """Introspection for tests: entry count and bytes held."""
    with _lock:
        return {"entries": len(_store), "bytes": sum(e.nbytes for e in _store.values())}
