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


def _allowed_roots() -> tuple[Path, ...]:
    """Directories ``/import`` may read from: the user's home, the current
    working directory, and the system temp dir — widen with the ``QZ_DATA_ROOTS``
    env var (os.pathsep-separated). Resolved so symlinks/.. can't slip a root in."""
    raw = [Path.home(), Path.cwd(), Path(tempfile.gettempdir())]
    raw += [Path(p) for p in os.environ.get("QZ_DATA_ROOTS", "").split(os.pathsep) if p.strip()]
    roots: list[Path] = []
    for r in raw:
        try:
            roots.append(r.resolve())
        except OSError:
            continue
    return tuple(roots)


def _safe_local_path(raw_path: str) -> Path:
    """Resolve a client-supplied path and confine it to the allowed roots.

    ``/import`` reads a path the server can already see (local desktop / CLI
    use). Resolving first (collapsing ``..`` and symlinks) and then requiring the
    result to sit under a fixed root blocks traversal to system files (e.g.
    ``/etc/passwd``, ``C:\\Windows\\...``) via the localhost API. Raises an
    HTTPException on an invalid or out-of-bounds path."""
    try:
        resolved = Path(raw_path).resolve()
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid path") from exc
    roots = _allowed_roots()
    if not any(resolved == root or root in resolved.parents for root in roots):
        raise HTTPException(
            status_code=403,
            detail="path is outside the allowed roots (set QZ_DATA_ROOTS to widen)",
        )
    return resolved


@router.post("/import")
def import_file(req: ImportRequest) -> dict[str, Any]:
    """Auto-detect format and import a local file path into a DataStruct."""
    path = _safe_local_path(req.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"file not found: {req.path}")
    try:
        ds = import_auto(path)
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
