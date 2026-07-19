"""Thin API adapter for read-only local database connectors."""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.io.sqlite_query import query_sqlite

router = APIRouter(prefix="/api/database", tags=["database"])


class SqliteQueryRequest(BaseModel):
    path: str
    query: str
    x_column: str | None = None
    max_rows: int = Field(default=100_000, ge=1, le=1_000_000)


@router.post("/sqlite/query")
def sqlite_query(req: SqliteQueryRequest) -> dict[str, object]:
    try:
        return query_sqlite(
            Path(req.path), req.query, x_column=req.x_column or None, max_rows=req.max_rows
        ).to_dict()
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

