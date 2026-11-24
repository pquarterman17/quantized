"""Metadata for the converter writers: one flattening, one JSON-safe encoding.

* :func:`flatten_metadata` -- ``(dotted.key, text)`` rows, for the ``#``-comment
  header of a CSV / ``.xy`` file and the ``metadata`` sheet of an Excel file
  (the flat formats; a value over :data:`MAX_TEXT` characters is cut and the
  key reported in the second return, so the loss is never silent).
* :func:`jsonable` -- any metadata value as plain JSON types, the one encoding
  JSON, ``.npz`` and the HDF5 / ``.mat`` fall-backs share. JSON has no NaN or
  infinity: ``NaN`` is ``null`` and +/-infinity the strings ``"Infinity"`` /
  ``"-Infinity"`` (the file says so under ``"encoding"``).

Pure ``io``.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np

__all__ = ["JSON_ENCODING", "MAX_TEXT", "flatten_metadata", "jsonable"]

#: A flat-format metadata value longer than this is cut (HDF5/.mat/JSON/.npz
#: carry it whole). Under Excel's 32,767-character cell limit.
MAX_TEXT = 2000
_MAX_DEPTH = 8
#: Keys already written as columns (Origin text columns): not repeated as metadata.
_SKIP_FLAT = frozenset({"origin_text_columns", "origin_text_column_labels"})

JSON_ENCODING = {"nan": None, "inf": "Infinity", "-inf": "-Infinity"}


def _float(v: float) -> float | str | None:
    if math.isnan(v):
        return None
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    return v


def jsonable(obj: Any, _depth: int = 0) -> Any:
    """``obj`` as JSON-ready Python (see the module doc for non-finite floats)."""
    if _depth > _MAX_DEPTH:
        return str(obj)
    if obj is None or isinstance(obj, (bool, str)):
        return obj
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        return _float(float(obj))
    if isinstance(obj, np.ndarray):
        return jsonable(obj.tolist(), _depth + 1)
    if isinstance(obj, Mapping):
        return {str(k): jsonable(v, _depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [jsonable(v, _depth + 1) for v in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Path):
        return str(obj)
    return str(obj)


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value.replace("\r", "\\r").replace("\n", "\\n")
    return json.dumps(jsonable(value), ensure_ascii=False, separators=(",", ":"))


def flatten_metadata(
    metadata: Mapping[str, Any], *, skip: frozenset[str] = _SKIP_FLAT
) -> tuple[list[tuple[str, str]], list[str]]:
    """``(rows, truncated_keys)``: nested mappings become ``a.b.c`` keys, every
    value one line of text. ``None`` values are kept as ``null``."""
    rows: list[tuple[str, str]] = []
    cut: list[str] = []

    def walk(prefix: str, value: Any, depth: int) -> None:
        if isinstance(value, Mapping) and value and depth < _MAX_DEPTH:
            for k, v in value.items():
                walk(f"{prefix}.{k}" if prefix else str(k), v, depth + 1)
            return
        text = _text(value)
        if len(text) > MAX_TEXT:
            text = text[:MAX_TEXT] + "...(truncated)"
            cut.append(prefix)
        rows.append((prefix, text))

    for key, value in metadata.items():
        if key not in skip:
            walk(str(key), value, 0)
    return rows, cut
