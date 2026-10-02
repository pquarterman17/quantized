"""Request body caps, enforced while the body streams in.

Before this, nothing bounded a request body until a route read it: a JSON
body was buffered whole by FastAPI, and a multipart upload was spooled whole
to a temp file by Starlette's form parser -- only THEN did the route's
per-file 512 MiB check (``routes/_uploadstream.py``) run. Here the cap
applies to the bytes as they arrive:

- a declared ``Content-Length`` over the cap is answered 413 before one byte
  of the body is read;
- a body with no length (chunked) is counted per ``receive()`` and answered
  413 the moment it passes the cap; whatever the app was doing with it is
  discarded.

Caps, by ``Content-Type``:

- ``multipart/form-data``: the per-file upload cap
  (``_uploadstream.MAX_UPLOAD_BYTES``, 512 MiB, sized from the instrument
  corpus) plus ``MULTIPART_OVERHEAD_BYTES`` for the boundaries and part
  headers -- the request cap never refuses a file the route would accept.
- everything else (JSON, the raw workbook-transfer body): 256 MiB. The
  largest JSON this app moves is a dataset round trip; the measured extremes
  are a 78 MB ``/api/plot/series`` payload for a 1M x 7 table and a 188 MB
  workspace (``docs/performance_envelope.md``), and the workbook-transfer
  package is capped at 128 MB by its own store. 256 MiB clears all of those
  while refusing a runaway or hostile body long before it exhausts memory.

Both values are read at call time, so tests can monkeypatch them.
"""

from __future__ import annotations

import json

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from quantized.routes import _uploadstream

__all__ = ["MAX_JSON_BODY_BYTES", "MULTIPART_OVERHEAD_BYTES", "BodyLimitMiddleware", "limit_for"]

MAX_JSON_BODY_BYTES = 256 * 1024 * 1024
MULTIPART_OVERHEAD_BYTES = 1024 * 1024


def limit_for(content_type: str) -> int:
    """The byte cap for a request body of this ``Content-Type``."""
    if content_type.strip().lower().startswith("multipart/form-data"):
        return _uploadstream.MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES
    return MAX_JSON_BODY_BYTES


class _BodyTooLarge(Exception):
    """Raised out of ``receive()`` once the body passes its cap."""


async def _send_413(send: Send, limit: int) -> None:
    body = json.dumps({"detail": f"request body too large (limit {limit} bytes)"}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                # the rest of the body is never read: close, don't keep alive
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodyLimitMiddleware:
    """Pure ASGI middleware applying :func:`limit_for` to every HTTP request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        limit = limit_for(headers.get("content-type", ""))
        declared = headers.get("content-length", "")
        if declared.isdigit() and int(declared) > limit:
            await _send_413(send, limit)
            return

        received = 0
        exceeded = False
        started = False

        async def counted_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _BodyTooLarge
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if exceeded:
                return  # the app's reaction to the overflow; the 413 replaces it
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counted_receive, guarded_send)
        except Exception:
            # FastAPI/Starlette may re-wrap the overflow (a 400 "error parsing
            # the body", a form-parser error): any exception after it is it.
            if not exceeded:
                raise
        if exceeded and not started:
            await _send_413(send, limit)
