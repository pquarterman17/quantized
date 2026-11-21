"""Analysis inputs by dataset handle (P4 phase 3, plans/LARGE_PAYLOAD_PLAN.md).

A Curve Fit of 1M rows posted ``x`` and ``y`` (38.6 MB of JSON) that the
client had sliced out of a dataset the server already holds in
``_datasetcache`` (the import route cached it and sent ``X-Dataset-Handle``;
every plot fetch references it by that handle). ``XYSource`` is the opt-in
alternative: the request names the dataset (``dataset_handle``, or the full
``dataset`` once, after a 409), the two channels and a run-length row
selection, and the route gathers ``x``/``y`` itself.

The selection rules stay on the client. Which rows a fit reads -- the
analysis view (manual exclusions, the Data Filter), an analysis selection
(row ids, an X range), the gap drop (a pair with a non-finite coordinate) --
and which X a Y is read against (per-series X: R2 in T1,R1,T2,R2 reads T2)
are resolved by the client exactly as before, into ``x_channel`` and the
fitted rows. The server does not re-derive them: the row state is client
state (exclusions, a filter predicate, a selection) it would have to be sent
anyway, and two implementations of a rule can drift. What the server mirrors
is the encoding of the posted arrays, so the gathered doubles are the ones
the array path would have parsed (``gather_xy``):

* a JSON array cannot carry NaN/Inf, so the client drops those pairs: a
  gathered non-finite value means the selection is not one the array path
  could send -- 422, never a fit on it;
* ``JSON.stringify(-0)`` is ``"0"``: the array path fits ``+0`` where the
  dataset holds ``-0``, so the gather adds ``0.0`` (``-0 + 0 == +0`` in
  IEEE-754, every other double unchanged).

Cache red-team (every input the gathered arrays depend on is in the request):
the handle is the content hash of the cached dataset (``hash_dataset``: time,
values, labels, units, metadata), so it names immutable content; the channels
and the rows are in the body; the rules are their output. Nothing is cached
under a key of this module's own. A miss is 409 (``resolve_or_409``) and the
client resends the full dataset once (``lib/api/datasetCache.ts``), which the
route caches; a successful response carries its new ``X-Dataset-Handle`` (an
error response does not, and the client then posts arrays next time).

Rows are ``[start, count]`` runs, strictly ascending and disjoint (a fit's
rows always are), so the gathered length never exceeds the dataset's.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException, Response
from numpy.typing import NDArray
from pydantic import BaseModel, Field, model_validator

from quantized.datastruct import DataStruct
from quantized.routes._datasetcache import CachedDatasetRequest, resolve_or_409
from quantized.routes._errors import CALC_ERRORS

__all__ = ["XYSource", "expand_runs", "gather_xy", "source_xy"]

TIME_CHANNEL = -1


class XYSource(BaseModel):
    """``x``/``y`` posted, or a dataset row selection (module doc)."""

    x: list[float] | None = None
    y: list[float] | None = None
    # Phase 3: the dataset's handle (or, after a 409, the dataset itself),
    # the X and Y channel (-1 = the time column) and the fitted rows as
    # [start, count] runs. Send these OR x/y, never both.
    dataset: dict[str, Any] | None = None
    dataset_handle: str | None = None
    x_channel: int | None = Field(default=None, ge=TIME_CHANNEL)
    y_channel: int | None = Field(default=None, ge=TIME_CHANNEL)
    rows: list[tuple[int, int]] | None = None

    @model_validator(mode="after")
    def _one_source(self) -> XYSource:
        selection = (self.dataset, self.dataset_handle, self.x_channel, self.y_channel, self.rows)
        by_rows = any(v is not None for v in selection)
        if self.x is not None or self.y is not None:
            if by_rows:
                raise ValueError("send x/y or a dataset row selection, not both")
            if self.x is None or self.y is None:
                raise ValueError("x and y are both required")
        elif not by_rows:
            raise ValueError("x and y are required (or a dataset row selection)")
        elif self.dataset is None and self.dataset_handle is None:
            raise ValueError("a row selection needs dataset_handle (or dataset)")
        elif self.x_channel is None or self.y_channel is None or self.rows is None:
            raise ValueError("a row selection needs x_channel, y_channel and rows")
        return self


def expand_runs(runs: list[tuple[int, int]], n: int) -> NDArray[np.intp]:
    """The row indices of ``[start, count]`` runs over ``n`` rows.

    Raises ``ValueError`` unless every run is non-empty, inside ``0..n-1``,
    and starts after the previous one ends."""
    end = 0
    for start, count in runs:
        if count < 1 or start < end or start + count > n:
            raise ValueError(
                f"rows must be ascending, disjoint [start, count] runs inside {n} rows")
        end = start + count
    if not runs:
        return np.zeros(0, dtype=np.intp)
    starts = np.array([r[0] for r in runs], dtype=np.intp)
    counts = np.array([r[1] for r in runs], dtype=np.intp)
    offsets = np.repeat(starts - (np.cumsum(counts) - counts), counts)
    return np.asarray(np.arange(int(counts.sum()), dtype=np.intp) + offsets, dtype=np.intp)


def _column(ds: DataStruct, channel: int) -> NDArray[np.float64]:
    if channel == TIME_CHANNEL:
        return np.asarray(ds.time, dtype=float)
    if channel >= ds.values.shape[1]:
        raise ValueError(f"channel {channel} is outside the dataset's {ds.values.shape[1]}")
    return np.asarray(ds.values[:, channel], dtype=float)


def gather_xy(
    ds: DataStruct, x_channel: int, y_channel: int, runs: list[tuple[int, int]]
) -> tuple[list[float], list[float]]:
    """``x``/``y`` exactly as the array path would have parsed them (module
    doc): the rows of the two channels, ``-0`` written as ``+0``, and a
    ``ValueError`` for a non-finite value the array path cannot carry."""
    idx = expand_runs(runs, len(ds.time))
    x = np.add(_column(ds, x_channel)[idx], 0.0)
    y = np.add(_column(ds, y_channel)[idx], 0.0)
    if not (np.isfinite(x).all() and np.isfinite(y).all()):
        raise ValueError("the row selection includes a gap (a non-finite x or y)")
    return x.tolist(), y.tolist()


def source_xy(req: XYSource, response: Response) -> tuple[list[float], list[float]]:
    """The request's ``x``/``y``: posted, or gathered from its dataset.

    409 for an unknown handle, 422 for a bad channel or selection. A posted
    ``dataset`` is cached and its handle set as ``X-Dataset-Handle`` on
    ``response`` (so only a successful response carries it)."""
    if req.x is not None and req.y is not None:
        return req.x, req.y
    assert req.x_channel is not None and req.y_channel is not None and req.rows is not None
    try:
        ds, handle = resolve_or_409(
            CachedDatasetRequest(dataset=req.dataset, dataset_handle=req.dataset_handle))
        x, y = gather_xy(ds, req.x_channel, req.y_channel, req.rows)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if handle is not None:
        response.headers["X-Dataset-Handle"] = handle
    return x, y
