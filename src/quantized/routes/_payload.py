"""Wire-serialization helpers for the route layer.

The pure DataStruct keeps NaN/Inf (they're real in scientific data); valid wire
JSON has no representation for them, so the HTTP boundary maps non-finite floats
to ``null`` (which uPlot renders as a gap). Lives in routes/ — it's transport,
not domain.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["jsonify", "datastruct_payload"]


def jsonify(arr: NDArray[np.float64]) -> list[Any]:
    """ndarray -> JSON-safe (nested) list; non-finite floats -> ``None``."""
    obj = arr.astype(object)
    obj[~np.isfinite(arr)] = None
    return obj.tolist()  # type: ignore[no-any-return]


def datastruct_payload(ds: DataStruct) -> dict[str, Any]:
    """DataStruct -> JSON-safe dict for the import response."""
    return {
        "time": jsonify(ds.time),
        "values": jsonify(ds.values),
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": dict(ds.metadata),
    }
