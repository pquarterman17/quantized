"""Wire-serialization helpers for the route layer.

The pure DataStruct keeps NaN/Inf (they're real in scientific data); valid wire
JSON has no representation for them, so the HTTP boundary maps non-finite floats
to ``null`` (which uPlot renders as a gap). Lives in routes/ — it's transport,
not domain.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["jsonify", "datastruct_payload", "to_jsonable", "dumps_payload"]

# Row-chunk size for both `jsonify`'s ndarray->list conversion and
# `dumps_payload`'s JSON encoding of the (potentially huge) "time"/"values"
# arrays -- see each function's docstring for why chunking matters (a single
# call over the whole array/list is one uninterruptible CPython C loop that
# never yields the GIL). 1k rows was tuned against
# tests/test_upload_concurrency.py's live-server measurement (not just the
# in-process one) -- io/delimited.py's transpose chunking and this module's
# two chunked calls all compete for the GIL in the same request, so the
# comfortable margin only shows up end to end; per-chunk Python-level
# overhead (loop, list concatenation) stays negligible next to the C work
# even at this size.
_ARRAY_CHUNK_ROWS = 1_000


def jsonify(arr: NDArray[np.float64]) -> list[Any]:
    """ndarray -> JSON-safe (nested) list; non-finite floats -> ``None``.

    Converted in row-chunks (of the ndarray's first axis) rather than one
    ``.tolist()`` call over the whole array: ``ndarray.tolist()`` builds a
    Python object for every element inside a single, uninterruptible C loop
    -- CPython only checks whether to drop the GIL from within the bytecode
    eval loop, which this call never returns to -- so for a large array
    (profiled: ~0.55s for a 300k x 6 float64 array) it can hold the GIL, and
    so starve every other thread including the event loop's, for its entire
    duration regardless of which thread runs it (see ``routes/parsers.py``'s
    ``_import_response`` for the incident this was profiled against).
    Chunking keeps each ``.tolist()`` call small and lets the ordinary
    Python ``for`` loop around it -- checked by the eval breaker every
    switch interval -- yield the GIL between chunks. The returned list is
    identical, element for element, to what one whole-array call produces.
    """
    if arr.ndim == 0 or len(arr) <= _ARRAY_CHUNK_ROWS:
        obj = arr.astype(object)
        obj[~np.isfinite(arr)] = None
        return obj.tolist()  # type: ignore[no-any-return]
    out: list[Any] = []
    for start in range(0, len(arr), _ARRAY_CHUNK_ROWS):
        block = arr[start : start + _ARRAY_CHUNK_ROWS]
        obj = block.astype(object)
        obj[~np.isfinite(block)] = None
        out.extend(obj.tolist())
    return out


def to_jsonable(obj: Any) -> Any:
    """Recursively make a calc result JSON-safe.

    Calc functions return dicts/tuples that may nest ndarrays and non-finite
    floats (real in scientific data, illegal in wire JSON). Arrays of floats go
    through ``jsonify`` (non-finite -> ``None``); numpy scalars unwrap to Python
    scalars; nested dicts/lists/tuples recurse. Lives in routes/ — transport.
    """
    if isinstance(obj, np.ndarray):
        return jsonify(obj) if obj.dtype.kind == "f" else obj.tolist()
    if isinstance(obj, np.generic):
        obj = obj.item()
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    return obj


def datastruct_payload(ds: DataStruct) -> dict[str, Any]:
    """DataStruct -> JSON-safe dict for the import response."""
    payload: dict[str, Any] = {
        "time": jsonify(ds.time),
        "values": jsonify(ds.values),
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": dict(ds.metadata),
    }
    # P1.4: ADDITIVE, same as DataStruct.to_dict() -- omitted entirely for a
    # pure-numeric dataset so an existing response shape never changes.
    if ds.cat_levels is not None:
        payload["cat_levels"] = {str(k): list(v) for k, v in ds.cat_levels.items()}
    return payload


# Keys `dumps_payload` chunk-encodes -- the only fields an import payload
# carries that can be genuinely huge (one row per data point); everything
# else (labels/units/metadata/books/...) is small regardless of dataset size.
_CHUNKED_JSON_KEYS = ("time", "values")

# Mirrors starlette.responses.JSONResponse.render's json.dumps kwargs exactly,
# so a chunk-encoded payload's bytes are indistinguishable on the wire from
# what FastAPI's default response path would have produced.
_JSON_KWARGS: dict[str, Any] = {"ensure_ascii": False, "allow_nan": False, "separators": (",", ":")}


def _encode_array_chunked(values: list[Any], chunk_size: int = _ARRAY_CHUNK_ROWS) -> str:
    """JSON-encode a (possibly huge) list in row-chunks instead of one call.

    ``json.dumps`` on a large nested list is -- like ``ndarray.tolist()``
    above -- a single uninterruptible C call for the whole structure
    (profiled: ~1.7s for the JSON text of a 300k x 6 float payload), so it
    can hold the GIL for that whole span regardless of which thread runs it.
    Encoding chunk by chunk and joining the pieces in an ordinary Python
    loop (GIL-yield-friendly between chunks) produces byte-for-byte the same
    text one whole-list ``json.dumps(values, **_JSON_KWARGS)`` call would --
    each chunk is a syntactically complete JSON array, and stripping its
    outer brackets before joining with commas is exactly how a longer array
    literal is built.
    """
    if not values:
        return "[]"
    parts: list[str] = []
    for start in range(0, len(values), chunk_size):
        block = values[start : start + chunk_size]
        encoded = json.dumps(block, **_JSON_KWARGS)
        parts.append(encoded[1:-1])  # drop the block's own "[" / "]"
    return "[" + ",".join(parts) + "]"


def dumps_payload(payload: dict[str, Any]) -> bytes:
    """``json.dumps(payload, **_JSON_KWARGS).encode("utf-8")``'s exact bytes,
    built so that encoding ``payload["time"]``/``["values"]`` -- the only
    fields large enough to matter -- never spends more than one
    ``_ARRAY_CHUNK_ROWS``-row chunk inside a single uninterruptible C call
    (see ``_encode_array_chunked``). Every other field is encoded normally
    (small regardless of dataset size). Top-level key order is preserved
    (``payload``'s own iteration order), matching plain ``dict`` JSON
    encoding exactly.

    Used by ``routes/parsers.py``'s ``_import_response`` to build the whole
    upload response -- parse, array conversion, AND encoding -- inside one
    ``run_in_threadpool`` call with no single step left able to starve a
    concurrent request for the fraction of a second a monolithic
    ``.tolist()``/``json.dumps`` pair otherwise would.
    """
    pieces: list[str] = []
    for key, value in payload.items():
        key_json = json.dumps(key, ensure_ascii=_JSON_KWARGS["ensure_ascii"])
        if key in _CHUNKED_JSON_KEYS and isinstance(value, list):
            value_json = _encode_array_chunked(value)
        else:
            value_json = json.dumps(value, **_JSON_KWARGS)
        pieces.append(f"{key_json}:{value_json}")
    return ("{" + ",".join(pieces) + "}").encode("utf-8")
