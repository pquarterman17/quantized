"""``GET``/``PUT /api/prefs``: the GUI preferences file (owner decision 2026-11-25).

Thin adapter over :mod:`quantized.io.prefs_store`. The API token / Origin
checks of ``web_guard.security_guard`` apply as to every ``/api`` route.

- ``GET`` returns ``{"slots": {...}, "notice": str | null}``; ``notice`` says
  when a corrupt file was just moved aside.
- ``PUT`` takes ``{"slots": {name: object | null}}`` and MERGES it (``null``
  deletes one slot), so two browser tabs writing different slots never
  clobber each other. A body that is not that shape, or larger than the cap,
  is refused with 422 and nothing is written.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from quantized.io import prefs_store
from quantized.routes._errors import CALC_ERRORS

router = APIRouter(prefix="/api/prefs", tags=["prefs"])

# The request may carry the whole file plus its envelope.
_MAX_BODY = prefs_store.MAX_PREFS_BYTES + 1024

_BODY_DOC: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "content": {
            "application/json": {
                "schema": {
                    "type": "object",
                    "required": ["slots"],
                    "properties": {
                        "slots": {
                            "type": "object",
                            "additionalProperties": {"type": "object", "nullable": True},
                        }
                    },
                }
            }
        },
    }
}


class PrefsResponse(BaseModel):
    slots: dict[str, dict[str, Any]]
    notice: str | None = None


def _load() -> PrefsResponse:
    res = prefs_store.load_prefs()
    notice = None
    if res.moved_aside is not None:
        notice = f"The preferences file was unreadable and was set aside as {res.moved_aside.name}"
    return PrefsResponse(slots=res.slots, notice=notice)


@router.get("")
def get_prefs() -> PrefsResponse:
    """Every saved preference slot."""
    return _load()


async def _read_capped(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > _MAX_BODY:
        raise HTTPException(status_code=422, detail=f"prefs body over {_MAX_BODY // 1024} KiB")
    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        if len(buf) > _MAX_BODY:
            raise HTTPException(status_code=422, detail=f"prefs body over {_MAX_BODY // 1024} KiB")
    return bytes(buf)


@router.put(
    "",
    openapi_extra=_BODY_DOC,
    responses={422: {"description": "Not an object of slots, or too large"}},
)
async def put_prefs(request: Request) -> PrefsResponse:
    """Merge slots into the prefs file (``null`` deletes a slot)."""
    raw = await _read_capped(request)
    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail="prefs body is not JSON") from exc
    if not isinstance(body, dict) or "slots" not in body:
        raise HTTPException(status_code=422, detail='prefs body must be {"slots": {...}}')
    try:
        slots = await run_in_threadpool(prefs_store.apply_update, body["slots"])
    except CALC_ERRORS as exc:  # prefs_store.PrefsError is a ValueError
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=503, detail="the preferences file could not be written"
        ) from exc
    return PrefsResponse(slots=slots)
