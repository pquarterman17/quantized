"""Thin parser routes: import a file -> DataStruct JSON. No business logic.

Two ways in: ``/import`` reads a path the server can already see (desktop / CLI
use); ``/upload`` takes the file's bytes from the browser (the GUI file-picker
and drag-drop). Both auto-detect format via ``io.import_auto``.
"""

from __future__ import annotations

import os
import struct
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.origin_project import (
    drop_empty_library_books,
    drop_nonactionable_figures,
    read_origin_project_all,
)
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.preview import decimate_datastruct
from quantized.routes._bookcache import cache_project_books
from quantized.routes._payload import datastruct_payload, jsonify
from quantized.routes._uploadcache import stage_upload

router = APIRouter(prefix="/api/parsers", tags=["parsers"])

# Rows kept in a non-primary book's preview (Library sparkline resolution;
# see io/origin_project/preview.decimate_datastruct).
_PREVIEW_POINTS = 200


class ImportRequest(BaseModel):
    path: str
    # Escape hatch (ORIGIN_FILE_DECODE_PLAN #38): request the pre-#38 full-
    # inline "books": [payload, ...] shape instead of the lazy inventory. Used
    # by tooling that reads every book's data immediately after import (e.g.
    # tools/visual/origin_figures.mjs) and has no fetch-on-activate flow.
    full_books: bool = False


def _allowed_roots() -> tuple[str, ...]:
    """Real (symlink-resolved) absolute paths ``/import`` may read from: the
    user's home, the current working directory, and the system temp dir — widen
    with the ``QZ_DATA_ROOTS`` env var (os.pathsep-separated)."""
    raw = [Path.home(), Path.cwd(), Path(tempfile.gettempdir())]
    raw += [Path(p) for p in os.environ.get("QZ_DATA_ROOTS", "").split(os.pathsep) if p.strip()]
    roots: list[str] = []
    for r in raw:
        try:
            roots.append(os.path.realpath(r))
        except OSError:
            continue
    return tuple(roots)


def _origin_book_id(ds: DataStruct) -> str:
    return str(ds.metadata.get("origin_book", ""))


def _slim_metadata(meta: Any) -> dict[str, Any]:
    """Wire-payload metadata, minus ``origin_books`` — the full per-project
    book inventory ``_build_book`` (io/origin_project/opj.py) embeds in
    EVERY book's metadata. Grepped: nothing in routes/calc or the frontend
    reads it back off the wire (``read_origin_books`` callers that DO use it
    go through the pure Python API, untouched by this trim) — it duplicates
    ~10-15 KB per book project-wide, which is material at PNR.opj's 122-book
    scale (~1.4 MB of dead weight). Trimmed only here, at the HTTP boundary."""
    return {k: v for k, v in dict(meta).items() if k != "origin_books"}


def _book_payload(ds: DataStruct) -> dict[str, Any]:
    """``datastruct_payload``, with ``_slim_metadata`` applied."""
    payload = datastruct_payload(ds)
    payload["metadata"] = _slim_metadata(payload["metadata"])
    return payload


def _book_primary_marker(ds: DataStruct) -> dict[str, Any]:
    """The ``books[]`` entry for the book ALREADY returned in full at the
    payload's top level — carries no ``time``/``values``/preview of its own
    (nothing to duplicate): the frontend builds this book's Dataset from the
    top-level payload instead of this entry. ``primary: true`` is its
    discriminant (see ``_book_preview_payload``'s ``lazy: true`` sibling)."""
    return {
        "lazy": False,
        "primary": True,
        "id": _origin_book_id(ds),
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": _slim_metadata(ds.metadata),
        "rows": ds.n_points,
        "cols": ds.n_channels,
    }


def _book_preview_payload(ds: DataStruct) -> dict[str, Any]:
    """A non-primary book's lightweight inventory entry: real labels/units/
    metadata (so the Library folder tree, tags, and book name all resolve
    immediately) plus a downsampled preview time/values series (so a Library
    sparkline renders without the full column data) — never the full
    ``.time``/``.values``. ``lazy: true`` is the frontend's discriminant
    between this shape and a full/primary entry."""
    preview = decimate_datastruct(ds, target_points=_PREVIEW_POINTS)
    return {
        "lazy": True,
        "id": _origin_book_id(ds),
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": _slim_metadata(ds.metadata),
        "rows": ds.n_points,
        "cols": ds.n_channels,
        # Just time/values (not a full datastruct_payload): labels/units/
        # metadata above already describe this book, so nesting a second
        # copy of them under `preview` would double the very weight this
        # entry exists to avoid.
        "preview": {"time": jsonify(preview.time), "values": jsonify(preview.values)},
    }


def _book_source_ref(path: Path, upload_token: str | None) -> dict[str, str]:
    """A stable reference the frontend echoes back to ``/api/parsers/books/data``
    to fetch one lazy book's full data later: an upload token when this import
    came from ``/upload`` (its bytes are staged, not at a caller-visible path),
    else the resolved path ``/import`` already validated."""
    if upload_token is not None:
        return {"kind": "upload", "token": upload_token}
    return {"kind": "path", "path": str(path)}


def _import_with_books(
    path: Path, *, full_books: bool = False, upload_token: str | None = None
) -> dict[str, Any]:
    """Single-DataStruct payload; Origin projects also carry every workbook.

    A multi-book project adds ``"books": [...]`` so the Library still lists
    every workbook immediately (the locked import-all UX) — but, per
    ORIGIN_FILE_DECODE_PLAN #38, the PRIMARY book (the one this function also
    returns in full at the top level) gets a no-data MARKER entry
    (``_book_primary_marker`` — nothing to duplicate), and every OTHER entry
    is a lightweight inventory + downsampled preview (``_book_preview_payload``,
    never the full ``.time``/``.values``); ``"book_source"`` is the reference
    a later ``/api/parsers/books/data`` call uses to fetch one book's full
    data on its first activation in the UI. Importing PNR.opj (122 books,
    8.5M cells) this way shrinks the response from ~85 MB to ~2 MB (profiled
    2026-07-09 perf-quick-wins follow-up). Pass ``full_books=True`` (the
    pre-#38 behaviour, byte-for-byte: every book inline, no markers/preview)
    to get every book's data inline instead — used by tooling with no
    fetch-on-activate flow (see ``ImportRequest.full_books``'s docstring);
    other formats are untouched either way.

    Origin projects (``.opj``/``.opju``) are parsed ONCE via
    ``read_origin_project_all``: the primary dataset and the full book list
    used to come from two independent full-project parses (``import_auto`` ->
    ``read_origin_project``, then a separate ``read_origin_books``), each
    re-reading the file from disk and re-decoding every column; that
    redundant parse dominated the ~4s round-trip on a 121.56 MB / 8.5M-cell
    project (profiled 2026-07-09). The same already-read bytes are reused
    below for the figures scan too, instead of a third disk read. When lazy,
    the parsed book list is also handed to ``_bookcache`` so the common
    "activate a book right after import" path never re-parses.
    """
    suffix = path.suffix.lower()
    if suffix in (".opj", ".opju"):
        raw = path.read_bytes()
        ds, all_books = read_origin_project_all(path, raw=raw)
        books = drop_empty_library_books(all_books)
        if full_books:
            # Byte-for-byte the pre-#38 shape: every book inline, top level
            # unchanged (no metadata slimming — tooling built against the old
            # response, e.g. tools/visual/origin_figures.mjs, gets exactly
            # what it always got).
            payload = datastruct_payload(ds)
            if len(books) > 1:
                payload["books"] = [datastruct_payload(b) for b in books]
        else:
            payload = _book_payload(ds)
            if len(books) > 1:
                primary_id = _origin_book_id(ds)
                payload["books"] = [
                    _book_primary_marker(b)
                    if _origin_book_id(b) == primary_id
                    else _book_preview_payload(b)
                    for b in books
                ]
                payload["book_source"] = _book_source_ref(path, upload_token)
                cache_project_books(path, books)
        try:
            if suffix == ".opj":
                figs = extract_figures(raw)
            else:
                figs = extract_figures_opju(raw)
            # Gate out non-actionable layer anchors (internal storage/thumbnail
            # blocks with no bound curves and no source) so the Library's Figures
            # section shows only restorable graphs, not dead "SYSTEM" rows. Both
            # containers can carry these records (XMCD.opj alone exposes 61).
            figs = drop_nonactionable_figures(figs)
        except (IndexError, ValueError, KeyError, struct.error):
            # Figures are an optional nicety; a decode hiccup on a malformed or
            # truncated project must degrade to "no figures", never fail the
            # whole import (the data books already succeeded above).
            figs = []
        if figs:
            payload["figures"] = figs
        return payload

    ds = import_auto(path)
    return datastruct_payload(ds)


@router.post("/import")
def import_file(req: ImportRequest) -> dict[str, Any]:
    """Auto-detect format and import a local file path into a DataStruct.

    ``/import`` reads a path the server can already see (local desktop / CLI
    use). The path is ``os.path.realpath``-normalized (collapsing ``..`` and
    symlinks) and confined to an allowed root (home / cwd / temp, widen via
    ``QZ_DATA_ROOTS``) via ``os.path.commonpath`` before any filesystem access,
    so the localhost API cannot be used to read system files (e.g.
    ``/etc/passwd``) through path traversal.
    """
    try:
        resolved = os.path.realpath(req.path)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid path") from exc
    # Inline containment guard (kept in this function so the static analyzer can
    # see the path-traversal barrier sits between the taint and the sink).
    within_allowed = False
    for root in _allowed_roots():
        try:
            if os.path.commonpath((root, resolved)) == root:
                within_allowed = True
                break
        except ValueError:
            continue  # different drives (Windows) -> not under this root
    if not within_allowed:
        raise HTTPException(
            status_code=403,
            detail="path is outside the allowed roots (set QZ_DATA_ROOTS to widen)",
        )
    if not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail=f"file not found: {req.path}")
    try:
        return _import_with_books(Path(resolved), full_books=req.full_books)
    except (ValueError, KeyError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/upload")
async def upload_file(file: UploadFile, full_books: bool = False) -> dict[str, Any]:
    """Import an uploaded data file (browser file-picker / drag-drop).

    The bytes are staged under the original *basename* (so the extension
    still drives format dispatch, and ``..`` path parts can't escape). An
    Origin project (``.opj``/``.opju``) is staged PERSISTENTLY (bounded LRU,
    see ``_uploadcache``) instead of in an ephemeral temp dir, because a lazy
    multi-book import (#38, the default — pass ``?full_books=true`` for the
    old inline-everything behaviour) needs the bytes to still be around when
    the browser later activates a non-primary book and fetches its full data
    (``/api/parsers/books/data``). Every other upload keeps the ephemeral
    temp dir: it's deleted before this handler returns, since nothing needs
    it afterwards.
    """
    name = Path(file.filename or "upload.dat").name or "upload.dat"
    content = await file.read()
    suffix = Path(name).suffix.lower()
    try:
        if suffix in (".opj", ".opju"):
            dest, token = stage_upload(name, content)
            return _import_with_books(dest, full_books=full_books, upload_token=token)
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / name
            dest.write_bytes(content)
            return _import_with_books(dest, full_books=full_books)
    except (ValueError, KeyError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
