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

__all__ = [
    "XSource", "XYSource", "YSource", "expand_runs", "gather_xy", "json_equivalent", "source_x",
    "source_xy",
    "source_xyw", "source_y",
]

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
        _check_source(
            {"x": self.x, "y": self.y},
            (self.dataset, self.dataset_handle),
            {"x_channel": self.x_channel, "y_channel": self.y_channel, "rows": self.rows},
        )
        return self


def _check_source(
    arrays: dict[str, Any], dataset: tuple[Any, Any], selection: dict[str, Any]
) -> None:
    """The one-source rule shared by every ``*Source`` model: the arrays, OR
    a dataset (``dataset`` / ``dataset_handle``) with its channels and rows."""
    by_rows = any(v is not None for v in (*dataset, *selection.values()))
    if any(v is not None for v in arrays.values()):
        if by_rows:
            raise ValueError("send " + "/".join(arrays) + " or a dataset row selection, not both")
        if any(v is None for v in arrays.values()):
            raise ValueError(" and ".join(arrays) + " are both required")
    elif not by_rows:
        raise ValueError(" and ".join(arrays) + " are required (or a dataset row selection)")
    elif dataset[0] is None and dataset[1] is None:
        raise ValueError("a row selection needs dataset_handle (or dataset)")
    elif any(v is None for v in selection.values()):
        names = list(selection)
        raise ValueError("a row selection needs " + ", ".join(names[:-1]) + " and " + names[-1])


class YSource(BaseModel):
    """``y`` posted, or a dataset's ``y_channel`` at ``rows`` (ALS, rolling
    ball and ModPoly read ``y`` alone)."""

    y: list[float] | None = None
    dataset: dict[str, Any] | None = None
    dataset_handle: str | None = None
    y_channel: int | None = Field(default=None, ge=TIME_CHANNEL)
    rows: list[tuple[int, int]] | None = None

    @model_validator(mode="after")
    def _one_source(self) -> YSource:
        _check_source(
            {"y": self.y},
            (self.dataset, self.dataset_handle),
            {"y_channel": self.y_channel, "rows": self.rows},
        )
        return self


class XSource(BaseModel):
    """``x`` posted (``null`` = a gap), or a dataset's ``x_channel`` at
    ``rows``. A sample statistic drops gaps itself, so the gather keeps them
    (as NaN, which is what a posted ``null`` becomes)."""

    x: list[float | None] | None = None
    dataset: dict[str, Any] | None = None
    dataset_handle: str | None = None
    x_channel: int | None = Field(default=None, ge=TIME_CHANNEL)
    rows: list[tuple[int, int]] | None = None

    @model_validator(mode="after")
    def _one_source(self) -> XSource:
        _check_source(
            {"x": self.x},
            (self.dataset, self.dataset_handle),
            {"x_channel": self.x_channel, "rows": self.rows},
        )
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


def _json_doubles(col: NDArray[np.float64], idx: NDArray[np.intp]) -> NDArray[np.float64]:
    """The rows of ``col`` as ``JSON.stringify`` would write them: ``-0`` as
    ``+0`` (``-0 + 0 == +0`` in IEEE-754; every other double unchanged)."""
    return np.add(col[idx], 0.0)


def _finite(*cols: NDArray[np.float64]) -> None:
    if not all(np.isfinite(c).all() for c in cols):
        raise ValueError("the row selection includes a gap (a non-finite x or y)")


def gather_xy(
    ds: DataStruct, x_channel: int, y_channel: int, runs: list[tuple[int, int]]
) -> tuple[list[float], list[float]]:
    """``x``/``y`` exactly as the array path would have parsed them (module
    doc): the rows of the two channels, ``-0`` written as ``+0``, and a
    ``ValueError`` for a non-finite value the array path cannot carry."""
    idx = expand_runs(runs, len(ds.time))
    x = _json_doubles(_column(ds, x_channel), idx)
    y = _json_doubles(_column(ds, y_channel), idx)
    _finite(x, y)
    return x.tolist(), y.tolist()


def _resolve(
    req: Any, response: Response, runs: list[tuple[int, int]]
) -> tuple[DataStruct, NDArray[np.intp]]:
    """The request's dataset (409 on an unknown handle; a posted ``dataset``
    is cached and its handle set as ``X-Dataset-Handle`` on ``response``, so
    only a successful response carries it) and its row indices."""
    ds, handle = resolve_or_409(
        CachedDatasetRequest(dataset=req.dataset, dataset_handle=req.dataset_handle))
    idx = expand_runs(runs, len(ds.time))
    if handle is not None:
        response.headers["X-Dataset-Handle"] = handle
    return ds, idx


def _by_rows(req: Any, response: Response, channels: list[int]) -> list[NDArray[np.float64]]:
    """``channels`` of the request's dataset at its rows, as the array path
    would have parsed them (``-0`` -> ``+0``). 422 for a bad channel / rows."""
    try:
        ds, idx = _resolve(req, response, req.rows)
        return [_json_doubles(_column(ds, c), idx) for c in channels]
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def source_xy(req: XYSource, response: Response) -> tuple[list[float], list[float]]:
    """The request's ``x``/``y``: posted, or gathered from its dataset.

    409 for an unknown handle, 422 for a bad channel or selection."""
    if req.x is not None and req.y is not None:
        return req.x, req.y
    assert req.x_channel is not None and req.y_channel is not None
    x, y = _by_rows(req, response, [req.x_channel, req.y_channel])
    return _gathered_pair(x, y)


def _gathered_pair(
    x: NDArray[np.float64], y: NDArray[np.float64]
) -> tuple[list[float], list[float]]:
    try:
        _finite(x, y)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return x.tolist(), y.tolist()


def source_xyw(
    req: XYSource, response: Response, dy_channel: int | None, weights_channel: int | None
) -> tuple[list[float], list[float], list[float] | None, list[float] | None]:
    """``source_xy`` plus the fit's weight columns read from the same dataset
    and rows: ``dy`` is ``|column|`` (the client's ``dyForFit`` takes the abs of
    an error column), ``weights`` the column as is. ``None`` for a channel not
    asked for. A channel needs a dataset selection (422 with posted x/y)."""
    if dy_channel is None and weights_channel is None:
        x, y = source_xy(req, response)
        return x, y, None, None
    if req.x is not None and req.y is not None:
        raise HTTPException(
            status_code=422, detail="dy_channel / weights_channel need a dataset row selection")
    assert req.x_channel is not None and req.y_channel is not None
    wanted = [c for c in (dy_channel, weights_channel) if c is not None]
    cols = _by_rows(req, response, [req.x_channel, req.y_channel, *wanted])
    x, y = _gathered_pair(cols[0], cols[1])
    for c in cols[2:]:
        _gathered_pair(c, c)  # a non-finite weight is a gap the array path cannot carry
    rest = iter(cols[2:])
    dy = np.abs(next(rest)).tolist() if dy_channel is not None else None
    weights = next(rest).tolist() if weights_channel is not None else None
    return x, y, dy, weights


def source_y(req: YSource, response: Response) -> list[float]:
    """``y`` posted, or gathered (finite) from the dataset."""
    if req.y is not None:
        return req.y
    assert req.y_channel is not None
    (y,) = _by_rows(req, response, [req.y_channel])
    return _gathered_pair(y, y)[0]


def source_x(req: XSource, response: Response) -> NDArray[np.float64]:
    """The sample as floats with gaps as NaN: posted (``null`` -> NaN) or
    gathered (a non-finite value is what ``JSON.stringify`` writes as
    ``null``, so it is NaN here too)."""
    if req.x is not None:
        return np.asarray([np.nan if v is None else v for v in req.x], dtype=float)
    assert req.x_channel is not None
    (x,) = _by_rows(req, response, [req.x_channel])
    return np.where(np.isfinite(x), x, np.nan)


def json_equivalent(ds: DataStruct) -> DataStruct:
    """``ds`` as the array path would have parsed it from the client's JSON:
    ``-0`` as ``+0`` and a non-finite value as NaN (``JSON.stringify`` writes
    ``null`` for Infinity and ``"0"`` for ``-0``). Used when a whole cached
    dataset replaces a posted one."""
    def clean(a: NDArray[np.float64]) -> NDArray[np.float64]:
        out = np.add(np.asarray(a, dtype=float), 0.0)
        return np.where(np.isfinite(out), out, np.nan)
    return DataStruct.from_dict(
        {**ds.to_dict(), "time": clean(ds.time), "values": clean(ds.values)})
