"""Write a Quantized workspace (``.dwk``) for an Origin project, with no app.

``qz convert --to dwk`` must give the same Library an import of the project
in the app gives. So this mirrors the app's import, field for field
(``frontend/src/store/importDatasets.ts`` ``addFromPayload``, fed by the
import route ``routes/parsers.py``):

* **which books**: the route's list (``drop_empty_library_books``); a project
  with one such book takes the single-file branch (dataset named after the
  file, no project folder), more take the multi-book branch;
* **names**: ``<stem>:<short>``, or ``<stem>:<short> — <long>`` when the
  book's long name differs;
* **data**: every book in full, metadata minus what the route never sends
  (``origin_books``, ``origin_worksheet_fidelity``);
* **error-bar roles**: from Origin's own designations
  (:func:`origin_book_error_roles`, a port of ``lib/originBookRoles.ts``);
* **folders**: a project folder named after the stem, then the Project
  Explorer path (``lib/originFolders.ts`` ``planOriginImport``); the
  workbook layer is left to the app's reader, which derives it with the same
  ``deriveWorkbooks`` the import calls;
* **active book**: the primary book (the route's ``read_origin_project``);
* **figures and the fidelity manifest**: the route's own
  (``io/origin_project/import_manifest.py``), as ``originFigures`` /
  ``originFidelity`` entries the way ``lib/originFigureEntries.ts`` and
  ``store/originImport.ts`` build them;
* ``source`` (the project path, so Re-import works) and ``importedAt``.

Format ``quantized-workspace`` version 3. ``lib/workspaceDwkWriter.parity
.test.ts`` imports the same project through the app's store and compares.

Cells use the BUG-017 wire form the app writes (``lib/workspaceSerialize.ts``):
NaN, +-Infinity and -0 as ``"NaN"``, ``"Infinity"``, ``"-Infinity"``, ``"-0"``.
Metadata becomes plain JSON (a non-finite float in it becomes ``null``).
Pure ``io`` layer.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["WORKSPACE_FORMAT", "OriginWorkspace", "origin_book_error_roles", "workspace_json"]

WORKSPACE_FORMAT = "quantized-workspace"
_VERSION = 3
#: Metadata the import route never sends (``routes/parsers._UNSENT_METADATA``).
_UNSENT = frozenset({"origin_books", "origin_worksheet_fidelity"})
_DESIGNATIONS = frozenset(
    {"X", "Y", "Y-error", "X-error", "label", "disregard", "Z", "group", "subject"}
)


@dataclass(frozen=True)
class OriginWorkspace:
    """One Origin project's import, as the route returns it."""

    file_name: str  # "loops.opj"
    books: Sequence[DataStruct]  # the books to write, in project order
    listed: int  # how many books the route lists (decides the branch)
    primary_book: str  # the primary's origin_book
    figures: Sequence[Mapping[str, Any]] = ()
    fidelity: Mapping[str, Any] | None = None
    source_path: str | None = None
    imported_at: str | None = None


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
        "metadata": _plain({k: v for k, v in ds.metadata.items() if k not in _UNSENT}),
    }
    if ds.cat_levels is not None:
        out["cat_levels"] = {str(k): list(v) for k, v in ds.cat_levels.items()}
    if ds.level_order is not None:
        out["level_order"] = {str(k): list(v) for k, v in ds.level_order.items()}
    return out


def origin_book_error_roles(ds: DataStruct) -> list[dict[str, Any]] | None:
    """Error-bar roles from Origin's column designations; None when the book
    carries no designation at all. A port of ``lib/originBookRoles.ts``'s
    ``originBookErrorRoles`` (pairing: nearest preceding Y; an X-error binds
    to the last Y since the latest X, or the dataset X)."""
    names = ds.metadata.get("origin_column_names")
    if not isinstance(names, list):
        return None
    raw = ds.metadata.get("column_designations")
    desig = raw if isinstance(raw, Mapping) else {}
    found = [desig.get(str(n)) for n in names]
    found = [d if isinstance(d, str) and d in _DESIGNATIONS else None for d in found]
    if not found or all(d is None for d in found):
        return None
    skip_x_error = ds.metadata.get("x_column_recovered") is False
    roles: list[dict[str, Any]] = []
    last_y: int | None = None
    block_y: int | None = None
    saw_secondary_x = False
    for i, d in enumerate(found):
        if d == "Y":
            last_y = block_y = i
        elif d == "X":
            saw_secondary_x = True
            block_y = None
        elif d == "Y-error" and last_y is not None:
            roles.append({"channel": i, "target": last_y, "axis": "y", "side": "both"})
        elif d == "X-error" and not skip_x_error and (block_y is not None or not saw_secondary_x):
            target = block_y if block_y is not None else -1
            roles.append({"channel": i, "target": target, "axis": "x", "side": "both"})
    return roles


def _figure_dataset(figure: Mapping[str, Any], entries: list[dict[str, Any]]) -> str | None:
    """``lib/originFigureEntries.ts`` ``resolveFigureDataset``, ported."""
    if len(entries) == 1:
        return str(entries[0]["id"])
    if not entries:
        return None
    for curve in figure.get("curves") or []:
        book = curve.get("book") if isinstance(curve, Mapping) else None
        for e in entries:
            if str(e["data"]["metadata"].get("origin_book") or "") == book:
                return str(e["id"])
    hint = str(figure.get("source_hint") or "").strip().lower()
    if not hint:
        return None
    for e in entries:
        meta = e["data"]["metadata"]
        short = str(meta.get("origin_book") or "").strip().lower()
        long = str(meta.get("origin_book_long") or "").strip().lower()
        if short and (hint == short or hint in short or short in hint):
            return str(e["id"])
        if long and (hint == long or hint in long or long in hint):
            return str(e["id"])
        if hint in str(e["name"]).lower():
            return str(e["id"])
    return None


def workspace_json(ws: OriginWorkspace) -> str:
    """The ``.dwk`` text for one project (see the module doc). Deterministic:
    the same input gives the same text (ids ``ds-1``…, ``f-1``…)."""
    if not ws.books:
        raise ValueError("a workspace needs at least one book")
    stem = ws.file_name.rsplit(".", 1)[0] if "." in ws.file_name else ws.file_name
    multi = ws.listed > 1
    folders: list[dict[str, Any]] = []
    entries: list[dict[str, Any]] = []
    project: str | None = None
    folder_ids: dict[tuple[str, str], str] = {}
    next_order: dict[str, int] = {}

    def folder_for(path: list[str]) -> str:
        assert project is not None
        parent = project
        for part in path:
            key = (parent, part)
            if key not in folder_ids:
                fid = f"f-{len(folders) + 1}"
                order = next_order.get(parent, 0)
                next_order[parent] = order + 1
                folders.append({"id": fid, "name": part, "parentId": parent, "order": order})
                folder_ids[key] = fid
            parent = folder_ids[key]
        return parent

    if multi:
        project = "f-1"
        folders.append({"id": project, "name": stem or "Project", "parentId": None, "order": 0})
    for i, ds in enumerate(ws.books, start=1):
        meta = ds.metadata
        short = str(meta.get("origin_book") or "Book")
        long = str(meta.get("origin_book_long") or "")
        label = f"{short} — {long}" if long and long != short else short
        entry: dict[str, Any] = {
            "id": f"ds-{i}",
            "name": f"{stem}:{label}" if multi else ws.file_name,
            "data": _data(ds),
        }
        roles = origin_book_error_roles(ds)
        if roles is not None:
            entry["errorRoles"] = roles
        if ws.source_path:
            entry["source"] = {"kind": "path", "path": ws.source_path}
        if ws.imported_at:
            entry["importedAt"] = ws.imported_at
        if multi:
            raw_path = meta.get("origin_folder_path")
            path = (
                [p for p in raw_path if isinstance(p, str) and p]
                if isinstance(raw_path, list)
                else []
            )
            entry["folderId"] = folder_for(path)
        entries.append(entry)
    ids = [e["id"] for e in entries]
    active = next(
        (e["id"] for e in entries if e["data"]["metadata"].get("origin_book") == ws.primary_book),
        ids[0],
    )
    doc: dict[str, Any] = {
        "format": WORKSPACE_FORMAT,
        "version": _VERSION,
        "datasets": entries,
        "folders": folders,
        "activeId": active,
    }
    if ws.figures:
        doc["originFigures"] = [
            {
                "id": f"fig-{ids[0]}-{k}",
                "stem": stem,
                "figure": _plain(fig),
                "datasetId": _figure_dataset(fig, entries),
                "siblingIds": ids,
            }
            for k, fig in enumerate(ws.figures)
        ]
    if ws.fidelity is not None:
        doc["originFidelity"] = [
            {
                "id": f"origin-fidelity-{ids[0]}-0",
                "stem": stem,
                "siblingIds": ids,
                "manifest": _plain(ws.fidelity),
            }
        ]
    return json.dumps(doc, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
