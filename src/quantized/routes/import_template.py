"""Thin route: Origin graph templates (``.otp``/``.otpu``) -> a
``GraphTemplate`` JSON (gap-ecosystem plan item 5, decode-plan #21).

Template files carry no worksheet data (see
``io/origin_project/templates.py``'s module docstring), so this is a
SEPARATE import surface from the dataset importers in ``routes/parsers.py``
-- ``.otp``/``.otpu`` are deliberately never registered in ``io/registry.py``
(the single-registry rule governs DATA parsers; a template is a style
preset, not a DataStruct).

Two ways in, mirroring ``routes/parsers.py``'s ``/import``+``/upload`` split:
``GET`` reads a path the server can already see (desktop / CLI use, the same
containment guard as ``parsers.py``'s ``/import``); ``POST /upload`` takes
the file's bytes from the browser (file-picker / drag-drop). The frontend
wrapper (``api.ts`` client method + an "Import Origin template..." UI
hook-in) is explicitly OUT of scope for this item -- booked separately.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile

from quantized.io.origin_project.container import OriginProjectError
from quantized.io.origin_project.templates import read_origin_template

router = APIRouter(prefix="/api/import/template", tags=["import"])


def _allowed_roots() -> tuple[str, ...]:
    """Mirrors ``routes/parsers.py``'s containment allowlist (home / cwd /
    temp, widened by ``QZ_DATA_ROOTS``) -- duplicated rather than imported so
    the path-traversal guard below stays inline in the function the static
    analyzer traces end to end (see ``parsers.py``'s identical comment)."""
    raw = [Path.home(), Path.cwd(), Path(tempfile.gettempdir())]
    raw += [Path(p) for p in os.environ.get("QZ_DATA_ROOTS", "").split(os.pathsep) if p.strip()]
    roots: list[str] = []
    for r in raw:
        try:
            roots.append(os.path.realpath(r))
        except OSError:
            continue
    return tuple(roots)


@router.get("")
def import_template(path: str) -> dict[str, Any]:
    """Read a server-visible Origin graph template (``.otp``/``.otpu``) by
    path into a ``GraphTemplate``-shaped dict.

    The path is ``os.path.realpath``-normalized (collapsing ``..`` and
    symlinks) and confined to an allowed root (home / cwd / temp, widen via
    ``QZ_DATA_ROOTS``) before any filesystem access -- the same guard
    ``routes/parsers.py``'s ``/import`` uses.
    """
    try:
        resolved = os.path.realpath(path)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid path") from exc
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
        raise HTTPException(status_code=404, detail=f"file not found: {path}")
    try:
        return read_origin_template(Path(resolved))
    except OriginProjectError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/upload")
async def upload_template(file: UploadFile) -> dict[str, Any]:
    """Import an uploaded Origin graph template (browser file-picker /
    drag-drop) into a ``GraphTemplate``-shaped dict."""
    name = Path(file.filename or "template.otp").name or "template.otp"
    content = await file.read()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / name
            dest.write_bytes(content)
            return read_origin_template(dest)
    except OriginProjectError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
