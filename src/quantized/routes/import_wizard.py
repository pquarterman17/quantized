"""Thin routes for the interactive import wizard (ORIGIN_GAP_PLAN #40).

The browser sends raw file text; these adapters guess/preview/parse it under
adjustable :class:`~quantized.io.import_preview.ImportSettings` and return the
wizard's preview table or the imported ``DataStruct``. All logic lives in
``io.import_preview``.

The ``/filters`` routes are CRUD over saved :class:`~quantized.io.import_filters.
ImportFilter` records (name + glob + settings), persisted server-side so the
registry (``io.registry.resolve_parser``) can consult them headlessly, not just
from this wizard. All logic lives in ``io.import_filters``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.io.import_filters import (
    ImportFilter,
    delete_filter,
    load_filters,
    match_filter,
    save_filter,
)
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


# ── Saved import filters (gap #40 persistence) ───────────────────────────────


@router.get("/filters")
def list_filters_route() -> list[dict[str, Any]]:
    """All saved import filters, most-recently-saved information included."""
    return [f.to_dict() for f in load_filters()]


class SaveFilterRequest(BaseModel):
    name: str
    glob: str
    settings: dict[str, Any]


@router.post("/filters")
def save_filter_route(req: SaveFilterRequest) -> dict[str, Any]:
    """Save (upsert by name) a filter binding a glob to import settings."""
    try:
        filt = ImportFilter(
            name=req.name, glob=req.glob, settings=ImportSettings.from_dict(req.settings)
        )
        saved = save_filter(filt)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return saved.to_dict()


@router.delete("/filters/{name}")
def delete_filter_route(name: str) -> dict[str, str]:
    """Delete the saved filter named ``name``."""
    if not delete_filter(name):
        raise HTTPException(status_code=404, detail=f"no saved filter named '{name}'")
    return {"deleted": name}


class ImportWithFilterRequest(BaseModel):
    text: str
    filename: str | None = None  # match the best saved filter for this name
    filter_name: str | None = None  # or use one specific saved filter by name


@router.post("/filters/parse")
def parse_with_filter_route(req: ImportWithFilterRequest) -> dict[str, Any]:
    """Import ``text`` under a saved filter — by name, or the best glob match
    for ``filename`` — so a returning file imports with zero dialogs."""
    if req.filter_name is not None:
        filt = next((f for f in load_filters() if f.name == req.filter_name), None)
        if filt is None:
            raise HTTPException(
                status_code=404, detail=f"no saved filter named '{req.filter_name}'"
            )
    elif req.filename is not None:
        filt = match_filter(req.filename)
        if filt is None:
            raise HTTPException(
                status_code=404, detail=f"no saved filter matches '{req.filename}'"
            )
    else:
        raise HTTPException(status_code=422, detail="filename or filter_name is required")
    try:
        ds = parse_import(req.text, filt.settings)
    except (ValueError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(ds)
