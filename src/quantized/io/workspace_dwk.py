"""Write a Quantized workspace (``.dwk``) from DataStructs, with no app running.

The ``.dwk`` reader is the frontend's ``lib/workspace.ts`` (``parseWorkspace``).
This writes the smallest document it accepts that still keeps an Origin
project's shape: format ``quantized-workspace`` **version 3** (datasets plus
the folder tree), so the app derives the workbook layer on open exactly as it
does for any pre-v4 file (``lib/workbooks.ts``'s ``applyWorkbookMigration``,
which groups sheets by ``metadata.origin_book``). A frontend test parses the
committed output of this writer (``lib/workspaceDwkWriter.parity.test.ts``),
so a reader change that would refuse it fails CI.

Cells use the BUG-017 wire form the app itself writes
(``lib/workspaceSerialize.ts``): a finite number as a number, and NaN,
+-Infinity and -0 as the strings ``"NaN"``, ``"Infinity"``, ``"-Infinity"``
and ``"-0"`` (JSON has no token for them). Metadata is reduced to plain JSON
values; a non-finite float inside it becomes ``null``. Pure ``io`` layer.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["WORKSPACE_FORMAT", "DwkDataset", "workspace_json"]

WORKSPACE_FORMAT = "quantized-workspace"
_VERSION = 3


@dataclass(frozen=True)
class DwkDataset:
    """One worksheet of the workspace: its Library name, data, and the
    folder path (outermost first) it sits in; ``[]`` = the Library root."""

    name: str
    data: DataStruct
    folder_path: Sequence[str] = field(default_factory=tuple)


def _cell(v: float) -> float | str:
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    if v == 0.0 and math.copysign(1.0, v) < 0:
        return "-0"
    return v


def _cells(values: np.ndarray) -> list[float | str]:
    return [_cell(float(v)) for v in values]


def _plain(value: Any) -> Any:
    """``value`` as plain JSON data (no NaN tokens, no numpy, string keys)."""
    if value is None or isinstance(value, bool | str):
        return value
    if isinstance(value, int | np.integer):
        return int(value)
    if isinstance(value, float | np.floating):
        f = float(value)
        return f if math.isfinite(f) else None
    if isinstance(value, np.ndarray):
        return _plain(value.tolist())
    if isinstance(value, Mapping):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set | frozenset):
        return [_plain(v) for v in value]
    if isinstance(value, bytes):
        return value.decode("latin-1")
    return str(value)


def _data(ds: DataStruct) -> dict[str, Any]:
    out: dict[str, Any] = {
        "time": _cells(ds.time),
        "values": [_cells(row) for row in ds.values],
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": _plain(ds.metadata),
    }
    if ds.cat_levels is not None:
        out["cat_levels"] = {str(k): list(v) for k, v in ds.cat_levels.items()}
    if ds.level_order is not None:
        out["level_order"] = {str(k): list(v) for k, v in ds.level_order.items()}
    return out


def workspace_json(datasets: Sequence[DwkDataset], *, saved_at: str | None = None) -> str:
    """The ``.dwk`` text for ``datasets``, in order (ids ``ds-1``, ``ds-2``…).

    One folder node per distinct path prefix (ids ``f-1``…, in first-seen
    order), so two Origin folders of the same name under different parents
    stay two folders. Deterministic: the same input always gives the same
    text (``saved_at``, when given, is the only time stamp written).
    """
    if not datasets:
        raise ValueError("a workspace needs at least one dataset")
    folders: list[dict[str, Any]] = []
    folder_ids: dict[tuple[str, ...], str] = {}
    order_in: dict[str | None, int] = {}

    def folder_for(path: tuple[str, ...]) -> str | None:
        if not path:
            return None
        if path in folder_ids:
            return folder_ids[path]
        parent = folder_for(path[:-1])
        fid = f"f-{len(folders) + 1}"
        order_in[parent] = order_in.get(parent, 0) + 1
        folders.append({"id": fid, "name": path[-1], "parentId": parent, "order": order_in[parent]})
        folder_ids[path] = fid
        return fid

    entries: list[dict[str, Any]] = []
    for i, d in enumerate(datasets, start=1):
        entry: dict[str, Any] = {"id": f"ds-{i}", "name": d.name, "data": _data(d.data)}
        fid = folder_for(tuple(str(p) for p in d.folder_path))
        if fid is not None:
            entry["folderId"] = fid
        entries.append(entry)
    doc: dict[str, Any] = {"format": WORKSPACE_FORMAT, "version": _VERSION}
    if saved_at:
        doc["savedAt"] = saved_at
    doc.update(
        {
            "datasets": entries,
            "folders": folders,
            "activeId": entries[0]["id"],
            "expandedFolders": [f["id"] for f in folders],
        }
    )
    return json.dumps(doc, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
