"""Thin parser routes: import a file -> DataStruct JSON. No business logic.

Two ways in: ``/import`` reads a path the server can already see (desktop / CLI
use); ``/upload`` takes the file's bytes from the browser (the GUI file-picker
and drag-drop). Both auto-detect format via ``io.import_auto``.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from quantized.io import import_auto
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


def _within_allowed_roots(resolved: str) -> bool:
    """True if ``resolved`` (an already-realpath'd absolute path) sits inside one
    of the allowed roots. Uses ``os.path.commonpath`` containment — the standard
    path-traversal guard."""
    for root in _allowed_roots():
        try:
            if os.path.commonpath((root, resolved)) == root:
                return True
        except ValueError:
            continue  # different drives (Windows) -> not under this root
    return False


@router.post("/import")
def import_file(req: ImportRequest) -> dict[str, Any]:
    """Auto-detect format and import a local file path into a DataStruct.

    ``/import`` reads a path the server can already see (local desktop / CLI
    use). The path is ``os.path.realpath``-normalized (collapsing ``..`` and
    symlinks) and confined to an allowed root (home / cwd / temp, widen via
    ``QZ_DATA_ROOTS``) before any filesystem access, so the localhost API cannot
    be used to read system files (e.g. ``/etc/passwd``) via traversal.
    """
    try:
        resolved = os.path.realpath(req.path)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid path") from exc
    if not _within_allowed_roots(resolved):
        raise HTTPException(
            status_code=403,
            detail="path is outside the allowed roots (set QZ_DATA_ROOTS to widen)",
        )
    # Use the validated, realpath-normalized string directly (no Path() re-wrap)
    # so the guarded value is exactly what reaches the filesystem.
    if not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail=f"file not found: {req.path}")
    try:
        ds = import_auto(resolved)
    except (ValueError, KeyError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(ds)


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
            ds = import_auto(dest)
    except (ValueError, KeyError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(ds)
