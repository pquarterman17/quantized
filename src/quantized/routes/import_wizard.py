"""Thin routes for the interactive import wizard (ORIGIN_GAP_PLAN #40).

The browser sends raw file text; these adapters guess/preview/parse it under
adjustable :class:`~quantized.io.import_preview.ImportSettings` and return the
wizard's preview table or the imported ``DataStruct``. All logic lives in
``io.import_preview``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.io.import_preview import (
    ImportSettings,
    guess_settings,
    parse_import,
    preview_import,
)
from quantized.routes._payload import datastruct_payload

router = APIRouter(prefix="/api/import", tags=["import"])


class GuessRequest(BaseModel):
    text: str


@router.post("/guess")
def guess_route(req: GuessRequest) -> dict[str, Any]:
    """Best-effort starting settings for a pasted/uploaded file's text."""
    try:
        return guess_settings(req.text).to_dict()
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class PreviewRequest(BaseModel):
    text: str
    settings: dict[str, Any] | None = None  # None -> auto-guess
    max_rows: int = 20


@router.post("/preview")
def preview_route(req: PreviewRequest) -> dict[str, Any]:
    """Parse the first rows under the given settings for the wizard to render."""
    try:
        settings = (
            guess_settings(req.text) if req.settings is None
            else ImportSettings.from_dict(req.settings)
        )
        return preview_import(req.text, settings, max_rows=max(1, min(200, req.max_rows)))
    except (ValueError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class ParseRequest(BaseModel):
    text: str
    settings: dict[str, Any]


@router.post("/parse")
def parse_route(req: ParseRequest) -> dict[str, Any]:
    """Import the full text under confirmed settings into a DataStruct."""
    try:
        ds = parse_import(req.text, ImportSettings.from_dict(req.settings))
    except (ValueError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(ds)
