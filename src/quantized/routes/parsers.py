"""Thin parser routes: import a file -> DataStruct JSON. No business logic.

Two ways in: ``/import`` reads a path the server can already see (desktop / CLI
use); ``/upload`` takes the file's bytes from the browser (the GUI file-picker
and drag-drop). Both auto-detect format via ``io.import_auto``.
"""

from __future__ import annotations

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


@router.post("/import")
def import_file(req: ImportRequest) -> dict[str, Any]:
    """Auto-detect format and import a local file path into a DataStruct."""
    path = Path(req.path)
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
