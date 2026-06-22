"""FastAPI application factory for quantized.

Thin transport layer only — business logic lives in ``calc/`` and ``io/``.
Composes the per-domain routers; each router is a thin adapter.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from quantized import __version__
from quantized.routes import (
    baseline,
    corrections,
    fitting,
    parsers,
    plot,
    reference,
    stats,
)

__all__ = ["create_app", "app"]

# Built SPA (vite build → src/quantized/web/). A build artifact, gitignored;
# present in packaged/installed runs, absent in a bare dev checkout.
_WEB_DIR = Path(__file__).parent / "web"

# ── Desktop-style lifecycle (client presence over /api/ws) ──────────────────
# The SPA holds a WebSocket open; the status bar's connected dot reflects it.
# Auto-shutdown on last-tab-close is opt-in (env QZ_AUTO_SHUTDOWN=1, for the
# future `qz --desktop` run model) so dev/tests are never killed.
_clients = 0
_ever_connected = False
_AUTO_SHUTDOWN = os.environ.get("QZ_AUTO_SHUTDOWN") == "1"
_SHUTDOWN_GRACE_S = 1.5  # tab refresh disconnects + reconnects within ~1 s


def _origin_allowed(origin: str) -> bool:
    """Allow same-machine origins only (the WS upgrade bypasses CORS)."""
    host = urlparse(origin).hostname
    return host in {"127.0.0.1", "localhost", "::1"}


async def _lifecycle_ws(ws: WebSocket) -> None:
    """Client-presence socket: count live tabs; (optionally) shut down when the
    last one drops past a refresh-safe grace window. Module-level to keep
    create_app simple."""
    global _clients, _ever_connected
    origin = ws.headers.get("origin")
    if origin and not _origin_allowed(origin):
        await ws.close(code=1008)  # policy violation
        return
    await ws.accept()
    _clients += 1
    _ever_connected = True
    try:
        while True:
            await ws.receive_text()  # idles until disconnect
    except WebSocketDisconnect:
        pass
    finally:
        _clients -= 1
        if _AUTO_SHUTDOWN and _clients == 0:
            asyncio.get_running_loop().create_task(_grace_check())


async def _grace_check() -> None:
    """Exit unless a client reconnected within the grace window."""
    await asyncio.sleep(_SHUTDOWN_GRACE_S)
    if _AUTO_SHUTDOWN and _ever_connected and _clients == 0:
        os._exit(0)

# Vite dev server origins (the SPA in --dev mode). Same-origin in production.
_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def create_app() -> FastAPI:
    """Build the FastAPI app and wire the domain routers."""
    application = FastAPI(title="quantized", version=__version__)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=_DEV_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    application.include_router(parsers.router)
    application.include_router(plot.router)
    application.include_router(corrections.router)
    application.include_router(fitting.router)
    application.include_router(baseline.router)
    application.include_router(stats.router)
    application.include_router(reference.router)

    # Client-presence WebSocket (registered before the SPA mount so the
    # catch-all StaticFiles route never shadows it).
    application.websocket("/api/ws")(_lifecycle_ws)

    # Serve the built SPA at / when present (production / packaged runs). In a
    # bare dev checkout the dir is absent and the Vite dev server serves the UI.
    if _WEB_DIR.is_dir():
        application.mount("/", StaticFiles(directory=_WEB_DIR, html=True), name="web")
    return application


app = create_app()
