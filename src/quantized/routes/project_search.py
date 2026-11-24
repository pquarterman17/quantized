"""Thin route: find a query across a folder of saved projects (G23).

``POST /api/project-search/folder`` -- validate, confine the folder, call the
pure scanner (``io/workspace_search``), serialize. Read only.

The folder is confined exactly as the app's browse/open routes confine theirs
(``routes/convert_quick.py`` ``_confine``): the realpath must sit inside an
allowed data root (home / cwd / temp, widen via ``QZ_DATA_ROOTS``). Native
folder-dialog grants are scoped to the relink gesture and do not widen it. The
scan is bounded by file count, file size, depth and a wall-clock timeout, so it
runs synchronously (FastAPI runs a plain ``def`` route in its threadpool)
rather than through the job queue: the worst case is the timeout (default 20 s,
hard cap 120 s), and an early stop is reported as ``truncated``, never hidden.
Provisional, owner to confirm: move to ``routes/jobs_api`` if real folders hit
the timeout.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.data_roots import allowed_data_prefixes, allowed_data_roots
from quantized.io.workspace_search import ScanLimits, scan_folder

router = APIRouter(prefix="/api/project-search", tags=["project-search"])

_HARD_MAX_FILES = 5000
_HARD_MAX_BYTES = 256 * 1024 * 1024
_HARD_MAX_DEPTH = 20
_HARD_TIMEOUT = 120.0


class FolderSearchRequest(BaseModel):
    folder: str
    query: str = Field(min_length=1, max_length=200)
    max_files: int = Field(default=500, ge=1, le=_HARD_MAX_FILES)
    max_file_bytes: int = Field(default=64 * 1024 * 1024, ge=1024, le=_HARD_MAX_BYTES)
    max_depth: int = Field(default=8, ge=0, le=_HARD_MAX_DEPTH)
    timeout_s: float = Field(default=20.0, gt=0, le=_HARD_TIMEOUT)


class HitOut(BaseModel):
    kind: str
    location: str
    snippet: str


class FileMatchOut(BaseModel):
    path: str
    relpath: str
    size: int
    hit_count: int
    hits: list[HitOut]


class SkippedOut(BaseModel):
    path: str
    reason: str


class FolderSearchResponse(BaseModel):
    folder: str
    scanned: int
    truncated: str | None
    elapsed_s: float
    matches: list[FileMatchOut]
    skipped: list[SkippedOut]


def _confine_folder(raw: str) -> str:
    try:
        resolved = os.path.realpath(os.path.expanduser(raw))
    except (OSError, ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=400, detail="invalid folder") from exc
    # Inline startswith containment: the form CodeQL's path barrier models. A
    # root itself is returned as the ROOT's own string, so the request's string
    # never reaches the filesystem on that branch (same as convert_quick).
    # Folder grants (desktop_consent dir grants) are scoped to the relink
    # gesture, so they do not widen this search: fail closed.
    safe: str | None = None
    if resolved.startswith(allowed_data_prefixes()):
        safe = resolved
    else:
        for root in allowed_data_roots():
            if resolved == root:
                safe = root
    if safe is None:
        raise HTTPException(
            status_code=403,
            detail="folder is outside the allowed folders (your home, the working "
            "folder and the temp folder; set QZ_DATA_ROOTS to widen)",
        )
    if not Path(safe).is_dir():
        raise HTTPException(status_code=404, detail=f"folder not found: {raw}")
    return safe


@router.post("/folder", response_model=FolderSearchResponse)
def search_folder(req: FolderSearchRequest) -> FolderSearchResponse:
    """Search every saved project (``.dwk``) under a folder for a query,
    without opening them. Unreadable files are listed in ``skipped``."""
    if not req.query.strip():
        raise HTTPException(status_code=422, detail="query is empty")
    safe = _confine_folder(req.folder)
    res = scan_folder(
        safe,
        req.query,
        ScanLimits(
            max_files=req.max_files,
            max_file_bytes=req.max_file_bytes,
            max_depth=req.max_depth,
            timeout_s=req.timeout_s,
        ),
    )
    return FolderSearchResponse(
        folder=safe,
        scanned=res.scanned,
        truncated=res.truncated,
        elapsed_s=res.elapsed_s,
        matches=[
            FileMatchOut(
                path=m.path,
                relpath=m.relpath,
                size=m.size,
                hit_count=m.hit_count,
                hits=[HitOut(kind=h.kind, location=h.location, snippet=h.snippet) for h in m.hits],
            )
            for m in res.matches
        ],
        skipped=[SkippedOut(path=s.path, reason=s.reason) for s in res.skipped],
    )
