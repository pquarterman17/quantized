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
from fastapi.responses import JSONResponse
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = [
    "jsonify",
    "datastruct_payload",
    "to_jsonable",
    "dumps_payload",
    "DataStructResponse",
]

# Element budget (NOT a row count) for both `jsonify`'s ndarray->list
# conversion and `dumps_payload`'s JSON encoding of the (potentially huge)
# "time"/"values" arrays -- see each function's docstring for why chunking
# matters (a single call over the whole array/list is one uninterruptible
# CPython C loop that never yields the GIL). A FIXED ROW COUNT doesn't bound
# the per-chunk C call for a WIDE array: 1000 rows x 2000 columns is 2M
# elements in one chunk -- measured 1.65s inside one `json.dumps` and 0.2s in
# one `.tolist()`, the exact hold-the-GIL span this module exists to avoid.
# Budgeting by total scalar element count (`_rows_per_chunk` divides it by
# the row width) keeps each chunk's element count -- and so its wall-clock
# cost -- roughly constant regardless of shape. 8_000 elements/chunk was
# tuned against tests/test_upload_concurrency.py's live-server measurement
# (not just the in-process one) for the narrow (1-column) case -- io/
# delimited.py's transpose chunking and this module's two chunked calls all
# compete for the GIL in the same request, so the comfortable margin only
# shows up end to end; per-chunk Python-level overhead (loop, list
# concatenation) stays negligible next to the C work even at this size.
_ARRAY_CHUNK_ELEMS = 8_000


def _rows_per_chunk(row_width: int) -> int:
    """Row count whose total element count (``row_width`` scalars per row)
    stays within ``_ARRAY_CHUNK_ELEMS`` -- at least 1 row even when a single
    row alone exceeds the whole budget (e.g. a 20k-column sheet), since a
    chunk must always contain whole rows.
    """
    return max(1, _ARRAY_CHUNK_ELEMS // max(1, row_width))


def _array_row_width(arr: NDArray[np.float64]) -> int:
    """Scalar element count of one row of ``arr`` (1 for a 1-D array, the
    product of every axis after the first for an N-D array -- ``values`` is
    always 2-D per ``DataStruct``, but this stays correct for e.g. a 2-D
    ``z_grid``)."""
    width = 1
    for dim in arr.shape[1:]:
        width *= int(dim)
    return width


def jsonify(arr: NDArray[np.float64]) -> list[Any]:
    """ndarray -> JSON-safe (nested) list; non-finite floats -> ``None``.

    Converted in row-chunks (of the ndarray's first axis, sized by
    ``_rows_per_chunk`` to an ~``_ARRAY_CHUNK_ELEMS``-element budget rather
    than a fixed row count -- a wide row needs fewer of them) rather than
    one ``.tolist()`` call over the whole array: ``ndarray.tolist()`` builds
    a Python object for every element inside a single, uninterruptible C
    loop -- CPython only checks whether to drop the GIL from within the
    bytecode eval loop, which this call never returns to -- so for a large
    array (profiled: ~0.55s for a 300k x 6 float64 array; ~0.2s for a 1000 x
    2000 one) it can hold the GIL, and so starve every other thread
    including the event loop's, for its entire duration regardless of which
    thread runs it (see ``routes/parsers.py``'s ``_import_response`` for the
    incident this was profiled against). Chunking keeps each ``.tolist()``
    call small and lets the ordinary Python ``for`` loop around it --
    checked by the eval breaker every switch interval -- yield the GIL
    between chunks. The returned list is identical, element for element, to
    what one whole-array call produces.
    """
    rows_per_chunk = _rows_per_chunk(_array_row_width(arr))
    if arr.ndim == 0 or len(arr) <= rows_per_chunk:
        obj = arr.astype(object)
        obj[~np.isfinite(arr)] = None
        return obj.tolist()  # type: ignore[no-any-return]
    out: list[Any] = []
    for start in range(0, len(arr), rows_per_chunk):
        block = arr[start : start + rows_per_chunk]
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


# Keys `dumps_payload` chunk-encodes, WHEREVER they occur in the payload
# (top level, or nested under e.g. "books"/"preview") -- the only fields an
# import payload carries that can be genuinely huge (one row per data
# point); everything else (labels/units/metadata/book ids/...) is small
# regardless of dataset size.
_CHUNKED_JSON_KEYS = ("time", "values")

# Mirrors starlette.responses.JSONResponse.render's json.dumps kwargs exactly,
# so a chunk-encoded payload's bytes are indistinguishable on the wire from
# what FastAPI's default response path would have produced.
_JSON_KWARGS: dict[str, Any] = {"ensure_ascii": False, "allow_nan": False, "separators": (",", ":")}


def _encode_array_chunked(values: list[Any]) -> str:
    """JSON-encode a (possibly huge) list in row-chunks instead of one call.

    ``json.dumps`` on a large nested list is -- like ``ndarray.tolist()``
    above -- a single uninterruptible C call for the whole structure
    (profiled: ~1.7s for the JSON text of a 300k x 6 float payload; ~1.65s
    for a 1000 x 2000 one), so it can hold the GIL for that whole span
    regardless of which thread runs it. The chunk size is sized by
    ``_rows_per_chunk`` to an ~``_ARRAY_CHUNK_ELEMS``-element budget (each
    row's width is ``len(values[0])`` for a list-of-rows "values" list, 1
    for a flat "time" list) rather than a fixed row count, so a wide row
    still bounds each call's element count. Encoding chunk by chunk and
    joining the pieces in an ordinary Python loop (GIL-yield-friendly
    between chunks) produces byte-for-byte the same text one whole-list
    ``json.dumps(values, **_JSON_KWARGS)`` call would -- each chunk is a
    syntactically complete JSON array, and stripping its outer brackets
    before joining with commas is exactly how a longer array literal is
    built.
    """
    if not values:
        return "[]"
    row_width = len(values[0]) if isinstance(values[0], list) else 1
    chunk_size = _rows_per_chunk(row_width)
    parts: list[str] = []
    for start in range(0, len(values), chunk_size):
        block = values[start : start + chunk_size]
        encoded = json.dumps(block, **_JSON_KWARGS)
        parts.append(encoded[1:-1])  # drop the block's own "[" / "]"
    return "[" + ",".join(parts) + "]"


def _encode_json(value: Any) -> str:
    """Recursively JSON-encode ``value``, chunk-encoding any list found
    under a ``"time"``/``"values"`` key AT ANY NESTING DEPTH, and encoding
    everything else with an ordinary ``json.dumps`` call.

    A ``full_books=true`` import payload nests every book's own ``time``/
    ``values`` arrays under ``payload["books"][i]`` -- a top-level-only
    check (the original shape of this function) would miss them entirely
    and fall through to one monolithic ``json.dumps`` over the whole
    ``"books"`` list, reintroducing the exact GIL-holding call this module
    exists to avoid. Recursing through every dict/list finds them wherever
    they occur, with no per-shape special-casing, at the cost of one
    Python-level function call per nested container (never per element --
    still O(n) overall, dominated by the same chunked ``json.dumps`` calls
    ``_encode_array_chunked`` already made).
    """
    if isinstance(value, dict):
        pieces: list[str] = []
        for key, sub in value.items():
            key_json = json.dumps(key, ensure_ascii=_JSON_KWARGS["ensure_ascii"])
            if key in _CHUNKED_JSON_KEYS and isinstance(sub, list):
                sub_json = _encode_array_chunked(sub)
            elif isinstance(sub, (dict, list)):
                sub_json = _encode_json(sub)
            else:
                sub_json = json.dumps(sub, **_JSON_KWARGS)
            pieces.append(f"{key_json}:{sub_json}")
        return "{" + ",".join(pieces) + "}"
    if isinstance(value, list):
        # A list itself is never a chunk-target here (the dict branch above
        # already intercepts "time"/"values" before recursing into their
        # value) -- this handles a list of dicts (e.g. "books": [...]) that
        # may carry their OWN "time"/"values" one level down, or a plain
        # small list (labels/units/...) with nothing to chunk.
        if not value:
            return "[]"
        return "[" + ",".join(_encode_json(item) for item in value) + "]"
    return json.dumps(value, **_JSON_KWARGS)


def dumps_payload(payload: dict[str, Any]) -> bytes:
    """``json.dumps(payload, **_JSON_KWARGS).encode("utf-8")``'s exact bytes,
    built so that encoding a ``"time"``/``"values"`` array -- wherever it
    occurs, including nested under ``"books"`` (the ``full_books=true``
    shape) -- never spends more than one ``_ARRAY_CHUNK_ELEMS``-element-
    budget chunk inside a single uninterruptible C call (see
    ``_encode_array_chunked``).
    Every other field is encoded normally (small regardless of dataset
    size). Key order is preserved at every nesting level, matching plain
    ``dict``/``list`` JSON encoding exactly.

    Used by ``routes/parsers.py``'s ``_import_response`` (and
    :class:`DataStructResponse`, below) to build the whole response --
    parse, array conversion, AND encoding -- inside one
    ``run_in_threadpool`` call with no single step left able to starve a
    concurrent request for the fraction of a second a monolithic
    ``.tolist()``/``json.dumps`` pair otherwise would.
    """
    return _encode_json(payload).encode("utf-8")


class DataStructResponse(JSONResponse):
    """A ``JSONResponse`` whose body is ``dumps_payload(content)`` -- set as
    a route's ``response_class`` (or constructed directly and returned, as
    ``routes/parsers.py``'s ``_import_response`` does) for any endpoint
    whose body is a ``datastruct_payload``-shaped dict that can be large.

    Byte-identical to a plain ``JSONResponse`` for the same content (same
    media type, same ``json.dumps`` kwargs) -- the only difference is HOW
    the bytes are produced: in ``_ARRAY_CHUNK_ELEMS``-element-budget chunks
    (sized per row width, not a fixed row count) for any
    nested ``"time"``/``"values"`` array instead of one whole-payload
    ``json.dumps`` call, so a large body never holds the GIL for the
    hundreds-of-milliseconds-plus span a single call over it would (see
    ``dumps_payload``/``jsonify`` for the profiled numbers). A route can
    just ``return`` the payload dict (with ``response_model`` documenting
    the shape) -- FastAPI calls ``render`` exactly once on it, so nothing
    double-serializes. Subclassing ``JSONResponse`` (not the bare
    ``Response``) rather than reimplementing it also keeps OpenAPI schema
    generation intact: FastAPI's docs builder only pulls the real
    ``response_model`` schema for a ``JSONResponse`` subclass, else it
    falls back to an opaque ``{"type": "string"}``.
    """

    def render(self, content: Any) -> bytes:
        if content is None:
            return b""
        if isinstance(content, (bytes, memoryview)):
            return bytes(content)
        return dumps_payload(content)
