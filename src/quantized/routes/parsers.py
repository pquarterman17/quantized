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

from quantized.io import import_auto
from quantized.io.origin_project import (
    OriginProjectError,
    drop_empty_library_books,
    drop_nonactionable_figures,
    read_origin_books,
)
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.routes._payload import datastruct_payload

router = APIRouter(prefix="/api/parsers", tags=["parsers"])


class ImportRequest(BaseModel):
    path: str


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


def _import_with_books(path: Path) -> dict[str, Any]:
    """Single-DataStruct payload; Origin projects also carry every workbook.

    A multi-book project adds ``"books": [payload, …]`` so the frontend can
    import all books (the locked import-all UX); other formats are untouched.
    """
    ds = import_auto(path)
    payload = datastruct_payload(ds)
    if Path(path).suffix.lower() in (".opj", ".opju"):
        try:
            books = drop_empty_library_books(read_origin_books(Path(path)))
        except OriginProjectError:
            books = []
        if len(books) > 1:
            payload["books"] = [datastruct_payload(b) for b in books]
        suffix = Path(path).suffix.lower()
        try:
            raw = Path(path).read_bytes()
            if suffix == ".opj":
                figs = extract_figures(raw)
            else:
                # Gate out non-actionable layer anchors (internal storage/thumbnail
                # blocks with no bound curves and no source) so the Library's Figures
                # section shows only restorable graphs, not dead "SYSTEM" rows.
                figs = drop_nonactionable_figures(extract_figures_opju(raw))
        except (IndexError, ValueError, KeyError, struct.error):
            # Figures are an optional nicety; a decode hiccup on a malformed or
            # truncated project must degrade to "no figures", never fail the
            # whole import (the data books already succeeded above).
            figs = []
        if figs:
            payload["figures"] = figs
    return payload


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
        return _import_with_books(Path(resolved))
    except (ValueError, KeyError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/upload")
async def upload_file(file: UploadFile) -> dict[str, Any]:
    """Import an uploaded data file (browser file-picker / drag-drop).

    The bytes are staged in a temp dir under the original *basename* (so the
    extension still drives format dispatch, and ``..`` path parts can't escape).
    """
    name = Path(file.filename or "upload.dat").name or "upload.dat"
    content = await file.read()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / name
            dest.write_bytes(content)
            return _import_with_books(dest)
    except (ValueError, KeyError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
