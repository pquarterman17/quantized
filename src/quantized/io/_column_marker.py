"""The column-roles line: Origin designations, comments and date formats in a
table file, and back.

CSV and Excel have no place for "column C is an X, and D is plotted
against it", a column comment, or "these numbers are Origin dates". A
converted Origin book (``qz convert``, ``quantized.api.save_table``) writes
them in ONE extra line above the header rows::

    # quantized-columns: {"labels": [...], "origin_column_names": [...],
                          "column_designations": {...}, ...}

In a CSV it is a ``#`` comment line, which every reader here already sets
aside (``_data_section._split_lines``); in an ``.xlsx`` it is cell A1 of the
sheet, removed before the layout is detected (``io/excel.import_grid``).
Re-importing restores the four metadata keys exactly as the Origin reader
wrote them, so the app pairs each Y with its nearest-preceding X again
(``lib/columnmeta.ts``'s ``columnMetaList``) and gets Origin's error-bar roles.

The line is applied only when the re-imported channel labels equal the
recorded ``labels`` -- a file edited so the columns no longer line up keeps
the plain reading, with a note, never a mis-assigned role. Pure ``io``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from quantized.datastruct import DataStruct

__all__ = ["MARKER", "apply_marker", "column_marker", "find_marker"]

MARKER = "# quantized-columns: "
_DICT_KEYS = ("column_designations", "column_comments", "origin_column_formats")
_IGNORED_NOTE = (
    "The file's column-roles line (Origin designations, comments, date formats) "
    "was not applied: its columns no longer match the file's."
)


def column_marker(ds: DataStruct) -> str | None:
    """The line for ``ds``, or None when it carries nothing to keep."""
    meta = ds.metadata
    names = meta.get("origin_column_names")
    if not isinstance(names, list) or len(names) != ds.n_channels:
        return None
    payload: dict[str, Any] = {"labels": list(ds.labels), "origin_column_names": names}
    for key in _DICT_KEYS:
        value = meta.get(key)
        if isinstance(value, Mapping) and value:
            payload[key] = {str(k): v for k, v in value.items()}
    if len(payload) == 2:
        return None
    return MARKER + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def find_marker(lines: Sequence[str]) -> dict[str, Any] | None:
    """The parsed payload of the first marker line among ``lines``."""
    for line in lines:
        text = line.lstrip("﻿").strip()
        if text.startswith(MARKER.strip()):
            try:
                payload = json.loads(text[len(MARKER.strip()) :])
            except ValueError:
                return None
            return payload if isinstance(payload, dict) else None
    return None


#: Value type per restored map: designations and comments are text, a date
#: format is the reader's own small dict (``opj_books.column_format_hint``).
_VALUE_TYPE: dict[str, type] = {
    "column_designations": str,
    "column_comments": str,
    "origin_column_formats": dict,
}


def _str_map(value: object, kind: type) -> dict[str, Any] | None:
    """``value`` as a ``{str: kind}`` map, or None when it is not one."""
    if not isinstance(value, Mapping):
        return None
    if not all(isinstance(k, str) and isinstance(v, kind) for k, v in value.items()):
        return None
    return dict(value)


def apply_marker(metadata: dict[str, Any], labels: Sequence[str], payload: dict[str, Any]) -> None:
    """Restore the payload's keys into ``metadata`` (in place) when the
    labels match; otherwise add a note saying it was not applied."""
    names = payload.get("origin_column_names")
    ok = (
        payload.get("labels") == list(labels)
        and isinstance(names, list)
        and len(names) == len(labels)
        and all(isinstance(n, str) for n in names)
    )
    maps = {key: _str_map(payload[key], _VALUE_TYPE[key]) for key in _DICT_KEYS if key in payload}
    if not ok or any(v is None for v in maps.values()):
        metadata["notes"] = [*metadata.get("notes", []), _IGNORED_NOTE]
        return
    metadata["origin_column_names"] = list(names)  # type: ignore[arg-type]
    metadata.update(maps)
