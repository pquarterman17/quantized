"""Search saved projects (``.dwk``) on disk without opening them (gap audit 9, G23).

The "which project had the sample 2311-B fit?" question: scan a folder of saved
Quantized workspaces and report which files mention a query, and where.

READ ONLY, NEVER EXECUTES. A file is read as bytes, decoded as UTF-8 and parsed
with ``json.loads`` -- nothing in it is evaluated (a recorded pipeline step's
``code`` and a computed column's ``expr`` are searched as plain text, never
run). Numeric cell arrays are not read into numpy at all: only the text a person
would search is walked (:func:`workspace_text`), so a scan costs one JSON parse
per file and not a full :mod:`~quantized.io.workspace_dwk_read` load.

SEARCHABLE TEXT (the saved format is ``frontend/src/lib/workspaceSerialize.ts``):
dataset names, column names and units, column comments, scalar metadata (the
bulky decoded-Origin blobs are skipped, as the in-app Find does), notes, tags,
computed-column formulas, source paths, Library folder / workbook names, report,
analysis-result, figure and page names, figure titles, and saved plot-spec names.

BOUNDS. :class:`ScanLimits` caps the file count, the size of one file, the
folder depth, the hits kept per file and the wall clock. Hitting the file or time
cap stops the walk and says so (``ScanResult.truncated``); it never returns a
silent partial answer.

FAIL CLOSED. Every file that cannot be searched is listed in
``ScanResult.skipped`` with a reason (unreadable, oversize, not a workspace, a
newer version than this build reads, a symlink). Symlinks are never followed, so
a folder cannot lead the scan outside the folder the caller was allowed.

Pure ``io`` layer: no web stack. Confining WHICH folder may be scanned is the
route's job (``routes/project_search.py``).
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from quantized.desktop_project_file import WORKSPACE_FORMAT, WORKSPACE_VERSIONS

__all__ = [
    "FileMatch",
    "Hit",
    "ScanLimits",
    "ScanResult",
    "Skipped",
    "scan_folder",
    "search_workspace_text",
    "workspace_text",
]

PROJECT_SUFFIX = ".dwk"
_SNIPPET_RADIUS = 40
_MAX_TEXT = 4000  # per searched string: a pasted log in a note must not dominate
#: Metadata keys that are bulky blobs or collections with their own hit shape.
_SKIP_META = frozenset({"origin_books", "text_columns", "label_rows", "origin_text_columns"})


@dataclass(frozen=True)
class ScanLimits:
    """Bounds of one folder scan (defaults are the route's defaults)."""

    max_files: int = 500
    max_file_bytes: int = 64 * 1024 * 1024
    max_depth: int = 8
    max_hits_per_file: int = 25
    timeout_s: float = 20.0


@dataclass(frozen=True)
class Hit:
    """One match: what kind of thing, where it lives, and a snippet."""

    kind: str  # dataset | column | unit | comment | metadata | note | tag | ...
    location: str  # e.g. 'dataset "run.csv", column "Rxy"'
    snippet: str


@dataclass(frozen=True)
class FileMatch:
    path: str
    relpath: str
    size: int
    hits: tuple[Hit, ...]
    #: Matches found, which may exceed ``len(hits)`` (the per-file cap).
    hit_count: int


@dataclass(frozen=True)
class Skipped:
    path: str
    reason: str


@dataclass(frozen=True)
class ScanResult:
    root: str
    matches: tuple[FileMatch, ...] = ()
    skipped: tuple[Skipped, ...] = ()
    #: Project files examined (matched, not matched, or skipped).
    scanned: int = 0
    #: Why the walk stopped early (``max_files`` / ``timeout``), else ``None``.
    truncated: str | None = None
    elapsed_s: float = 0.0
    warnings: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class _Item:
    kind: str
    text: str
    location: str


def _strs(v: Any) -> list[str]:
    return [s for s in v if isinstance(s, str)] if isinstance(v, list) else []


def _recs(doc: Mapping[str, Any], key: str) -> list[Any]:
    v = doc.get(key)
    return v if isinstance(v, list) else []


def _name(rec: Any) -> str | None:
    n = rec.get("name") if isinstance(rec, Mapping) else None
    return n if isinstance(n, str) and n else None


def _dataset_items(i: int, d: Mapping[str, Any]) -> Iterator[_Item]:
    name = _name(d) or f"dataset {i + 1}"
    where = f'dataset "{name}"'
    yield _Item("dataset", name, where)
    data = d.get("data")
    data = data if isinstance(data, Mapping) else {}
    units = _strs(data.get("units"))
    for c, label in enumerate(_strs(data.get("labels"))):
        yield _Item("column", label, f'{where}, column "{label}"')
        if c < len(units) and units[c]:
            yield _Item("unit", units[c], f'{where}, column "{label}" unit')
    meta = data.get("metadata")
    meta = meta if isinstance(meta, Mapping) else {}
    for key, val in meta.items():
        if key in _SKIP_META:
            continue
        if key == "column_comments" and isinstance(val, Mapping):
            for col, text in val.items():
                if isinstance(text, str) and text:
                    yield _Item("comment", text, f'{where}, column "{col}" comment')
        elif key == "all_column_names":
            for col in _strs(val):
                yield _Item("column", col, f'{where}, column "{col}"')
        elif key == "comments":
            for text in _strs(val):
                yield _Item("comment", text, f"{where}, comment")
        elif isinstance(val, str | int | float) and not isinstance(val, bool):
            yield _Item("metadata", f"{key}: {val}", f'{where}, metadata "{key}"')
    if isinstance(d.get("notes"), str) and d["notes"]:
        yield _Item("note", d["notes"], f"{where}, notes")
    for tag in _strs(d.get("tags")):
        yield _Item("tag", tag, f'{where}, tag "{tag}"')
    for f in _recs(d, "formulas"):
        if isinstance(f, Mapping) and isinstance(f.get("name"), str):
            expr = f.get("expr") if isinstance(f.get("expr"), str) else ""
            yield _Item(
                "formula", f"{f['name']} = {expr}", f'{where}, computed column "{f["name"]}"'
            )
    src = d.get("source")
    if isinstance(src, Mapping) and isinstance(src.get("path"), str) and src["path"]:
        yield _Item("source", src["path"], f"{where}, source file")


def workspace_text(doc: Mapping[str, Any]) -> Iterator[_Item]:
    """Every searchable string of a parsed workspace document, with where it lives."""
    datasets = doc.get("datasets")
    for i, d in enumerate(datasets if isinstance(datasets, list) else []):
        if isinstance(d, Mapping):
            yield from _dataset_items(i, d)
    for key, kind, label in (
        ("folders", "folder", "Library folder"),
        ("workbooks", "workbook", "workbook"),
        ("reports", "report", "report"),
        ("analysisResults", "result", "analysis result"),
        ("figureDocs", "figure", "figure"),
        ("editableFigures", "figure", "figure"),
        ("pages", "page", "page"),
        ("savedPlotSpecs", "plot_spec", "saved plot spec"),
    ):
        for rec in _recs(doc, key):
            if (n := _name(rec)) is not None:
                yield _Item(kind, n, f'{label} "{n}"')
    for fig in _recs(doc, "originFigures"):
        if isinstance(fig, Mapping) and isinstance(fig.get("stem"), str) and fig["stem"]:
            yield _Item("figure", fig["stem"], f'Origin figure "{fig["stem"]}"')
    for rec in _recs(doc, "editableFigures"):
        view = (rec.get("plot") or {}).get("view") if isinstance(rec, Mapping) else None
        title = view.get("plotTitle") if isinstance(view, Mapping) else None
        if isinstance(title, str) and title:
            yield _Item("title", title, f'figure "{_name(rec) or "?"}", title')
    for rec in _recs(doc, "figureDocs"):
        cfg = rec.get("config") if isinstance(rec, Mapping) else None
        title = cfg.get("title") if isinstance(cfg, Mapping) else None
        if isinstance(title, str) and title:
            yield _Item("title", title, f'figure "{_name(rec) or "?"}", title')


def _snippet(text: str, at: int, n: int) -> str:
    lo, hi = max(0, at - _SNIPPET_RADIUS), min(len(text), at + n + _SNIPPET_RADIUS)
    body = " ".join(text[lo:hi].split())
    return ("…" if lo > 0 else "") + body + ("…" if hi < len(text) else "")


def search_workspace_text(
    doc: Mapping[str, Any], query: str, max_hits: int = 25
) -> tuple[list[Hit], int]:
    """Case-insensitive substring hits of ``query`` in a parsed workspace
    document: ``(first max_hits hits, total hits)``."""
    needle = query.strip().lower()
    hits: list[Hit] = []
    total = 0
    if not needle:
        return hits, total
    for item in workspace_text(doc):
        text = item.text[:_MAX_TEXT]
        at = text.lower().find(needle)
        if at < 0:
            continue
        total += 1
        if len(hits) < max_hits:
            hits.append(Hit(item.kind, item.location, _snippet(text, at, len(needle))))
    return hits, total


def _parse(raw: bytes) -> Mapping[str, Any]:
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ValueError("not a valid workspace file (bad JSON)") from exc
    if not isinstance(doc, Mapping) or doc.get("format") != WORKSPACE_FORMAT:
        raise ValueError("not a quantized workspace (.dwk) file")
    version = doc.get("version")
    known = sorted(WORKSPACE_VERSIONS)
    if isinstance(version, int) and not isinstance(version, bool) and version > known[-1]:
        raise ValueError(
            f"workspace version {version} is newer than this build reads ({known[0]}-{known[-1]})"
        )
    if version not in WORKSPACE_VERSIONS or isinstance(version, bool):
        raise ValueError(f"unsupported workspace version: {version!r}")
    return doc


def _candidates(
    root: str, max_depth: int, skipped: list[Skipped]
) -> Iterator[tuple[str, os.DirEntry[str]]]:
    """``.dwk`` entries under ``root``, depth-first and name-sorted (stable
    output). Symlinks are reported, never followed."""
    stack: list[tuple[str, int]] = [(root, 0)]
    while stack:
        folder, depth = stack.pop()
        try:
            with os.scandir(folder) as it:
                entries = sorted(it, key=lambda e: e.name)
        except OSError as exc:
            skipped.append(Skipped(folder, f"folder unreadable ({exc.strerror or exc})"))
            continue
        subdirs: list[tuple[str, int]] = []
        for e in entries:
            try:
                if e.is_symlink():
                    if e.name.lower().endswith(PROJECT_SUFFIX) or e.is_dir():
                        skipped.append(Skipped(e.path, "symbolic link (not followed)"))
                elif e.is_dir():
                    if depth < max_depth:
                        subdirs.append((e.path, depth + 1))
                elif e.is_file() and e.name.lower().endswith(PROJECT_SUFFIX):
                    yield folder, e
            except OSError as exc:
                skipped.append(Skipped(e.path, f"unreadable ({exc.strerror or exc})"))
        stack.extend(reversed(subdirs))


def scan_folder(
    root: str,
    query: str,
    limits: ScanLimits | None = None,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> ScanResult:
    """Search every ``.dwk`` under ``root`` (already confined by the caller)
    for ``query``. ``clock`` is injectable so the timeout is testable."""
    lim = limits or ScanLimits()
    started = clock()
    skipped: list[Skipped] = []
    matches: list[FileMatch] = []
    scanned = 0
    truncated: str | None = None
    for _folder, e in _candidates(root, lim.max_depth, skipped):
        if scanned >= lim.max_files:
            truncated = "max_files"
            break
        if clock() - started > lim.timeout_s:
            truncated = "timeout"
            break
        scanned += 1
        try:
            size = e.stat(follow_symlinks=False).st_size
            if size > lim.max_file_bytes:
                skipped.append(Skipped(e.path, f"larger than the {lim.max_file_bytes}-byte limit"))
                continue
            with open(e.path, "rb") as fh:
                raw = fh.read(lim.max_file_bytes + 1)
            if len(raw) > lim.max_file_bytes:
                skipped.append(Skipped(e.path, "grew past the size limit while reading"))
                continue
            doc = _parse(raw)
            hits, total = search_workspace_text(doc, query, lim.max_hits_per_file)
        except OSError as exc:
            skipped.append(Skipped(e.path, f"unreadable ({exc.strerror or exc})"))
            continue
        except (ValueError, MemoryError) as exc:
            skipped.append(Skipped(e.path, str(exc) or "unreadable"))
            continue
        except (AttributeError, TypeError, KeyError, IndexError):
            # A hand-edited or damaged file with a wrongly typed field (a figure's
            # ``plot`` as a string, ...) must cost only that file, never the scan.
            skipped.append(Skipped(e.path, "malformed workspace (unexpected field types)"))
            continue
        if total:
            matches.append(
                FileMatch(e.path, os.path.relpath(e.path, root), size, tuple(hits), total)
            )
    return ScanResult(
        root=root,
        matches=tuple(matches),
        skipped=tuple(skipped),
        scanned=scanned,
        truncated=truncated,
        elapsed_s=round(clock() - started, 3),
    )
