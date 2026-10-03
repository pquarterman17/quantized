"""The import payload for every non-Origin file (``routes/parsers.py``).

Two wire details live here so the parser route stays thin:

- a multi-sheet Excel workbook's other data sheets ride in ``"sheets"``
  (``io/excel_sheets.py``); the primary sheet is the top-level payload;
- an UPLOAD is parsed from a temp copy (``/tmp/tmpXXXX/name``), so every
  dataset's ``metadata['source']`` is rewritten to the file name the user
  picked: a temp path that no longer exists means nothing in the Inspector.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
from typing import Any

from quantized.datastruct import DataStruct
from quantized.io.registry import import_auto_sheets
from quantized.routes._payload import datastruct_payload

__all__ = ["plain_import_payload"]


def _display_source(ds: DataStruct, upload_name: str | None) -> DataStruct:
    if upload_name is None or "source" not in ds.metadata:
        return ds
    return dataclasses.replace(ds, metadata={**ds.metadata, "source": upload_name})


def plain_import_payload(
    path: Path, upload_name: str | None = None
) -> tuple[dict[str, Any], DataStruct]:
    """``(payload, primary dataset)`` for ``path``; ``upload_name`` is the
    picked file's name when ``path`` is an upload's temp copy."""
    ds, *sheets = (_display_source(d, upload_name) for d in import_auto_sheets(path))
    payload = datastruct_payload(ds)
    if sheets:  # a multi-sheet workbook: every other data sheet, in full
        payload["sheets"] = [datastruct_payload(s) for s in sheets]
    return payload, ds
