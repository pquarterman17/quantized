"""Thin API adapter for read-only local database connectors."""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.io.sqlite_query import query_sqlite
from quantized.routes._errors import CALC_ERRORS_IO
from quantized.routes.parsers import _allowed_prefixes

router = APIRouter(prefix="/api/database", tags=["database"])


class SqliteQueryRequest(BaseModel):
    path: str
    query: str
    x_column: str | None = None
    max_rows: int = Field(default=100_000, ge=1, le=1_000_000)


def _resolve_db_path(raw_path: str) -> Path:
    """The SAME realpath + prefix containment guard the file-import routes use
    (``routes.parsers.import_file`` / ``routes.books._resolve_book_path``),
    reusing their ``_allowed_prefixes``. Without it, this localhost API is a
    read-any-local-SQLite-file primitive — a client could point it at a
    browser's ``Login Data`` store, another app's database, or any readable
    file, and exfiltrate rows through an arbitrary SELECT. Kept INLINE (not
    factored) so CodeQL sees the taint->sink path inside one function body,
    matching the sibling routes' deliberate choice.
    """
    try:
        resolved = os.path.realpath(raw_path)
    except (OSError, ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=400, detail="invalid path") from exc
    if not resolved.startswith(_allowed_prefixes()):
        raise HTTPException(
            status_code=403,
            detail="path is outside the allowed roots (set QZ_DATA_ROOTS to widen)",
        )
    if not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail=f"database file not found: {raw_path}")
    return Path(resolved)


@router.post("/sqlite/query")
def sqlite_query(req: SqliteQueryRequest) -> dict[str, object]:
    db_path = _resolve_db_path(req.path)
    try:
        return query_sqlite(
            db_path, req.query, x_column=req.x_column or None, max_rows=req.max_rows
        ).to_dict()
    except CALC_ERRORS_IO as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
