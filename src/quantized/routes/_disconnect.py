"""Run a sync route body in the threadpool while watching for the client to
disconnect -- so work queued behind the process-wide matplotlib render lock
can be skipped once nobody is waiting for it.

The Figure Builder preview re-renders on every edit and the browser aborts
the superseded request, but an aborted request still holds its place in the
``RENDER_LOCK`` queue and renders anyway, delaying the preview the user is
actually waiting for. The route body receives a ``threading.Event`` that is
set when the client goes, and checks it once it holds the lock.

Why not ``Request.is_disconnected()``: measured under uvicorn with this app's
``@middleware("http")`` guard (Starlette 1.3), it always returned False for an
aborted request -- its pre-cancelled probe loses the disconnect message inside
``BaseHTTPMiddleware``'s receive wrapper. A concurrent ``request.receive()``
that is allowed to wait is what ``StreamingResponse`` uses, and it does see
the disconnect.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections.abc import Callable
from typing import TypeVar

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request

__all__ = ["run_watching_disconnect"]

T = TypeVar("T")


async def run_watching_disconnect(request: Request, fn: Callable[[threading.Event], T]) -> T:
    """``fn(gone)`` in the threadpool; ``gone`` is set if the client
    disconnects first. Once the request body is read, the only message left
    to receive is ``http.disconnect``, so the watcher waits on exactly one."""
    gone = threading.Event()

    async def watch() -> None:
        with contextlib.suppress(Exception):
            if (await request.receive())["type"] == "http.disconnect":
                gone.set()

    watcher = asyncio.ensure_future(watch())
    try:
        return await run_in_threadpool(fn, gone)
    finally:
        watcher.cancel()  # still waiting when the client stayed connected
