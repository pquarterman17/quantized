"""Wire-serialization helpers for the route layer.

The pure DataStruct keeps NaN/Inf (they're real in scientific data); valid wire
JSON has no representation for them, so the HTTP boundary maps non-finite floats
to ``null`` (which uPlot renders as a gap). Lives in routes/ — it's transport,
not domain.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["jsonify", "datastruct_payload", "to_jsonable"]


def jsonify(arr: NDArray[np.float64]) -> list[Any]:
    """ndarray -> JSON-safe (nested) list; non-finite floats -> ``None``."""
    obj = arr.astype(object)
    obj[~np.isfinite(arr)] = None
    return obj.tolist()  # type: ignore[no-any-return]


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
    return {
        "time": jsonify(ds.time),
        "values": jsonify(ds.values),
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": dict(ds.metadata),
    }
