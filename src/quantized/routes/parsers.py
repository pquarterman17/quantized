"""Thin parser routes: import a file -> DataStruct JSON. No business logic."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
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
