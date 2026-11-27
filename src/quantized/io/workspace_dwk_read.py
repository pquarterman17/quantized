"""Read a Quantized workspace (``.dwk``) without the app (gap audit 5, item 6).

The headless counterpart of the app's open (``frontend/src/lib/workspace.ts``
``parseWorkspace`` + ``lib/workspaceDatasetParse.ts``), for the part a script
needs: every dataset as a :class:`DataStruct`, plus the project facts around
it (name, Library folder path, source file, computed-column formulas,
corrections, notes, tags), the recorded pipeline and the active dataset.
Figures, graphs, reports and the rest of the GUI state are left in the file.

VERSIONS. The accepted ``version`` set is the one the backend already checks
before it writes a project (``desktop_project_file.WORKSPACE_VERSIONS``), which
``tests/test_workspace_dwk_read.py`` holds equal to the app's own
``parseWorkspace`` gate. A newer file (``version`` above that set) is refused
with a message that names both versions: it was written by a newer Quantized,
and reading only the fields this build knows could silently miss data the
newer one stored. Version 6 (``WORKSPACE_VERSION_NEW_FEATURES``, see
``lib/workspaceForwardCompat.ts``) only marks GUI features an older APP would
drop (version 7, ``WORKSPACE_VERSION_POST_038``, those v0.35-v0.38 would;
version 8, ``WORKSPACE_VERSION_POST_041``, the window layout and row styles
v0.39-v0.41 would; version 9, ``WORKSPACE_VERSION_POST_045``, those v0.42-v0.45
would);
the dataset records this reader returns are the same in every version.
Unknown top-level and per-dataset fields are ignored, as the app ignores them.

CELLS. The BUG-017 wire form: a number, or ``"NaN"``, ``"Infinity"``,
``"-Infinity"``, ``"-0"``. A legacy ``null`` cell reads as NaN and is counted
into ONE warning (the 2026-10-03 ruling the app follows). Anything else -- a
non-sentinel string, a boolean, a ragged or missing array -- refuses the whole
file with the dataset named, as the app refuses it (a silently dropped
dataset is worse than a refusal).

A dataset whose rows were still a preview (``pending``, not yet read from its
source) is returned as stored with ``sampled=True`` and a warning: those rows
may be a sample, not the data.

Pure ``io`` layer: JSON in, DataStructs out; no web stack.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.desktop_project_file import WORKSPACE_FORMAT, WORKSPACE_VERSIONS
from quantized.portable.project_rewrite import resolve_bundle_source

__all__ = [
    "Workspace",
    "WorkspaceDataset",
    "WorkspaceVersionError",
    "parse_workspace",
    "read_workspace",
]

_SENTINELS = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf, "-0": -0.0}


class WorkspaceVersionError(ValueError):
    """The file is a workspace of a version this build cannot read."""


@dataclass(frozen=True)
class WorkspaceDataset:
    """One Library dataset of a workspace."""

    id: str
    name: str
    #: The worksheet as the app shows it: corrected, computed columns included.
    data: DataStruct
    #: The uncorrected base the corrections start from (computed columns not
    #: included), when the file stores one.
    raw: DataStruct | None = None
    #: The computed columns, in order (``{"name", "expr", ...}``); they are
    #: the last ``len(formulas)`` channels of ``data``.
    formulas: tuple[Mapping[str, Any], ...] = ()
    corrections: Mapping[str, Any] | None = None
    #: Library folder names from the root down (``()`` at the root).
    folder_path: tuple[str, ...] = ()
    #: The file it was imported from, when recorded (a packed project's
    #: bundle-relative source is resolved against the ``.dwk``'s folder).
    source_path: str | None = None
    notes: str = ""
    tags: tuple[str, ...] = ()
    #: True when ``data`` may be a preview sample (the module doc).
    sampled: bool = False


@dataclass(frozen=True)
class Workspace:
    """A parsed ``.dwk`` (the module doc says what is read)."""

    version: int
    datasets: tuple[WorkspaceDataset, ...]
    active_id: str | None = None
    #: The recorded pipeline steps, as stored (``lib/pipeline.ts`` shape).
    pipeline: tuple[Mapping[str, Any], ...] = ()
    saved_at: str | None = None
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def dataset(self, key: str) -> WorkspaceDataset:
        """The dataset with id ``key``, else the one named ``key``."""
        for d in self.datasets:
            if d.id == key:
                return d
        named = [d for d in self.datasets if d.name == key]
        if len(named) == 1:
            return named[0]
        if named:
            raise KeyError(f"{len(named)} datasets are named {key!r}; use the id")
        raise KeyError(f"no dataset {key!r} in the workspace")

    @property
    def active(self) -> WorkspaceDataset | None:
        """The dataset that was active when the project was saved."""
        return next((d for d in self.datasets if d.id == self.active_id), None)


def _cells(raw: Any, where: str, nulls: list[int]) -> list[float]:
    if not isinstance(raw, list):
        raise ValueError(f"{where} is not an array")
    out: list[float] = []
    for v in raw:
        if v is None:
            nulls[0] += 1
            out.append(math.nan)
        elif isinstance(v, bool):
            raise ValueError(f"{where} holds a non-numeric cell ({v!r})")
        elif isinstance(v, int | float):
            out.append(float(v))
        elif isinstance(v, str) and v in _SENTINELS:
            out.append(_SENTINELS[v])
        else:
            raise ValueError(f"{where} holds a non-numeric cell ({v!r})")
    return out


def _struct(raw: Any, where: str, nulls: list[int], warnings: list[str]) -> DataStruct:
    if not isinstance(raw, Mapping):
        raise ValueError(f"{where} has an invalid data structure")
    time = _cells(raw.get("time"), f"{where} x column", nulls)
    rows_raw = raw.get("values")
    if not isinstance(rows_raw, list):
        raise ValueError(f"{where} has an invalid data structure")
    rows = [_cells(r, f"{where} row {i + 1}", nulls) for i, r in enumerate(rows_raw)]
    labels, units = raw.get("labels"), raw.get("units")
    if not (isinstance(labels, list) and all(isinstance(s, str) for s in labels)):
        raise ValueError(f"{where} has invalid column names")
    if not (isinstance(units, list) and all(isinstance(s, str) for s in units)):
        raise ValueError(f"{where} has invalid units")
    meta = raw.get("metadata")
    if not isinstance(meta, Mapping):
        raise ValueError(f"{where} has no metadata object")
    width = len(labels)
    if len(units) != width or len(rows) != len(time) or any(len(r) != width for r in rows):
        raise ValueError(f"{where} has rows, names and units of different sizes")
    values = np.asarray(rows, dtype=float).reshape(len(time), width)
    payload: dict[str, Any] = {
        "time": time,
        "values": values,
        "labels": labels,
        "units": units,
        "metadata": dict(meta),
    }
    for key in ("cat_levels", "level_order"):
        if raw.get(key) is not None:
            payload[key] = raw[key]
    try:
        ds = DataStruct.from_dict(payload)
        for key, kept in (("cat_levels", ds.cat_levels), ("level_order", ds.level_order)):
            if key in payload and kept is None:
                warnings.append(f"{where}: its {key} was not readable and was dropped")
        return ds
    except ValueError as exc:
        # A damaged level table: the app repairs it (sanitizeDataStruct); keep
        # the numbers, drop the table, and say so.
        payload.pop("cat_levels", None)
        payload.pop("level_order", None)
        warnings.append(f"{where}: its category level table was unreadable and was dropped ({exc})")
        return DataStruct.from_dict(payload)


def _folder_paths(raw: Any) -> dict[str, tuple[str, ...]]:
    folders = (
        {
            str(f["id"]): f
            for f in raw
            if isinstance(f, Mapping)
            and isinstance(f.get("id"), str)
            and isinstance(f.get("name"), str)
        }
        if isinstance(raw, list)
        else {}
    )
    paths: dict[str, tuple[str, ...]] = {}
    for fid in folders:
        path: list[str] = []
        cur: str | None = fid
        seen: set[str] = set()
        while cur is not None and cur in folders and cur not in seen:
            seen.add(cur)
            path.append(str(folders[cur]["name"]))
            parent = folders[cur].get("parentId")
            cur = parent if isinstance(parent, str) else None
        paths[fid] = tuple(reversed(path))
    return paths


def _source(raw: Any, base_dir: str | None) -> str | None:
    if not isinstance(raw, Mapping) or not isinstance(raw.get("path"), str) or not raw["path"]:
        return None
    if raw.get("kind") == "path":
        return str(raw["path"])
    if raw.get("kind") == "bundle" and base_dir:
        return resolve_bundle_source(base_dir, str(raw["path"]))
    return None


def _dataset(
    d: Any, i: int, folders: Mapping[str, tuple[str, ...]], base_dir: str | None,
    nulls: list[int], warnings: list[str],
) -> WorkspaceDataset:  # fmt: skip
    if not isinstance(d, Mapping):
        raise ValueError(f"dataset {i} is invalid")
    name = str(d["name"]) if isinstance(d.get("name"), str) else f"dataset {i + 1}"
    where = f'dataset {i} ("{name}")'
    data = _struct(d.get("data"), where, nulls, warnings)
    raw = _struct(d["raw"], f"{where} base", [0], warnings) if d.get("raw") is not None else None
    raw_formulas = d.get("formulas")
    formulas = tuple(
        dict(f)
        for f in (raw_formulas if isinstance(raw_formulas, list) else [])
        if isinstance(f, Mapping)
        and isinstance(f.get("name"), str)
        and isinstance(f.get("expr"), str)
    )
    pending = d.get("pending")
    sampled = isinstance(pending, Mapping) and pending.get("previewSampled") is not False
    if sampled:
        warnings.append(
            f"{where} was saved before its rows were read from its source; "
            "they may be a preview sample"
        )
    folder = d.get("folderId")
    corrections = d.get("corrections")
    tags = d.get("tags")
    return WorkspaceDataset(
        id=str(d["id"]) if isinstance(d.get("id"), str) else f"ws-{i}",
        name=name,
        data=data,
        raw=raw,
        formulas=formulas,
        corrections=dict(corrections) if isinstance(corrections, Mapping) else None,
        folder_path=folders.get(folder, ()) if isinstance(folder, str) else (),
        source_path=_source(d.get("source"), base_dir),
        notes=str(d["notes"]) if isinstance(d.get("notes"), str) else "",
        tags=tuple(t for t in tags if isinstance(t, str) and t.strip())
        if isinstance(tags, list)
        else (),
        sampled=sampled,
    )


def parse_workspace(text: str, *, base_dir: str | Path | None = None) -> Workspace:
    """Parse ``.dwk`` text. ``base_dir`` (the file's folder) resolves a packed
    project's bundle-relative sources. Raises ``ValueError`` for anything that
    is not a readable workspace, :class:`WorkspaceVersionError` (a
    ``ValueError``) for an unknown version."""
    try:
        doc = json.loads(text)
    except (json.JSONDecodeError, ValueError, RecursionError) as exc:
        raise ValueError("not a valid workspace file (bad JSON)") from exc
    if not isinstance(doc, Mapping) or doc.get("format") != WORKSPACE_FORMAT:
        raise ValueError("not a quantized workspace (.dwk) file")
    version = doc.get("version")
    known = sorted(WORKSPACE_VERSIONS)
    if isinstance(version, int) and not isinstance(version, bool) and version > known[-1]:
        raise WorkspaceVersionError(
            f"this workspace is version {version}, written by a newer Quantized; "
            f"this build reads versions {known[0]} to {known[-1]}. Update quantized to read it."
        )
    if version not in WORKSPACE_VERSIONS or isinstance(version, bool):
        raise WorkspaceVersionError(f"unsupported workspace version: {version!r}")
    raw_datasets = doc.get("datasets")
    if not isinstance(raw_datasets, list):
        raise ValueError("workspace has no datasets")
    warnings: list[str] = []
    nulls = [0]
    folders = _folder_paths(doc.get("folders"))
    base = str(base_dir) if base_dir is not None else None
    datasets = tuple(
        _dataset(d, i, folders, base, nulls, warnings) for i, d in enumerate(raw_datasets)
    )
    if nulls[0]:
        warnings.insert(
            0, f"{nulls[0]} blank cell(s) saved by an older version were read as missing (NaN)"
        )
    active = doc.get("activeId")
    ids = {d.id for d in datasets}
    steps = doc.get("pipeline")
    return Workspace(
        version=int(version),
        datasets=datasets,
        active_id=active
        if isinstance(active, str) and active in ids
        else (datasets[0].id if datasets else None),
        pipeline=tuple(dict(s) for s in steps if isinstance(s, Mapping))
        if isinstance(steps, list)
        else (),
        saved_at=str(doc["savedAt"]) if isinstance(doc.get("savedAt"), str) else None,
        warnings=tuple(warnings),
    )


def read_workspace(path: str | Path) -> Workspace:
    """Read a ``.dwk`` file (:func:`parse_workspace`), resolving packed
    sources against its folder."""
    p = Path(path)
    return parse_workspace(p.read_text(encoding="utf-8"), base_dir=p.resolve().parent)
