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

Phase 2 (``display_points`` with ``return_residuals: false``): the full
``yFit`` -- and a weighted fit's per-point ``obsVar`` -- leave the wire too.
The body carries ``yFitDisplay`` (``rows`` into the posted points and their
``y``: the curve's per-bucket min/max plus its gap edges,
``calc.decimate.display_row_indices``) for the overlay, and the full arrays
stay here with the posted ``x``. ``/curve`` returns them by id for the
full-resolution consumers (Freeze, write-to-sheet, export, residuals) and
``/bands`` takes the id for ``obsVar``. A miss is the same 409; the client
then evaluates the model at its own ``x`` (bit-identical: the same
``evaluate`` on the same doubles) or resends the weights for ``obsVar``.

Every pre-existing caller (no ``return_residuals``) gets the byte-identical
response it always got, and nothing is stored for it.

Cache red-team (every input the stored output depends on): the entry is the
fit's own request arrays (``x``, ``y``, resolved weights) and its own outputs
(``yFit``, ``obsVar``), written once under a fresh random id and never
mutated, so an id can only ever name the one fit that created it -- no
content key can alias two fits (different weights, ``stats_version``, bounds
or a later edit of the data all produce a different id). ``display_points``
shapes only the response, never the entry. What the id does NOT certify is
that the CLIENT's rows still match: the client checks the returned length
against the rows it mapped the fit onto, and a saved figure re-validates its
rows key before it uses the id at all (frontend lib/figureOverlays).

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

from quantized.calc.decimate import display_row_indices
from quantized.routes._payload import to_jsonable

__all__ = ["StoredFit", "clear_fit_results", "fit_response", "resolve_fit_or_409", "store_stats"]

_MAX_ENTRIES = 16
# 1M rows x 8 B per array: 24 MB per lean fit (y, residuals' yFit, weights),
# 40 MB with a display curve (+ x and obsVar), so >= 4 such fits stay.
_MAX_TOTAL_BYTES = 192 * 1024 * 1024


@dataclass(frozen=True)
class StoredFit:
    """What a residual follow-up needs, exactly as the wire would have
    carried it: non-finite entries are NaN (a JSON ``null`` decodes to NaN on
    the by-array path too), so by-id and by-array diagnostics see the same
    numbers. ``weights`` is the fit's own resolved weight vector, or None.
    ``x`` / ``y_fit`` / ``obs_var`` are kept only for a display-curve fit
    (phase 2): the posted x and the full curve and per-point variance the
    response left out."""

    y: NDArray[np.float64]
    y_fit: NDArray[np.float64]
    weights: NDArray[np.float64] | None
    x: NDArray[np.float64] | None = None
    obs_var: NDArray[np.float64] | None = None
    full_curve: bool = False

    @property
    def residuals(self) -> NDArray[np.float64]:
        """``y - yFit``: what ``curve_fit`` computed (``yv - y_fit``), with a
        non-finite result NaN as on the wire (``y - NaN`` is NaN)."""
        out = self.y - self.y_fit
        out[~np.isfinite(out)] = np.nan
        return out

    @property
    def nbytes(self) -> int:
        arrays = (self.y, self.y_fit, self.weights, self.x, self.obs_var)
        return int(sum(a.nbytes for a in arrays if a is not None))


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
    result: dict[str, Any],
    xy: tuple[ArrayLike, ArrayLike],
    weights: ArrayLike | None,
    return_residuals: bool,
    display_points: int | None = None,
) -> dict[str, Any]:
    """The JSON body for a ``curve_fit`` result fitted to ``xy`` = (x, y).

    ``return_residuals`` True: ``to_jsonable(result)``, unchanged. False: the
    same body minus ``residuals``, plus ``resultId`` (null when the arrays are
    too large to keep). With ``display_points`` as well, ``yFit`` and
    ``obsVar`` leave too and ``yFitDisplay`` comes back (module doc). Every
    parameter and statistic is the same object either way -- only per-point
    display arrays leave the wire.
    """
    if return_residuals:
        return to_jsonable(result)  # type: ignore[no-any-return]
    display = display_points is not None
    dropped = ("residuals", "yFit", "obsVar") if display else ("residuals",)
    out: dict[str, Any] = to_jsonable({k: v for k, v in result.items() if k not in dropped})
    y_fit = _wire(result["yFit"])
    obs = result.get("obsVar")
    out["resultId"] = _keep(
        StoredFit(
            y=_wire(xy[1]),
            y_fit=y_fit,
            weights=None if weights is None else _wire(weights),
            x=_wire(xy[0]) if display else None,
            obs_var=None if not display or obs is None else _wire(obs),
            full_curve=display,
        )
    )
    if display_points is not None:
        rows = display_row_indices(y_fit, display_points)
        out["yFitDisplay"] = {"rows": rows.tolist(), "y": to_jsonable(y_fit[rows])}
    return out


def resolve_fit_or_409(result_id: str, *, full_curve: bool = False) -> StoredFit:
    """The stored arrays for ``result_id`` (refreshing its LRU slot), or
    HTTP 409 ``unknown_fit_result`` so the client resends the arrays.
    ``full_curve``: only an entry that kept its display-curve arrays (``x``,
    ``obsVar``) answers; a phase-1 entry is a miss too (its client holds the
    full curve already)."""
    with _lock:
        entry = _store.get(result_id)
        if entry is not None and (entry.full_curve or not full_curve):
            _store.move_to_end(result_id)
        else:
            entry = None
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
