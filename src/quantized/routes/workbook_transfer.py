"""Thin routes for the large-workbook transfer store (LIBRARY_WORKBOOK_UX_PLAN
"Cross-session workbook transfer requirements" box 5, "Group F").

``POST /api/workbook-transfer/packages`` stores a transfer package (the raw
JSON text is the request body) and returns ``{id, token, size, expires_at}``;
``GET``/``DELETE .../packages/{id}`` need the token in the
``X-Transfer-Token`` header (a header, not a query string, so it never lands
in an access log). Both directions stream in chunks, never holding a whole
package in memory (ROBUSTNESS_PLAN #3). All logic -- id/path validation,
atomic write, expiry, cleanup, size bounds, the constant-time token check --
lives in :mod:`quantized.io.workbook_transfer_store`; see its module doc for
why this write authority is bounded and server-owned.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated, Any, BinaryIO, NoReturn

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from quantized.io.workbook_transfer_store import (
    EmptyPackage,
    InvalidPackageId,
    PackageExpired,
    PackageNotFound,
    PackageTooLarge,
    PendingPackage,
    TransferStore,
    TransferStoreError,
    transfer_dir,
)

router = APIRouter(prefix="/api/workbook-transfer", tags=["workbook-transfer"])

_CHUNK = 1 << 20
_UNAVAILABLE = "transfer store unavailable"

_BODY_DOC: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "content": {
            "application/json": {
                "schema": {
                    "type": "object",
                    "description": "A workbook transfer package, stored verbatim.",
                }
            }
        },
    }
}


def _store() -> TransferStore:
    """A store over the configured directory. A seam: tests swap it for one
    with an injected clock or smaller bounds."""
    return TransferStore(transfer_dir())


class StoredPackageResponse(BaseModel):
    id: str
    token: str
    size: int
    expires_at: str
    ttl_seconds: int


class DeletedResponse(BaseModel):
    deleted: bool


def _too_large(limit: int) -> HTTPException:
    detail = f"transfer package too large (limit {limit} bytes)"
    return HTTPException(status_code=413, detail=detail)


def _raise_for(exc: Exception) -> NoReturn:
    if isinstance(exc, InvalidPackageId):
        raise HTTPException(status_code=400, detail="invalid transfer package id") from exc
    if isinstance(exc, PackageExpired):
        raise HTTPException(status_code=410, detail="transfer package expired") from exc
    if isinstance(exc, PackageNotFound):
        raise HTTPException(status_code=404, detail="transfer package not found") from exc
    raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc


async def _receive(request: Request, pending: PendingPackage) -> None:
    """Stream the body into ``pending``; the store checks the cap per chunk."""
    async for chunk in request.stream():
        if chunk:
            pending.write(chunk)


@router.post(
    "/packages",
    openapi_extra=_BODY_DOC,
    responses={413: {"description": "Too large"}, 503: {"description": "Store unavailable"}},
)
async def store_package(request: Request) -> StoredPackageResponse:
    """Store a transfer package too large for the clipboard."""
    store = _store()
    limit = store.max_package_bytes
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise _too_large(limit)
    try:
        pending = await run_in_threadpool(store.begin)
    except (TransferStoreError, OSError) as exc:
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc
    try:
        await _receive(request, pending)
        stored = await run_in_threadpool(pending.commit)
    except PackageTooLarge as exc:
        raise _too_large(limit) from exc
    except EmptyPackage as exc:
        raise HTTPException(status_code=422, detail="transfer package is empty") from exc
    except (TransferStoreError, OSError) as exc:
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc
    finally:
        pending.abort()  # no-op after a successful commit; client disconnects too
    expires = datetime.fromtimestamp(stored.expires_at, tz=UTC)
    return StoredPackageResponse(
        id=stored.package_id,
        token=stored.token,
        size=stored.size,
        expires_at=expires.isoformat().replace("+00:00", "Z"),
        ttl_seconds=round(stored.expires_at - stored.created_at),
    )


def _chunks(fh: BinaryIO) -> Iterator[bytes]:
    with fh:
        while chunk := fh.read(_CHUNK):
            yield chunk


@router.get(
    "/packages/{package_id}",
    response_class=StreamingResponse,
    responses={
        200: {"content": {"application/json": {}}, "description": "The stored package"},
        400: {"description": "Invalid id"},
        404: {"description": "Not found (or wrong token)"},
        410: {"description": "Expired"},
    },
)
def fetch_package(
    package_id: str, x_transfer_token: Annotated[str, Header()]
) -> StreamingResponse:
    """Fetch a stored package by id; the token must match."""
    try:
        fh, size = _store().open_package(package_id, x_transfer_token)
    except (TransferStoreError, OSError) as exc:
        _raise_for(exc)
    return StreamingResponse(
        _chunks(fh),
        media_type="application/json",
        headers={"Cache-Control": "no-store", "Content-Length": str(size)},
    )


@router.delete(
    "/packages/{package_id}",
    responses={400: {"description": "Invalid id"}, 404: {"description": "Not found"}},
)
def delete_package(
    package_id: str, x_transfer_token: Annotated[str, Header()]
) -> DeletedResponse:
    """Remove a stored package before it expires; the token must match."""
    try:
        _store().delete(package_id, x_transfer_token)
    except (TransferStoreError, OSError) as exc:
        _raise_for(exc)
    return DeletedResponse(deleted=True)
